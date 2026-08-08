"""NFL schedule helpers — bye weeks and team game context."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

from src.config import CACHE_DIR, DATA_DIR
from src.core.projection_context import REGULAR_SEASON_MAX_WEEK
from src.core.team_codes import normalize_team_to_mlready, normalize_team_to_schedule

SCHEDULE_CACHE = CACHE_DIR / "nfl_schedules.parquet"


def _load_schedules(seasons: list[int] | None = None) -> pd.DataFrame:
    if SCHEDULE_CACHE.exists():
        try:
            cached = pd.read_parquet(SCHEDULE_CACHE)
            if seasons:
                cached = cached[cached["season"].isin(seasons)]
            if not cached.empty:
                return cached
        except Exception:
            pass

    from src.etl.nflverse_etl import load_schedules

    if seasons is None:
        seasons = list(range(2018, 2027))
    schedules = load_schedules(seasons)
    SCHEDULE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    schedules.to_parquet(SCHEDULE_CACHE, index=False)
    return schedules


def regular_season_weeks(season: int) -> list[int]:
    schedules = _load_schedules([season])
    reg = schedules[
        (schedules["season"] == season) & (schedules["week"] <= REGULAR_SEASON_MAX_WEEK)
    ]
    if reg.empty:
        return list(range(1, REGULAR_SEASON_MAX_WEEK + 1))
    return sorted(int(w) for w in reg["week"].unique())


def week_matchups(season: int, week: int) -> dict[str, str]:
    """Map mlready team code -> opponent team code for a regular-season week."""
    schedules = _load_schedules([season])
    reg = schedules[
        (schedules["season"] == season)
        & (schedules["week"] == week)
        & (schedules["week"] <= REGULAR_SEASON_MAX_WEEK)
    ]
    matchups: dict[str, str] = {}
    for _, row in reg.iterrows():
        home = normalize_team_to_mlready(str(row["home_team"]))
        away = normalize_team_to_mlready(str(row["away_team"]))
        matchups[home] = away
        matchups[away] = home
    return matchups


def attach_schedule_context(roster: pd.DataFrame, season: int, week: int) -> pd.DataFrame:
    """Set opponent from schedule; mark bye weeks."""
    out = roster.copy()
    matchups = week_matchups(season, week)
    bye = teams_on_bye(season, week)

    def _opp(team: str) -> str:
        team_ml = normalize_team_to_mlready(str(team or "").upper())
        sched_key = normalize_team_to_schedule(team_ml)
        if sched_key in {normalize_team_to_schedule(t) for t in bye} or team_ml in bye:
            return "BYE"
        return matchups.get(team_ml, matchups.get(sched_key, ""))

    if "team" in out.columns:
        out["opponent"] = out["team"].map(_opp)
        out["on_bye"] = out["opponent"].eq("BYE")
    return out


@lru_cache(maxsize=128)
def teams_playing_week(season: int, week: int) -> frozenset[str]:
    schedules = _load_schedules([season])
    reg = schedules[
        (schedules["season"] == season)
        & (schedules["week"] == week)
        & (schedules["week"] <= REGULAR_SEASON_MAX_WEEK)
    ]
    if reg.empty:
        return frozenset()
    teams = set(reg["home_team"].astype(str).str.upper()) | set(
        reg["away_team"].astype(str).str.upper()
    )
    return frozenset(t for t in teams if t and t != "NAN")


def teams_on_bye(season: int, week: int) -> set[str]:
    """Teams without a scheduled game in this regular-season week."""
    playing = teams_playing_week(season, week)
    if not playing:
        return set()

    schedules = _load_schedules([season])
    all_teams = set(schedules[schedules["season"] == season]["home_team"].astype(str).str.upper()) | set(
        schedules[schedules["season"] == season]["away_team"].astype(str).str.upper()
    )
    all_teams = {t for t in all_teams if t and t != "NAN"}
    return all_teams - set(playing)


def attach_bye_flags(pool: pd.DataFrame, season: int, week: int) -> pd.DataFrame:
    out = pool.copy()
    try:
        bye = teams_on_bye(season, week)
    except Exception:
        bye = set()
    out["on_bye"] = out["Team"].astype(str).str.upper().isin(bye)
    return out


def team_game_kickoffs(season: int, team: str) -> pd.DataFrame:
    """Regular-season kickoff times for one team, sorted by week."""
    team = str(team).upper()
    schedules = _load_schedules([season])
    reg = schedules[
        (schedules["season"] == season)
        & (schedules["week"] <= REGULAR_SEASON_MAX_WEEK)
    ].copy()
    if reg.empty:
        return pd.DataFrame(columns=["season", "week", "team", "gameday"])

    home = reg[["season", "week", "home_team", "gameday"]].rename(columns={"home_team": "team"})
    away = reg[["season", "week", "away_team", "gameday"]].rename(columns={"away_team": "team"})
    games = pd.concat([home, away], ignore_index=True)
    games["team"] = games["team"].astype(str).str.upper()
    games["gameday"] = pd.to_datetime(games["gameday"], utc=True)
    games = games[games["team"] == team].sort_values("week").drop_duplicates(subset=["week"], keep="first")
    return games.reset_index(drop=True)


def map_publish_time_to_week(team: str, published_at: pd.Timestamp, season: int) -> int | None:
    """
    Map a video publish time to the target NFL week for that team.

    Window: [prev_game_kickoff, current_game_kickoff) -> current week.
    """
    if pd.isna(published_at):
        return None
    published_at = pd.Timestamp(published_at)
    if published_at.tzinfo is None:
        published_at = published_at.tz_localize("UTC")
    else:
        published_at = published_at.tz_convert("UTC")

    games = team_game_kickoffs(season, team)
    if games.empty:
        return None

    prev_kick = None
    for _, row in games.iterrows():
        kick = pd.Timestamp(row["gameday"])
        if kick.tzinfo is None:
            kick = kick.tz_localize("UTC")
        week = int(row["week"])
        if prev_kick is None:
            if published_at < kick:
                return week
        elif prev_kick <= published_at < kick:
            return week
        prev_kick = kick
    return None


@lru_cache(maxsize=64)
def _league_week_windows(season: int) -> tuple[tuple[int, pd.Timestamp, pd.Timestamp], ...]:
    """Per-week [start, end) windows for league-wide fantasy content (Tue before -> last kickoff)."""
    schedules = _load_schedules([season])
    reg = schedules[
        (schedules["season"] == season) & (schedules["week"] <= REGULAR_SEASON_MAX_WEEK)
    ].copy()
    if reg.empty:
        return tuple()
    reg["gameday"] = pd.to_datetime(reg["gameday"], utc=True)
    windows: list[tuple[int, pd.Timestamp, pd.Timestamp]] = []
    for week in sorted(int(w) for w in reg["week"].unique()):
        games = reg[reg["week"] == week]
        first_kick = pd.Timestamp(games["gameday"].min())
        last_kick = pd.Timestamp(games["gameday"].max())
        if first_kick.tzinfo is None:
            first_kick = first_kick.tz_localize("UTC")
        if last_kick.tzinfo is None:
            last_kick = last_kick.tz_localize("UTC")
        start = first_kick - pd.Timedelta(days=6)
        end = last_kick + pd.Timedelta(hours=12)
        windows.append((week, start, end))
    return tuple(windows)


def _parse_gametime(val: object) -> tuple[int, int]:
    text = str(val or "").strip()
    if not text or ":" not in text:
        return 0, 0
    try:
        hh_s, mm_s = text.split(":", 1)
        return max(0, min(23, int(hh_s))), max(0, min(59, int(mm_s)))
    except (TypeError, ValueError):
        return 0, 0


def week_last_kickoff_et(season: int, week: int) -> datetime | None:
    """Latest kickoff (America/New_York) for a regular-season week."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    et = ZoneInfo("America/New_York")
    schedules = _load_schedules([season])
    games = schedules[
        (schedules["season"] == season)
        & (schedules["week"] == int(week))
        & (schedules["week"] <= REGULAR_SEASON_MAX_WEEK)
    ]
    if games.empty:
        return None
    latest: datetime | None = None
    for _, row in games.iterrows():
        day = pd.Timestamp(row["gameday"])
        if pd.isna(day):
            continue
        if day.tzinfo is not None:
            date_et = day.tz_convert(et).date()
        else:
            date_et = day.date()
        hh, mm = _parse_gametime(row.get("gametime"))
        kick = datetime(date_et.year, date_et.month, date_et.day, hh, mm, tzinfo=et)
        if latest is None or kick > latest:
            latest = kick
    return latest


