"""Materialized weekly predictions â€” parquet artifact + in-process cache."""

from __future__ import annotations

from src.ops.job_diagnostics import annotate_job

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from src.core.artifact_revision import artifact_revision, file_content_revision

from src.config import MODEL_DIR, PROCESSED_DATA_DIR, WEEKLY_PREDICTIONS_DIR
from src.core.opportunity import ensure_opportunity_adjustment_columns
from src.projections.artifact_store import feature_source_cutoff, prediction_identity_revision, publish_prediction_artifact, read_prediction_artifact

_WEEKLY_CACHE: dict[str, tuple[tuple, pd.DataFrame]] = {}


def predict_upcoming_week(*args, **kwargs):
    """Keep artifact readers independent of model-engine imports."""
    from src.projections.predict import predict_upcoming_week as predict
    return predict(*args, **kwargs)


def _cache_key(position: str, season: int, week: int, apply_injury: bool) -> str:
    return f"{position.lower()}:{season}:w{week}:inj{int(apply_injury)}"


def _artifact_paths(position: str, season: int, week: int, apply_injury: bool) -> tuple[Path, Path]:
    WEEKLY_PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    pos = position.lower()
    suffix = "" if apply_injury else "_no_inj"
    stem = f"{season}_w{week}_{pos}{suffix}"
    return (
        WEEKLY_PREDICTIONS_DIR / f"{stem}.parquet",
        WEEKLY_PREDICTIONS_DIR / f"{stem}.meta.json",
    )


WEEKLY_POOL_POLICY = "v5-opportunity-identity"


def _with_roster_identity(
    df: pd.DataFrame,
    position: str,
    season: int | None,
    week: int | None,
    *,
    cache_key: str | None = None,
    allow_refresh: bool = True,
) -> pd.DataFrame:
    """Re-label cached weekly rows from the current nflverse roster."""
    from src.integrations.roster_identity import apply_roster_identity_with_attrs

    return apply_roster_identity_with_attrs(
        df,
        position,
        season=season,
        week=week,
        cache_key=cache_key,
        allow_refresh=allow_refresh,
    )


def weekly_fingerprint() -> str:
    from src.projections.roster_coverage import roster_input_revisions
    parts: list[str] = [f"pool:{WEEKLY_POOL_POLICY}"]
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


def _load_weekly_prediction(
    position: str,
    season: int | None = None,
    week: int | None = None,
    *,
    apply_injury_adjustments: bool = True,
    allow_compute: bool = True,
    force: bool = False,
    allow_stale: bool = False,
    apply_identity: bool = True,
) -> pd.DataFrame:
    """Load cached weekly predictions or compute and persist."""
    if season is None or week is None:
        if not allow_compute:
            empty = pd.DataFrame()
            empty.attrs["artifact_status"] = {"status": "missing", "reason": "incomplete_projection_context"}
            return empty
        return ensure_opportunity_adjustment_columns(
            predict_upcoming_week(
                position,
                season=season,
                week=week,
                apply_injury_adjustments=apply_injury_adjustments,
            )
        )

    def finish(frame, *args, **kwargs):
        if not apply_identity:
            return frame
        return _with_roster_identity(frame, *args, allow_refresh=allow_compute, **kwargs)

    pos = position.lower()
    fp = weekly_fingerprint()
    annotate_job(season=int(season), week=int(week), apply_injury=bool(apply_injury_adjustments), force=force, input_revision=fp, cache_hit=False)
    key = _cache_key(pos, int(season), int(week), apply_injury_adjustments)
    parquet_path, meta_path = _artifact_paths(pos, int(season), int(week), apply_injury_adjustments)
    memory_fp = (fp, str(parquet_path.resolve()), artifact_revision(parquet_path, meta_path), prediction_identity_revision(int(season)))
    if not force:
        cached = _WEEKLY_CACHE.get(key)
        if cached is not None and cached[0] == memory_fp:
            annotate_job(cache_hit=True)
            out = cached[1].copy()
            for k, v in cached[1].attrs.items():
                out.attrs[k] = v
            return ensure_opportunity_adjustment_columns(
                finish(
                    out,
                    pos,
                    int(season),
                    int(week),
                    cache_key=f"weekly:{key}:{memory_fp}",
                )
            )

        df, _meta, diagnostic = read_prediction_artifact(
            parquet_path, meta_path, position=pos, season=int(season), week=int(week),
            apply_injury_adjustments=apply_injury_adjustments, fingerprint=fp,
        )
        if diagnostic["status"] == "ready" or (allow_stale and diagnostic["status"] == "stale"):
            annotate_job(cache_hit=True)
            df = ensure_opportunity_adjustment_columns(df)
            if diagnostic["status"] == "ready":
                _WEEKLY_CACHE[key] = ((fp, str(parquet_path.resolve()), diagnostic["artifact_revision"], diagnostic["current_identity_revision"]), df.copy())
            return finish(df, pos, int(season), int(week), cache_key=f"weekly:{key}:{parquet_path.resolve()}:{diagnostic['artifact_revision']}:{fp}")
        if allow_stale and cached is not None and cached[0][1] == str(parquet_path.resolve()):
            # Keep a validated same-context frame if a replacement is corrupt.
            out = cached[1].copy()
            out.attrs["projection_stale"] = True
            out.attrs["artifact_status"] = {**(out.attrs.get("artifact_status") or {}), **diagnostic, "last_known_good": True, "built_at": out.attrs.get("built_at")}
            return finish(out, pos, int(season), int(week), cache_key=f"weekly:lkg:{key}:{cached[0]}:{diagnostic.get('artifact_revision')}")
    else:
        diagnostic = {"status": "missing", "reason": "force_rebuild_requested"}

    if not allow_compute:
        empty = pd.DataFrame()
        empty.attrs["artifact_status"] = diagnostic
        return empty

    annotate_job(computation_performed=True)
    df = ensure_opportunity_adjustment_columns(
        predict_upcoming_week(
            pos,
            season=int(season),
            week=int(week),
            apply_injury_adjustments=apply_injury_adjustments,
        )
    )
    if weekly_fingerprint() != fp:
        raise RuntimeError("prediction_inputs_changed_during_compute")
    save_weekly_artifact(pos, int(season), int(week), apply_injury_adjustments, df, source_fingerprint=fp)
    # Mirror the artifact timestamp onto the in-process frame for API freshness.
    if "built_at" not in df.attrs:
        df.attrs["built_at"] = datetime.now(timezone.utc).isoformat()
    return finish(
        df,
        pos,
        int(season),
        int(week),
        cache_key=f"weekly:{key}:{parquet_path.resolve()}:{artifact_revision(parquet_path, meta_path)}:{fp}",
    )



