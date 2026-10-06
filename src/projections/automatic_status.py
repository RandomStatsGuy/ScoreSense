"""Disk-only publication revision and health for the existing status poll."""
from datetime import datetime, timezone
import math

from src.config import CACHE_DIR
from src.projections.artifact_snapshot import read_cached_metadata
from src.jobs.season_refresh import read_status, target_metadata
from src.projections.refresh_policy import timestamp


def _latest_attempt(weekly, scheduled):
    # Specialist failures remain in DFS; healthy shared skills stay healthy.
    weekly = {**weekly, "status": weekly.get("forecast_status", weekly.get("status"))}
    try:
        completed = float(weekly.get("completed_epoch") or 0)
    except (TypeError, ValueError):
        completed = 0
    weekly_at = timestamp(weekly.get("started_at"))
    scheduled_at = timestamp(scheduled.get("completed_at")) or timestamp(scheduled.get("started_at"))
    if math.isfinite(completed) and completed > 0:
        try:
            weekly_at = datetime.fromtimestamp(completed, timezone.utc)
        except (OverflowError, OSError, ValueError):
            pass
    return weekly if weekly_at and (not scheduled_at or weekly_at >= scheduled_at) else scheduled


def automatic_refresh_status():
    weekly = read_cached_metadata(CACHE_DIR / "dfs_refresh.json")
    season = read_status()
    stamps = [timestamp(weekly.get("forecast_updated_at"))]
    stamps.extend(timestamp(item.get("last_success_at")) for item in season.values())
    attempts = dict(season)
    if weekly.get("season") and weekly.get("week"):
        key = f"weekly:{weekly['season']}:{weekly['week']}"
        attempts[key] = _latest_attempt(weekly, attempts.get(key, {}))
    health = {}
    for key, attempt in attempts.items():
        try:
            kind, season_id, *weeks = key.split(":")
            if kind not in {"draft", "ros", "weekly"}:
                continue
            season_id, week = int(season_id), int(weeks[0]) if weeks else 1
        except (TypeError, ValueError):
            continue
        built = [timestamp(item.get("built_at")) for item in target_metadata(kind, season_id, week)]
        # Require every variant to be published before clearing a prior failure.
        earliest = min(built) if built and all(built) else None
        health[key] = forecast_refresh_health(kind, season_id, week, earliest.isoformat() if earliest else None,
                                               attempt=attempt)
    successes = [stamp for stamp in stamps if stamp]
    return {"last_success_at": max(successes).isoformat() if successes else None, "health": health}


def forecast_refresh_health(kind, season, week, built_at, dirty=False, *, attempt=None):
    from src.projections.refresh_policy import refresh_health
    from src.jobs.season_refresh import target_key
    if attempt is None:
        attempt = read_status().get(target_key(kind, season, week), {}) if season and week else {}
        if kind == "weekly":
            dfs = read_cached_metadata(CACHE_DIR / "dfs_refresh.json")
            if (dfs.get("season"), dfs.get("week")) == (season, week):
                attempt = _latest_attempt(dfs, attempt)
    # Archived forecasts have no running refresh deadline. Their source
    # fingerprint can change with today's inputs without invalidating history.
    try:
        from src.projections.projection_meta import get_projection_meta
        current = get_projection_meta("qb")
        from src.core.projection_context import is_nfl_offseason
        historical = (kind == "weekly" and is_nfl_offseason()) or season is not None and (int(season) < current["default_season"] or (
            kind != "draft" and int(season) == current["default_season"] and week is not None and int(week) < current["default_week"]))
    except (FileNotFoundError, KeyError, TypeError, ValueError):
        historical = False
    if historical and built_at:
        return {"needs_attention": False, "refresh_state": "archived", "automatic": False}
    return refresh_health(built_at=built_at, available=bool(built_at), dirty=dirty,
                          kind="weekly" if kind == "weekly" else "season", attempt=attempt)
