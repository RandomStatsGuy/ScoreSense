"""Home's Wednesday matchup window, independent of projection-board rollover."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from src.core.schedule_utils import _load_schedules, schedule_kickoff_utc

ET = ZoneInfo("America/New_York")


def home_matchup_window(season: int, *, now: datetime | None = None) -> dict | None:
    """Retain results through Tuesday; use the next slate from Wednesday ET.

    Never advance before a delayed scheduled game has had its playing window.
    Outside the season retain the final regular-season week; never invent week 19.
    Missing schedule data is unavailable, not a guessed opponent/week.
    """
    clock = now or datetime.now(ET)
    if clock.tzinfo is None:
        raise ValueError("Home matchup time must include a timezone")
    clock = clock.astimezone(ET)
    schedule = _load_schedules([int(season)])
    if schedule.empty:
        return None
    games = schedule[(schedule["season"] == int(season)) & schedule["week"].between(1, 18)]
    if "game_type" in games.columns:
        games = games[games["game_type"] == "REG"]
    windows = []
    for week, rows in games.groupby("week", sort=True):
        kicks = [schedule_kickoff_utc(row["gameday"], row.get("gametime")) for _, row in rows.iterrows()]
        kicks = [kick.to_pydatetime().astimezone(ET) for kick in kicks if kick is not None]
        if not kicks:
            continue
        first, last = min(kicks), max(kicks)
        # The next Wednesday after this week's opening kickoff is the handoff.
        days = (2 - first.weekday()) % 7 or 7
        rollover = (first + timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
        rollover = max(rollover, last + timedelta(hours=6))
        windows.append((int(week), first, rollover))
    if not windows:
        return None
    selected = next((window for window in windows if clock < window[2]), windows[-1])
    return {"week": selected[0], "home_display_mode": "projected" if clock < selected[1] else "scores"}