def load_weekly_prediction(
    position: str, season: int | None = None, week: int | None = None, *,
    apply_injury_adjustments: bool = True, allow_compute: bool = True,
    force: bool = False, allow_stale: bool = False,
    apply_identity: bool = True,
) -> pd.DataFrame:
    """Keep the same-week snapshot usable when a replacement fails.

    Refresh workers can reuse the inference frame before the read-time identity
    overlay with ``apply_identity=False``; inference still resolves roster identity.
    """
    failure = None
    try:
        frame = _load_weekly_prediction(
            position, season, week, apply_injury_adjustments=apply_injury_adjustments,
            allow_compute=allow_compute, force=force, allow_stale=allow_stale,
            apply_identity=apply_identity,
        )
        if not frame.empty or not allow_stale:
            return frame
    except Exception as exc:
        if not allow_stale:
            raise
        failure, frame = exc, pd.DataFrame()
    if season is not None and week is not None:
        from src.projections.artifact_snapshot import read_snapshot
        parquet, meta = _artifact_paths(position, season, week, apply_injury_adjustments)
        previous = read_snapshot(
            parquet, meta, season=season, week=week, position=position.lower(),
            injury=apply_injury_adjustments, fingerprint=weekly_fingerprint(),
        )
        if not previous.empty:
            previous.attrs["projection_stale"] = True
            return ensure_opportunity_adjustment_columns(previous)
    if failure is not None:
        raise failure
    return frame


def compute_weekly_artifact(
    position: str,
    season: int,
    week: int,
    apply_injury_adjustments: bool = True,
    force: bool = False,
) -> int:
    """Process-pool worker: compute and persist a weekly artifact.

    Returns the row count; the caller re-reads the artifact from disk so the
    DataFrame never crosses the process boundary.
    """
    df = load_weekly_prediction(
        position,
        season=season,
        week=week,
        apply_injury_adjustments=apply_injury_adjustments,
        force=force,
    )
    return int(len(df))


