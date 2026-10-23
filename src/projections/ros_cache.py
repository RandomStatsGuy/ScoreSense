"""Materialized rest-of-season predictions â€” parquet artifact + in-process cache."""

from __future__ import annotations

from src.ops.job_diagnostics import annotate_job

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from src.core.artifact_revision import artifact_revision, file_content_revision

from src.config import MODEL_DIR, PROCESSED_DATA_DIR, ROS_PREDICTIONS_DIR
from src.projections.artifact_store import feature_source_cutoff, prediction_identity_revision, publish_prediction_artifact, read_prediction_artifact


def predict_rest_of_season(*args, **kwargs):
    """Import the model engine only when a background build needs inference."""
    from src.projections.ros_projections import predict_rest_of_season as predict
    return predict(*args, **kwargs)


_ROS_CACHE: dict[str, tuple[tuple, pd.DataFrame]] = {}
_ROS_COMPUTE_LOCK = threading.Lock()


def _with_roster_identity(
    df: pd.DataFrame,
    position: str,
    season: int | None,
    week: int | None,
    *,
    cache_key: str | None = None,
    allow_refresh: bool = True,
) -> pd.DataFrame:
    from src.integrations.roster_identity import apply_roster_identity_with_attrs

    # Legacy ROS artifacts omitted the weekly row's WR/TE identity. Give the
    # existing serve-time identity overlay a column to fill without rebuilding
    # predictions or guessing WR from the combined model/board key.
    identity_frame = df if {"Position", "position"}.intersection(df.columns) else df.assign(Position=None)
    return apply_roster_identity_with_attrs(
        identity_frame, position, season=season, week=week, cache_key=cache_key, allow_refresh=allow_refresh
    )


def _cache_key(position: str, season: int, week: int, apply_injury: bool) -> str:
    return f"{position.lower()}:{season}:w{week}:inj{int(apply_injury)}"


def _artifact_paths(position: str, season: int, week: int, apply_injury: bool) -> tuple[Path, Path]:
    ROS_PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    pos = position.lower()
    suffix = "" if apply_injury else "_no_inj"
    stem = f"{season}_w{week}_{pos}{suffix}"
    return (
        ROS_PREDICTIONS_DIR / f"{stem}.parquet",
        ROS_PREDICTIONS_DIR / f"{stem}.meta.json",
    )


# Bump when ROS aggregation semantics change (e.g. SCORE-32 opportunity decay).
ROS_AGGREGATION_VERSION = "ros_opp_decay_v2_deep_coverage"


def ros_fingerprint() -> str:
    from src.projections.roster_coverage import roster_input_revisions
    parts: list[str] = [f"agg:{ROS_AGGREGATION_VERSION}"]
    from src.projections.input_policy import projection_input_revisions
    parts.extend(projection_input_revisions())
    parts.extend(roster_input_revisions())
    for pos in ("qb", "rb", "wr"):
        feat = PROCESSED_DATA_DIR / f"{pos}_mlready.parquet"
        if feat.exists():
            parts.append(f"feat:{pos}:{file_content_revision(feat)}")
    for name in ("qb_model.joblib", "rb_model_calibrated.joblib", "wr_model_calibrated.joblib"):
        model = MODEL_DIR / name
        if model.exists():
            parts.append(f"model:{name}:{file_content_revision(model)}")
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def _load_ros_prediction(
    position: str,
    season: int | None = None,
    week: int | None = None,
    *,
    apply_injury_adjustments: bool = True,
    allow_compute: bool = True,
    force: bool = False,
    allow_stale: bool = False,
) -> pd.DataFrame:
    """Load cached ROS projections or compute and persist."""
    if season is None or week is None:
        if not allow_compute:
            empty = pd.DataFrame()
            empty.attrs["artifact_status"] = {"status": "missing", "reason": "incomplete_projection_context"}
            return empty
        return predict_rest_of_season(
            position,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
        )

    def finish(frame, *args, **kwargs):
        return _with_roster_identity(frame, *args, allow_refresh=allow_compute, **kwargs)

    pos = position.lower()
    fp = ros_fingerprint()
    annotate_job(season=int(season), week=int(week), apply_injury=bool(apply_injury_adjustments), force=force, input_revision=fp, cache_hit=False)
    key = _cache_key(pos, int(season), int(week), apply_injury_adjustments)
    parquet_path, meta_path = _artifact_paths(pos, int(season), int(week), apply_injury_adjustments)
    memory_fp = (fp, str(parquet_path.resolve()), artifact_revision(parquet_path, meta_path), prediction_identity_revision(int(season)))
    if not force:
        cached = _ROS_CACHE.get(key)
        if cached is not None and cached[0] == memory_fp:
            annotate_job(cache_hit=True)
            return finish(
                cached[1].copy(),
                pos,
                int(season),
                int(week),
                cache_key=f"ros:{key}:{memory_fp}",
            )

        df, _meta, diagnostic = read_prediction_artifact(
            parquet_path, meta_path, position=pos, season=int(season), week=int(week),
            apply_injury_adjustments=apply_injury_adjustments, fingerprint=fp,
        )
        if diagnostic["status"] == "ready" or (allow_stale and diagnostic["status"] == "stale"):
            annotate_job(cache_hit=True)
            if diagnostic["status"] == "ready":
                _ROS_CACHE[key] = ((fp, str(parquet_path.resolve()), diagnostic["artifact_revision"], diagnostic["current_identity_revision"]), df.copy())
            return finish(df, pos, int(season), int(week), cache_key=f"ros:{key}:{parquet_path.resolve()}:{diagnostic['artifact_revision']}:{fp}")
        if allow_stale and cached is not None and cached[0][1] == str(parquet_path.resolve()):
            out = cached[1].copy()
            out.attrs["projection_stale"] = True
            out.attrs["artifact_status"] = {**(out.attrs.get("artifact_status") or {}), **diagnostic, "last_known_good": True, "built_at": out.attrs.get("built_at")}
            return finish(out, pos, int(season), int(week), cache_key=f"ros:lkg:{key}:{cached[0]}:{diagnostic.get('artifact_revision')}")
    else:
        diagnostic = {"status": "missing", "reason": "force_rebuild_requested"}

    if not allow_compute:
        empty = pd.DataFrame()
        empty.attrs["artifact_status"] = diagnostic
        return empty

    with _ROS_COMPUTE_LOCK:
        if not force:
            # Recheck after another thread's publication, using its new disk
            # revision rather than the revision captured before the lock.
            existing = load_ros_prediction(
                pos, season=int(season), week=int(week),
                apply_injury_adjustments=apply_injury_adjustments, allow_compute=False,
            )
            if not existing.empty:
                return existing

        annotate_job(computation_performed=True)
        df = predict_rest_of_season(
            pos,
            season=int(season),
            week=int(week),
            apply_injury_adjustments=apply_injury_adjustments,
        )
        if ros_fingerprint() != fp:
            raise RuntimeError("prediction_inputs_changed_during_compute")
        save_ros_artifact(pos, int(season), int(week), apply_injury_adjustments, df, source_fingerprint=fp)
        return finish(
            df,
            pos,
            int(season),
            int(week),
            cache_key=f"ros:{key}:{parquet_path.resolve()}:{artifact_revision(parquet_path, meta_path)}:{fp}",
        )



