"""Finish a refresh only after its consumers can read the current artifacts."""
from __future__ import annotations

from src.draft_hub.draft_pool_cache import load_draft_pool, pool_artifact_status, pool_fingerprint
from src.draft_hub.value_snapshot_warmup import warm_fantasy_value_snapshots
from src.draft_hub.prepared_week_context import prewarm_week_context
from src.projections.weekly_cache import load_weekly_prediction, prewarm_weekly_predictions, weekly_fingerprint
from src.projections.ros_cache import load_ros_prediction, prewarm_ros_predictions, ros_fingerprint
from src.projections.injury_overlay import prewarm_injury_overlays
from src.projections.player_context import prewarm_player_context


def _input_revision() -> tuple[str, str, str]:
    return weekly_fingerprint(), ros_fingerprint(), pool_fingerprint()


def _artifacts_readable(season: int, week: int, draft_season: int) -> bool:
    for loader in (load_weekly_prediction, load_ros_prediction):
        for pos in ("qb", "rb", "wr"):
            for injury in (True, False):
                frame = loader(pos, season, week, apply_injury_adjustments=injury, allow_compute=False)
                if frame.empty:
                    return False
    return not load_draft_pool(draft_season, allow_compute=False, apply_identity=False).empty


def finalize_projection_caches(season: int, week: int, draft_season: int) -> dict:
    """Repair artifacts after late source updates; never relabel stale results."""
    for attempt in range(3):
        revision = _input_revision()
        weekly = prewarm_weekly_predictions(season, week, force=False)
        ros = prewarm_ros_predictions(season, week, force=False)
        load_draft_pool(draft_season, apply_identity=False)
        values = warm_fantasy_value_snapshots(prepare_pools=True)
        # Preparing an older season can discover a new source snapshot. All
        # caches and valuation snapshots must then be rebuilt from that revision.
        if _input_revision() != revision:
            continue
        if not _artifacts_readable(season, week, draft_season):
            continue
        if values["unavailable"]:
            seasons = ", ".join(str(s) for s in values.get("failed_seasons", []))
            detail = f" Affected seasons: {seasons}." if seasons else ""
            raise RuntimeError("Fantasy valuation snapshots remain unavailable after projection refresh." + detail)
        optional = {}
        for name, producer in (
            ("injury_overlay_prewarm", lambda s, w: prewarm_injury_overlays(s, w, force=True)),
            ("player_context_prewarm", prewarm_player_context),
        ):
            try:
                optional[name] = producer(season, week)
            except Exception as exc:
                optional[name] = {"status": "error", "detail": str(exc)}
        context = prewarm_week_context(season, week)
        if (_input_revision() != revision or not _artifacts_readable(season, week, draft_season)
                or any(item.get("status") not in ("current", "prepared") for item in context.values())):
            continue
        pool = pool_artifact_status(draft_season)
        pool["value_snapshots"] = values
        return {
            "weekly_predictions_prewarm": weekly,
            "ros_predictions_prewarm": ros,
            "draft_pool_artifact": pool,
            "fantasy_value_snapshots": values,
            "fantasy_week_context": context,
            "projection_cache_readiness": {"status": "ready", "attempts": attempt + 1},
            **optional,
        }
    raise RuntimeError(
        "Projection inputs changed during cache preparation. Serving artifacts are not ready. "
        "Retry the refresh with --no-retrain."
    )