def save_weekly_artifact(
    position: str,
    season: int,
    week: int,
    apply_injury_adjustments: bool,
    df: pd.DataFrame,
    *,
    source_fingerprint: str | None = None,
) -> Path:
    parquet_path, meta_path = _artifact_paths(position, season, week, apply_injury_adjustments)

    # Capture prior artifact before overwrite so refresh can emit movement (SCORE-7).
    previous_df = None
    previous_meta: dict[str, Any] | None = None
    if parquet_path.exists():
        prior, prior_meta, prior_status = read_prediction_artifact(
            parquet_path, meta_path, position=position.lower(), season=season, week=week,
            apply_injury_adjustments=apply_injury_adjustments, fingerprint=weekly_fingerprint(),
        )
        if prior_status["status"] in {"ready", "stale"}:
            previous_df, previous_meta = prior, prior_meta

    built_at = datetime.now(timezone.utc).isoformat()
    fingerprint = source_fingerprint or weekly_fingerprint()
    meta: dict[str, Any] = {
        "artifact_kind": "weekly",
        "position": position.lower(),
        "season": season,
        "week": week,
        "apply_injury_adjustments": apply_injury_adjustments,
        "fingerprint": fingerprint,
        "rows": int(len(df)),
        "built_at": built_at,
        "feature_source_cutoff": feature_source_cutoff(position, PROCESSED_DATA_DIR),
        "attrs": {
            k: df.attrs[k]
            for k in ("inference_meta", "projection_note", "preseason_mode", "input_quality")
            if k in df.attrs
        },
    }
    if weekly_fingerprint() != fingerprint:
        raise RuntimeError("prediction_inputs_changed_during_publication")
    meta = publish_prediction_artifact(parquet_path, meta_path, df, meta)
    key = _cache_key(position, season, week, apply_injury_adjustments)
    # Reload restores authoritative metadata exactly as the next API process sees it.
    saved, saved_meta, diagnostic = read_prediction_artifact(
        parquet_path, meta_path, position=position.lower(), season=season, week=week,
        apply_injury_adjustments=apply_injury_adjustments, fingerprint=fingerprint,
    )
    if diagnostic["status"] == "ready":
        _WEEKLY_CACHE[key] = ((saved_meta["fingerprint"], str(parquet_path.resolve()), diagnostic["artifact_revision"], diagnostic["current_identity_revision"]), saved)

    # Movement is best-effort â€” never block weekly artifact writes.
    try:
        from src.projections.projection_movement import (
            projection_content_fingerprint,
            save_projection_movement_artifact,
        )

        # Skip only when projection *content* is unchanged. Weekly fingerprints
        # track model/feature mtimes and miss roster/injury/depth overlay churn
        # (SCORE-48: force refresh left movement stuck at available=false).
        if previous_df is not None and not previous_df.empty:
            prev_content = projection_content_fingerprint(previous_df)
            curr_content = projection_content_fingerprint(df)
            if prev_content == curr_content:
                return parquet_path

        save_projection_movement_artifact(
            position,
            season,
            week,
            apply_injury_adjustments,
            df,
            previous_df=previous_df,
            previous_meta=previous_meta,
            current_fingerprint=fingerprint,
            current_built_at=built_at,
        )
    except Exception:
        pass

    return parquet_path



def _apply_saved_attrs(df: pd.DataFrame, meta: dict[str, Any]) -> None:
    attrs = meta.get("attrs") or {}
    for key, value in attrs.items():
        df.attrs[key] = value


def invalidate_weekly_cache() -> None:
    _WEEKLY_CACHE.clear()
    from src.integrations.roster_identity import invalidate_identity_overlay_cache

    invalidate_identity_overlay_cache()


def prewarm_weekly_predictions(
    season: int,
    week: int,
    *,
    positions: tuple[str, ...] = ("qb", "rb", "wr"),
    injury_variants: tuple[bool, ...] = (True, False),
    force: bool = False,
) -> dict[str, int]:
    """Materialize weekly parquet artifacts for dashboard hot paths."""
    counts: dict[str, int] = {}
    for pos in positions:
        for apply_injury in injury_variants:
            df = load_weekly_prediction(
                pos,
                season=int(season),
                week=int(week),
                apply_injury_adjustments=apply_injury,
                force=force,
            )
            counts[f"{pos}:inj{int(apply_injury)}"] = int(len(df))
    return counts


def rebuild_weekly_predictions(
    season: int,
    week: int,
    *,
    positions: tuple[str, ...] = ("qb", "rb", "wr"),
    injury_variants: tuple[bool, ...] = (True, False),
) -> dict[str, int]:
    """Force-rebuild weekly artifacts (Hub Refresh projections / jobs)."""
    invalidate_weekly_cache()
    counts = prewarm_weekly_predictions(
        int(season),
        int(week),
        positions=positions,
        injury_variants=injury_variants,
        force=True,
    )
    from src.draft_hub.prepared_week_context import prepare_week_context
    for apply_injury in injury_variants:
        status = prepare_week_context(int(season), int(week), apply_injury)
        if status["status"] not in ("prepared", "current"):
            raise RuntimeError("Weekly player context is not ready: " + status["status"])
    return counts
