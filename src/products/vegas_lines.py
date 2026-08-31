"""Vegas lines readout for a week's slate — spreads, totals, implied team totals.

Sourced from the cached nflverse schedule (`schedule_utils`). Sign convention
per nflverse: a positive ``spread_line`` means the home team is favored by
that many points, so ``home_implied = (total_line + spread_line) / 2``.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from src.core.projection_context import REGULAR_SEASON_MAX_WEEK
from src.core.schedule_utils import _load_schedules, _parse_gametime
from src.core.team_codes import normalize_team_to_mlready

_ET = ZoneInfo("America/New_York")


def _to_float(value) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if pd.notna(out) else None


def _kickoff_et(gameday, gametime) -> str | None:
    day = pd.Timestamp(gameday) if gameday is not None else pd.NaT
    if pd.isna(day):
        return None
    date_et = day.tz_convert(_ET).date() if day.tzinfo is not None else day.date()
    hh, mm = _parse_gametime(gametime)
    return datetime(date_et.year, date_et.month, date_et.day, hh, mm, tzinfo=_ET).isoformat()


def _implied_totals(spread: float | None, total: float | None) -> tuple[float | None, float | None]:
    """(home_implied, away_implied) from a home-relative spread and game total."""
    if spread is None or total is None:
        return None, None
    home = round((total + spread) / 2, 1)
    away = round((total - spread) / 2, 1)
    return home, away


def build_vegas_board(
    season: int,
    week: int,
    schedules: pd.DataFrame | None = None,
) -> dict:
    """One week of games with spread, total, moneylines, and implied team totals."""
    season = int(season)
    week = int(week)
    if schedules is None:
        schedules = _load_schedules([season])

    games_df = schedules[
        (schedules["season"] == season)
        & (schedules["week"] == week)
        & (schedules["week"] <= REGULAR_SEASON_MAX_WEEK)
    ]

    games: list[dict] = []
    teams: dict[str, dict] = {}
    for row in games_df.to_dict(orient="records"):
        home_raw = str(row.get("home_team") or "").upper()
        away_raw = str(row.get("away_team") or "").upper()
        if not home_raw or not away_raw:
            continue
        home = normalize_team_to_mlready(home_raw)
        away = normalize_team_to_mlready(away_raw)

        spread = _to_float(row.get("spread_line"))
        total = _to_float(row.get("total_line"))
        home_implied, away_implied = _implied_totals(spread, total)
        favorite = None
        if spread is not None and spread != 0:
            favorite = home if spread > 0 else away

        game = {
            "game_id": str(row.get("game_id") or f"{season}_{week}_{away}_{home}"),
            "kickoff_et": _kickoff_et(row.get("gameday"), row.get("gametime")),
            "weekday": str(row.get("weekday") or "") or None,
            "away": away,
            "home": home,
            "spread_line": spread,
            "total_line": total,
            "away_moneyline": _to_float(row.get("away_moneyline")),
            "home_moneyline": _to_float(row.get("home_moneyline")),
            "home_implied": home_implied,
            "away_implied": away_implied,
            "favorite": favorite,
        }
        games.append(game)

        for team, opponent, implied, is_home in (
            (home, away, home_implied, True),
            (away, home, away_implied, False),
        ):
            team_spread = None
            if spread is not None:
                team_spread = -spread if is_home else spread
            teams[team] = {
                "opponent": opponent,
                "is_home": is_home,
                "implied_total": implied,
                "total_line": total,
                # Team-relative line as a book would quote it (negative = favored).
                "spread": team_spread,
                "kickoff_et": game["kickoff_et"],
            }

    games.sort(key=lambda g: (g["kickoff_et"] or "9999", g["game_id"]))
    with_lines = sum(1 for g in games if g["total_line"] is not None)
    return {
        "season": season,
        "week": week,
        "count": len(games),
        "with_lines": with_lines,
        "games": games,
        "teams": teams,
    }