def week_rollover_at_et(season: int, week: int) -> datetime | None:
    """
    When the projection board advances past this week.

    Rolls at 12:00 AM Eastern at the end of Monday night (Tuesday 00:00 ET)
    after that week's last kickoff.
    """
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    et = ZoneInfo("America/New_York")
    last = week_last_kickoff_et(season, week)
    if last is None:
        return None
    local = last.astimezone(et)
    days_to_tue = (1 - local.weekday()) % 7  # Monday=0 … Tuesday=1
    if days_to_tue == 0:
        # Last kickoff is already on Tuesday — next board flip is the following Tuesday.
        candidate = local.replace(hour=0, minute=0, second=0, microsecond=0)
        if local >= candidate:
            candidate = candidate + timedelta(days=7)
        return candidate
    target = local + timedelta(days=days_to_tue)
    return datetime(target.year, target.month, target.day, 0, 0, 0, tzinfo=et)


def current_projection_week(
    season: int,
    *,
    now: datetime | None = None,
) -> int | None:
    """
    Next regular-season week that still has football to play / is the active slate.

    Advances at Tuesday 00:00 ET after each week's Monday Night Football.
    Returns None when the regular season has fully rolled over.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo

    et = ZoneInfo("America/New_York")
    now_et = (now or datetime.now(et)).astimezone(et)
    weeks = regular_season_weeks(season)
    for week in weeks:
        rollover = week_rollover_at_et(season, week)
        if rollover is None:
            continue
        if now_et < rollover:
            return int(week)
    return None


def map_publish_time_to_league_week(published_at: pd.Timestamp, season: int) -> int | None:
    """Map league-wide fantasy content to NFL week using schedule windows."""
    if pd.isna(published_at):
        return None
    published_at = pd.Timestamp(published_at)
    if published_at.tzinfo is None:
        published_at = published_at.tz_localize("UTC")
    else:
        published_at = published_at.tz_convert("UTC")
    for week, start, end in _league_week_windows(season):
        if start <= published_at < end:
            return week
    return None