def load_ros_prediction(
    position: str, season: int | None = None, week: int | None = None, *,
    apply_injury_adjustments: bool = True, allow_compute: bool = True,
    force: bool = False, allow_stale: bool = False,
) -> pd.DataFrame:
    """Retain the requested-context ROS snapshot after a failed replacement."""
    failure = None
    try:
        frame = _load_ros_prediction(
            position, season, week, apply_injury_adjustments=apply_injury_adjustments,
            allow_compute=allow_compute, force=force, allow_stale=allow_stale,
        )
        if not frame.empty or not allow_stale:
            return frame
    except Exception as exc:
        if not allow_stale:
            raise
        failure = exc
    if season is not None and week is not None:
        from src.projections.artifact_snapshot import read_snapshot

        frame = read_snapshot(
            *_artifact_paths(position, season, week, apply_injury_adjustments),
            season=season, week=week, position=position.lower(), injury=apply_injury_adjustments,
            fingerprint=ros_fingerprint(), required_columns=('ROS P10', 'ROS P50', 'ROS P90'),
        )
        if not frame.empty:
            frame.attrs['projection_stale'] = True
            return frame
    if failure:
        raise failure
    return frame


def save_ros_artifact(
    position: str,
    season: int,
    week: int,
    apply_injury_adjustments: bool,
    df: pd.DataFrame,
    *,
    source_fingerprint: str | None = None,
) -> Path:
    parquet_path, meta_path = _artifact_paths(position, season, week, apply_injury_adjustments)
    meta: dict[str, Any] = {
        "artifact_kind": "ros",
        "position": position.lower(),
        "season": season,
        "week": week,
        "apply_injury_adjustments": apply_injury_adjustments,
        "fingerprint": source_fingerprint or ros_fingerprint(),
        "rows": int(len(df)),
        "built_at": datetime.now(timezone.utc).isoformat(),
        "feature_source_cutoff": feature_source_cutoff(position, PROCESSED_DATA_DIR),
        "attrs": {key: value for key, value in df.attrs.items() if key not in {"artifact_status", "_scoresense_prediction_artifact", "built_at"}},
    }
    if ros_fingerprint() != meta["fingerprint"]:
        raise RuntimeError("prediction_inputs_changed_during_publication")
    meta = publish_prediction_artifact(parquet_path, meta_path, df, meta)
    key = _cache_key(position, season, week, apply_injury_adjustments)
    saved, saved_meta, diagnostic = read_prediction_artifact(
        parquet_path, meta_path, position=position.lower(), season=season, week=week,
        apply_injury_adjustments=apply_injury_adjustments, fingerprint=meta["fingerprint"],
    )
    if diagnostic["status"] == "ready":
        _ROS_CACHE[key] = ((saved_meta["fingerprint"], str(parquet_path.resolve()), diagnostic["artifact_revision"], diagnostic["current_identity_revision"]), saved)
    return parquet_path



def invalidate_ros_cache() -> None:
    _ROS_CACHE.clear()
    from src.integrations.roster_identity import invalidate_identity_overlay_cache

    invalidate_identity_overlay_cache()


def compute_ros_artifact(position: str, season: int, week: int, apply_injury: bool = True) -> int:
    """CPU worker entry point for cold ROS reads."""
    return len(load_ros_prediction(position, season, week, apply_injury_adjustments=apply_injury))


def prewarm_ros_predictions(
    season: int,
    week: int,
    *,
    positions: tuple[str, ...] = ("qb", "rb", "wr"),
    injury_variants: tuple[bool, ...] = (True, False),
    force: bool = False,
) -> dict[str, int]:
    """Materialize ROS parquet artifacts for dashboard hot paths."""
    counts: dict[str, int] = {}
    for pos in positions:
        for apply_injury in injury_variants:
            df = load_ros_prediction(
                pos,
                season=int(season),
                week=int(week),
                apply_injury_adjustments=apply_injury,
                force=force,
            )
            counts[f"{pos}:inj{int(apply_injury)}"] = int(len(df))
    return counts
