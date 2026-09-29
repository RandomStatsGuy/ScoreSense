"""Five-minute current-week inference refresh. No training or historical ETL."""
import json
import logging
import time
from datetime import datetime, timezone

from src.config import CACHE_DIR, DFS_REFRESH_SECONDS
from src.jobs.refresh_lock import refresh_lock, RefreshBusy

STATUS_PATH = CACHE_DIR / "dfs_refresh.json"
logger = logging.getLogger(__name__)


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
            if 0 <= time.time() - previous.get("attempt_epoch", 0) < DFS_REFRESH_SECONDS:
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
                    save()
                    return status
                status.update(season=season, week=week)
                invalidate_weekly_cache()
                errors = []
                for position in ("qb", "rb", "wr"):
                    try:
                        frame = load_weekly_prediction(position, season, week, force=True)
                        load_weekly_prediction(position, season, week, apply_injury_adjustments=False, force=True)
                        if frame.empty:
                            raise RuntimeError("Empty projection output")
                        status["positions"][position] = {"rows": len(frame), "built_at": frame.attrs.get("built_at")}
                    except Exception as exc:
                        errors.append(position)
                        logger.exception("DFS refresh failed for %s", position)
                try:
                    from src.projections.dfs_pool import refresh_dfs_pool
                    status["positions"]["dfs"] = refresh_dfs_pool(season, week)
                    if status["positions"]["dfs"].get("historical_inputs_only"):
                        errors.append("dfs_current_season_history")
                except Exception:
                    errors.append("dfs")
                    logger.exception("Deep DFS projection refresh failed")
                if errors:
                    raise RuntimeError("Projection refresh failed: " + ", ".join(errors))
                status["status"] = "ok"
                status["last_success_at"] = datetime.now(timezone.utc).isoformat()
            except Exception as exc:
                status.update(status="error", error=str(exc))
                logger.exception("DFS data refresh failed")
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
