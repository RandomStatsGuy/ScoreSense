"""Materialized rest-of-season predictions — parquet artifact + in-process cache."""

from __future__ import annotations

from src.ops.job_diagnostics import annotate_job

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from src.core.artifact_revision import artifact_revision

from src.config import MODEL_DIR, PROCESSED_DATA_DIR, ROS_PREDICTIONS_DIR
from src.projections.ros_projections import predict_rest_of_season
from src.projections.artifact_snapshot import read_cached_frame, read_cached_metadata

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

    return apply_roster_identity_with_attrs(
        df, position, season=season, week=week, cache_key=cache_key, allow_refresh=allow_refresh
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
            parts.append(f"feat:{pos}:{feat.stat().st_mtime_ns}")
    for name in ("qb_model.joblib", "rb_model_calibrated.joblib", "wr_model_calibrated.joblib"):
        model = MODEL_DIR / name
        if model.exists():
            parts.append(f"model:{name}:{model.stat().st_mtime_ns}")
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def _load_ros_prediction(
    position: str,
    season: int | None = None,
    week: int | None = None,
    *,
    apply_injury_adjustments: bool = True,
    allow_compute: bool = True,
    force: bool = False,
) -> pd.DataFrame:
    """Load cached ROS projections or compute and persist."""
    if season is None or week is None:
        return predict_rest_of_season(
            position,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
        )

    pos = position.lower()
    fp = ros_fingerprint()
    annotate_job(season=int(season), week=int(week), apply_injury=bool(apply_injury_adjustments),
                 force=force, input_revision=fp, cache_hit=False)
    key = _cache_key(pos, int(season), int(week), apply_injury_adjustments)
    parquet_path, meta_path = _artifact_paths(pos, int(season), int(week), apply_injury_adjustments)
    memory_fp = (fp, artifact_revision(parquet_path, meta_path))
    if not force:
        cached = _ROS_CACHE.get(key)
        if cached is not None and cached[0] == memory_fp:
            annotate_job(cache_hit=True)
            return _with_roster_identity(
                cached[1].copy(),
                pos,
                int(season),
                int(week),
                cache_key=f"ros:{key}:{memory_fp}",
                allow_refresh=allow_compute,
            )

        if parquet_path.exists() and meta_path.exists():
            meta = read_cached_metadata(meta_path)
            if (meta.get("fingerprint") == fp
                and (meta.get('season'),meta.get('week'),meta.get('position'),meta.get('apply_injury_adjustments'))
                    == (int(season),int(week),pos,apply_injury_adjustments)):
                df = read_cached_frame(parquet_path)
                if not df.empty:
                    df.attrs['built_at'] = meta.get('built_at')
                    _ROS_CACHE[key] = (memory_fp, df.copy())
                    annotate_job(cache_hit=True)
                    return _with_roster_identity(
                        df,
                        pos,
                        int(season),
                        int(week),
                        cache_key=f"ros:{key}:{memory_fp}",
                        allow_refresh=allow_compute,
                    )

    if not allow_compute:
        return pd.DataFrame()

    with _ROS_COMPUTE_LOCK:
        if not force:
            cached = _ROS_CACHE.get(key)
            if cached is not None and cached[0] == memory_fp:
                annotate_job(cache_hit=True)
                return _with_roster_identity(
                    cached[1].copy(),
                    pos,
                    int(season),
                    int(week),
                    cache_key=f"ros:{key}:{memory_fp}",
                )
            if parquet_path.exists() and meta_path.exists():
                meta = read_cached_metadata(meta_path)
                if (meta.get("fingerprint") == fp
                    and (meta.get('season'),meta.get('week'),meta.get('position'),meta.get('apply_injury_adjustments'))
                        == (int(season),int(week),pos,apply_injury_adjustments)):
                    df = read_cached_frame(parquet_path)
                    if not df.empty:
                        df.attrs['built_at'] = meta.get('built_at')
                        _ROS_CACHE[key] = (memory_fp, df.copy())
                        annotate_job(cache_hit=True)
                        return _with_roster_identity(
                            df,
                            pos,
                            int(season),
                            int(week),
                            cache_key=f"ros:{key}:{memory_fp}",
                        )

        annotate_job(computation_performed=True)
        df = predict_rest_of_season(
            pos,
            season=int(season),
            week=int(week),
            apply_injury_adjustments=apply_injury_adjustments,
        )
        save_ros_artifact(pos, int(season), int(week), apply_injury_adjustments, df)
        return _with_roster_identity(
            df,
            pos,
            int(season),
            int(week),
            cache_key=f"ros:{key}:{memory_fp}",
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
            allow_compute=allow_compute, force=force,
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
    return pd.DataFrame()


def save_ros_artifact(
    position: str,
    season: int,
    week: int,
    apply_injury_adjustments: bool,
    df: pd.DataFrame,
) -> Path:
    if df.empty:
        raise ValueError("Empty ROS projection output; previous artifact preserved")
    from uuid import uuid4

    parquet_path, meta_path = _artifact_paths(position, season, week, apply_injury_adjustments)
    meta: dict[str, Any] = {
        "position": position.lower(),
        "season": season,
        "week": week,
        "apply_injury_adjustments": apply_injury_adjustments,
        "fingerprint": ros_fingerprint(),
        "rows": int(len(df)),
        "built_at": datetime.now(timezone.utc).isoformat(),
    }
    df.attrs["built_at"] = meta["built_at"]
    for path, write in (
        (parquet_path, lambda temp: df.to_parquet(temp, index=False)),
        (meta_path, lambda temp: temp.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")),
    ):
        temp = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
        try:
            write(temp)
            temp.replace(path)
        finally:
            temp.unlink(missing_ok=True)
    key = _cache_key(position, season, week, apply_injury_adjustments)
    _ROS_CACHE[key] = ((meta["fingerprint"], artifact_revision(parquet_path, meta_path)), df.copy())
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
