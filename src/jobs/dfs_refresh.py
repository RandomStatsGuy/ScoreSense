"""Current-week inference refresh with a five-minute completion gap. No training."""

from src.ops.job_diagnostics import observe_job, annotate_job, call_phase
import json
import logging
import math
import time
from datetime import datetime, timezone

from src.config import CACHE_DIR, DFS_REFRESH_SECONDS, DFS_FORECAST_MAX_AGE_SECONDS
from src.jobs.refresh_lock import refresh_lock, RefreshBusy
from src.jobs import dfs_inputs

STATUS_PATH = CACHE_DIR / "dfs_refresh.json"
logger = logging.getLogger(__name__)


def _warm_supporting_data(season, week):
    from src.projections.player_context import prewarm_player_context
    from src.projections.injury_overlay import prewarm_injury_overlays
    for name, producer in (("injuries", prewarm_injury_overlays), ("notes", prewarm_player_context)):
        try:
            call_phase(name, producer, season, week)
        except Exception:
            logger.exception("Automatic forecast supporting data failed: %s", name)


@observe_job("dfs_refresh", cadence_s=DFS_REFRESH_SECONDS)
def run_dfs_refresh(*, force: bool = False):
    from src.integrations.injury_poll import run_injury_poll, get_injury_poll_status
    from src.integrations.sleeper import get_nfl_state
    from src.projections.weekly_cache import load_weekly_prediction
    try:
        # Coordinate with the full pipeline and other API workers.
        with refresh_lock(CACHE_DIR / "last_refresh.lock"):
            try:
                previous = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                previous = {}
            if not isinstance(previous, dict):
                previous = {}
            # Legacy status files use the start time until their next completion.
            last_refresh_epoch = previous.get("completed_epoch", previous.get("attempt_epoch", 0))
            if type(last_refresh_epoch) not in (int, float) or not math.isfinite(last_refresh_epoch):
                last_refresh_epoch = 0
            if not force and 0 <= time.time() - last_refresh_epoch < DFS_REFRESH_SECONDS:
                return {**previous, "status": "not_due"}
            status = {"attempt_epoch": time.time(), "started_at": datetime.now(timezone.utc).isoformat(),
                      "status": "running", "forecast_status": "running", "positions": {}, "last_success_at": previous.get("last_success_at"),
                      "forecast_updated_at": previous.get("forecast_updated_at"),
                      "season": previous.get("season"), "week": previous.get("week")}
            def save():
                temp = STATUS_PATH.with_suffix(".tmp")
                temp.write_text(json.dumps(status), encoding="utf-8")
                temp.replace(STATUS_PATH)
            save()
            try:
                feed = get_injury_poll_status()
                poll = (run_injury_poll(force=force, recompute_overlays=False, trigger="forecast_background")
                        if force or feed.get("poll_due") else {"status": "ok"})
                if poll.get("status") == "already_running":
                    # Another input poll owns the feed. Wait for its saved
                    # publication instead of declaring normal contention failed.
                    status.update(status="inputs_updating", completed_epoch=time.time())
                    save()
                    return status
                if poll.get("status") != "ok":
                    raise RuntimeError("Player input refresh did not complete")
                state = get_nfl_state(use_cache=True)
                season, week = int(state["season"]), int(state.get("week") or 1)
                if state.get("season_type") != "regular" or not 1 <= week <= 18:
                    status["status"] = "offseason"
                    status["completed_epoch"] = time.time()
                    save()
                    return status
                status.update(season=season, week=week)
                dfs_inputs.prepare_sources(season)
                revision = dfs_inputs.input_revision(season, week)
                reuse_source = previous
                reuse = not force and dfs_inputs.can_reuse(reuse_source, revision, season, week,
                    now=time.time(), max_age=DFS_FORECAST_MAX_AGE_SECONDS)
                if not reuse and not force:
                    from src.jobs.season_refresh import read_status, target_key
                    shared = read_status().get(target_key("weekly", season, week), {})
                    if dfs_inputs.can_reuse(shared, revision, season, week,
                            now=time.time(), max_age=DFS_FORECAST_MAX_AGE_SECONDS):
                        reuse_source, reuse = shared, True
                annotate_job(season=season, week=week, force=not reuse, input_revision=revision,
                             cache_hit=reuse)
                if not reuse:
                    dfs_inputs.invalidate_forecast_memory(season)
                computed_epoch = reuse_source["forecast_reuse"]["computed_epoch"] if reuse else time.time()
                errors = []
                skill_predictions = {True: {}, False: {}}
                for position in ("qb", "rb", "wr"):
                    try:
                        frame = call_phase(f"weekly_{position}_inj", load_weekly_prediction, position, season, week,
                            force=not reuse, allow_compute=not reuse, apply_identity=False)
                        raw = call_phase(f"weekly_{position}_raw", load_weekly_prediction, position, season, week, apply_injury_adjustments=False,
                                                     force=not reuse, allow_compute=not reuse, apply_identity=False)
                        if frame.empty or raw.empty:
                            raise RuntimeError("Empty projection output")
                        skill_predictions[True][position] = frame
                        skill_predictions[False][position] = raw
                        status["positions"][position] = {"rows": len(frame), "built_at": frame.attrs.get("built_at")}
                    except Exception as exc:
                        errors.append(position)
                        logger.exception("DFS refresh failed for %s", position)
                try:
                    from src.projections.dfs_pool import refresh_dfs_pool
                    def stable_inputs():
                        if dfs_inputs.input_revision(season, week) != revision:
                            raise RuntimeError("DFS inputs changed during forecast refresh")
                        if reuse and dfs_inputs.output_revisions(season, week) != reuse_source["forecast_reuse"]["outputs"]:
                            raise RuntimeError("DFS saved forecasts changed during reuse")
                    stable_inputs()
                    status["positions"]["dfs"] = call_phase("pool", refresh_dfs_pool, season, week,
                        skill_predictions=skill_predictions, validate_inputs=stable_inputs)
                    if status["positions"]["dfs"].get("historical_inputs_only"):
                        errors.append("dfs_current_season_history")
                    if status["positions"]["dfs"].get("special_history_refresh_failed"):
                        errors.append("dfs_history_refresh")
                except Exception:
                    errors.append("dfs")
                    logger.exception("Deep DFS projection refresh failed")
                if not any(position in errors for position in dfs_inputs.POSITIONS):
                    stable_inputs()
                    outputs = dfs_inputs.output_revisions(season, week)
                    if outputs is not None:
                        status["forecast_reuse"] = {"version": dfs_inputs.VERSION, "revision": revision,
                            "outputs": outputs, "computed_epoch": computed_epoch}
                    if not reuse:
                        _warm_supporting_data(season, week)
                        status["forecast_updated_at"] = datetime.now(timezone.utc).isoformat()
                    else:
                        status["forecast_updated_at"] = reuse_source.get("forecast_updated_at") or reuse_source.get("last_success_at")
                    status["forecast_status"] = "ok"
                status["forecasts_reused"] = reuse
                if errors:
                    raise RuntimeError("Projection refresh failed: " + ", ".join(errors))
                status["status"] = "ok"
                status["last_success_at"] = datetime.now(timezone.utc).isoformat()
            except Exception as exc:
                if status.get("forecast_status") != "ok":
                    status["forecast_status"] = "error"
                status.update(status="error", error=str(exc))
                logger.exception("DFS data refresh failed")
            status["completed_epoch"] = time.time()
            save()
            return status
    except RefreshBusy:
        return {"status": "already_running"}


def refresh_status():
    try:
        result = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        result = {"status": "not_started"}
    if not isinstance(result, dict):
        result = {"status": "not_started"}
    public = {k: result[k] for k in ("status", "started_at", "last_success_at", "positions", "season", "week", "forecasts_reused") if k in result}
    success = result.get("last_success_at")
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(success)).total_seconds()
    except (ValueError, TypeError):
        age = None
    public["stale"] = age is None or age > DFS_REFRESH_SECONDS * 2
    public["refresh_interval_seconds"] = DFS_REFRESH_SECONDS
    public["forecast_max_age_seconds"] = DFS_FORECAST_MAX_AGE_SECONDS
    return public
