"""Forecast age and refresh health are separate from input invalidation."""
from datetime import datetime, timezone
from src.config import SEASON_AUTO_REFRESH_SECONDS, WEEKLY_AUTO_REFRESH_SECONDS


def timestamp(value):
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result
    except (ValueError, TypeError):
        return None


def refresh_health(*, built_at, available, dirty=False, kind="season", attempt=None, now=None):
    interval = WEEKLY_AUTO_REFRESH_SECONDS if kind == "weekly" else SEASON_AUTO_REFRESH_SECONDS
    clock = now or datetime.now(timezone.utc)
    built = timestamp(built_at)
    age = max(0, (clock - built).total_seconds()) if built else None
    attempt = attempt or {}
    attempted = timestamp(attempt.get("started_at"))
    # Ignore a failure replaced by a later successful publication.
    finished = timestamp(attempt.get("completed_at")) or attempted
    failed = attempt.get("status") == "error" and (not built or not finished or finished >= built)
    running = attempt.get("status") == "running" and attempted and (clock - attempted).total_seconds() < 3600
    overdue = not available or age is None or age > interval + (1800 if kind == "weekly" else 3600)
    attention = bool(failed or (overdue and not running))
    state = ("failed" if failed else "overdue" if attention else "updating" if running
             else "scheduled" if dirty or age is None or age >= interval else "current")
    return {"refresh_state": state, "needs_attention": attention,
            "refresh_interval_seconds": interval, "automatic": True}
