"""Current-week inference refresh with a five-minute completion gap. No training."""

from src.ops.job_diagnostics import observe_job, annotate_job, call_phase
import json
import logging
import time
from datetime import datetime, timezone

from src.config import CACHE_DIR, DFS_REFRESH_SECONDS
from src.jobs.refresh_lock import refresh_lock, RefreshBusy

STATUS_PATH = CACHE_DIR / "dfs_refresh.json"
logger = logging.getLogger(__name__)


@observe_job("dfs_refresh", cadence_s=DFS_REFRESH_SECONDS)
def run_dfs_refresh():
    from src.integrations.injury_poll import run_injury_poll
    from src.integrations.sleeper import get_nfl_state
    from src.projections.weekly_cache import load_weekly_prediction, invalidate_weekly_cache
    try:
        # Coordinate with the full pipeline and other API workers.
        with refresh_lock(CACHE_DIR / "last_refresh.lock"):
            try:
                previous = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                previous = {}
            # Legacy status files use the start time until their next completion.
            last_refresh_epoch = previous.get("completed_epoch", previous.get("attempt_epoch", 0))
            if 0 <= time.time() - last_refresh_epoch < DFS_REFRESH_SECONDS:
                return {**previous, "status": "not_due"}
            status = {"attempt_epoch": time.time(), "started_at": datetime.now(timezone.utc).isoformat(),
                      "status": "running", "positions": {}, "last_success_at": previous.get("last_success_at")}
            def save():
                temp = STATUS_PATH.with_suffix(".tmp")
                temp.write_text(json.dumps(status), encoding="utf-8")
                temp.replace(STATUS_PATH)
            save()
            try:
                poll = run_injury_poll(force=True, recompute_overlays=False, trigger="dfs_five_minute")
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
                annotate_job(season=season, week=week, force=True)
                invalidate_weekly_cache()
                errors = []
                skill_predictions = {True: {}, False: {}}
                for position in ("qb", "rb", "wr"):
                    try:
                        frame = call_phase(f"weekly_{position}_inj", load_weekly_prediction, position, season, week, force=True, apply_identity=False)
                        raw = call_phase(f"weekly_{position}_raw", load_weekly_prediction, position, season, week, apply_injury_adjustments=False,
                                                     force=True, apply_identity=False)
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
                    status["positions"]["dfs"] = call_phase("pool", refresh_dfs_pool, season, week, skill_predictions=skill_predictions)
                    if status["positions"]["dfs"].get("historical_inputs_only"):
                        errors.append("dfs_current_season_history")
                    if status["positions"]["dfs"].get("special_history_refresh_failed"):
                        errors.append("dfs_history_refresh")
                except Exception:
                    errors.append("dfs")
                    logger.exception("Deep DFS projection refresh failed")
                # Build depth coverage first, then warm the ROS artifacts used by Trades.
                from src.projections.ros_cache import load_ros_prediction
                for position in ("qb", "rb", "wr"):
                    try:
                        frame = call_phase(f"ros_{position}", load_ros_prediction, position, season, week)
                        if frame.empty:
                            raise RuntimeError("Empty ROS output")
                        status["positions"][f"ros_{position}"] = {"rows": len(frame), "built_at": frame.attrs.get("built_at")}
                    except Exception:
                        errors.append(f"ros_{position}")
                        logger.exception("ROS refresh failed for %s", position)
                if errors:
                    raise RuntimeError("Projection refresh failed: " + ", ".join(errors))
                status["status"] = "ok"
                status["last_success_at"] = datetime.now(timezone.utc).isoformat()
            except Exception as exc:
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
    public = {k: result[k] for k in ("status", "started_at", "last_success_at", "positions", "season", "week") if k in result}
    success = result.get("last_success_at")
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(success)).total_seconds()
    except (ValueError, TypeError):
        age = None
    public["stale"] = age is None or age > DFS_REFRESH_SECONDS * 2
    public["refresh_interval_seconds"] = DFS_REFRESH_SECONDS
    return public
