"""Map nflverse specialist box scores into native league scoring fields."""
from __future__ import annotations

import logging
import math
from typing import Any

import pandas as pd

from src.core.team_codes import normalize_team_for_match

logger = logging.getLogger(__name__)


def _number(row: Any, key: str) -> float | None:
    try:
        value = float(row[key])
    except (KeyError, TypeError, ValueError):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def normalize_kicking_stats(row: Any) -> dict[str, float | None]:
    result = {}
    long_makes = _number(row, "fg_made_60_")
    if long_makes is not None:
        result["fg_made_60_plus"] = long_makes
    # nflverse separates blocked attempts from misses. Both are unsuccessful
    # kicks under the league's missed-kick setting.
    for kind in ("fg", "pat"):
        missed, blocked = _number(row, f"{kind}_missed"), _number(row, f"{kind}_blocked")
        result[f"{kind}_missed"] = missed + blocked if missed is not None and blocked is not None else None
    return result


def build_defense_stat_index(frame: pd.DataFrame, schedules: pd.DataFrame, season: int, week: int) -> dict[str, dict]:
    required = {"season", "week", "season_type", "team", "opponent_team", "game_id"}
    if frame.empty or not required.issubset(frame.columns):
        return {}
    selected = frame.loc[(pd.to_numeric(frame["season"], errors="coerce") == season)
                         & (pd.to_numeric(frame["week"], errors="coerce") == week)
                         & (frame["season_type"].astype(str).str.upper() == "REG")]
    # Ambiguous provider rows must not silently overwrite one another.
    if selected.duplicated(["game_id", "team"]).any():
        return {}
    teams = {(str(row["game_id"]), normalize_team_for_match(row["team"])): row
             for _, row in selected.iterrows()}
    games = {}
    if {"game_id", "home_team", "away_team", "home_score", "away_score"}.issubset(schedules.columns):
        games = {str(row["game_id"]): row for _, row in schedules.iterrows()}
    index = {}
    mappings = {
        "def_sacks": ("def_sacks",),
        "def_interceptions": ("def_interceptions",),
        "def_fumble_recoveries": ("fumble_recovery_opp",),
        "def_touchdowns": ("def_tds", "special_teams_tds"),
        "def_safeties": ("def_safeties",),
        "def_blocked_kicks": ("def_punt_blocks", "def_pat_blocks", "def_fg_blocks"),
        "def_2pt_returns": ("def_2pt_made",),
    }
    for (game_id, team), row in teams.items():
        stats = {}
        for target, sources in mappings.items():
            values = [_number(row, source) for source in sources]
            if all(value is not None for value in values):
                stats[target] = sum(values)
        opponent_code = normalize_team_for_match(row["opponent_team"])
        opponent = teams.get((game_id, opponent_code))
        game = games.get(game_id)
        if opponent is not None and game is not None:
            home, away = normalize_team_for_match(game["home_team"]), normalize_team_for_match(game["away_team"])
            score_key = "away_score" if (team, opponent_code) == (home, away) else "home_score" if (team, opponent_code) == (away, home) else None
            score = _number(game, score_key) if score_key else None
            # D/ST points allowed excludes opponent defensive TDs, safeties,
            # and defensive conversion returns. PATs and return TDs count.
            excluded = [_number(opponent, key) for key in ("def_tds", "def_safeties", "def_2pt_made")]
            if score is not None and all(value is not None for value in excluded):
                allowed = score - 6 * excluded[0] - 2 * excluded[1] - 2 * excluded[2]
                if allowed >= 0:
                    stats["def_points_allowed"] = allowed
        index[team] = stats
    for alias, canonical in {"JAC": "JAX", "WSH": "WAS", "LAR": "LA", "LVR": "LV", "OAK": "LV"}.items():
        if canonical in index:
            index[alias] = index[canonical]
    for team, stats in list(index.items()):
        index[f"sleeper-{team}"] = stats
    return index


def load_defense_stat_index(season: int, week: int) -> dict[str, dict]:
    from src.etl.nflverse_etl import load_schedules

    try:
        frame = pd.read_parquet(
            "https://github.com/nflverse/nflverse-data/releases/download/"
            f"stats_team/stats_team_week_{int(season)}.parquet"
        )
        # Load current scores, not the projection schedule cache, which may
        # have been created before kickoff and contain null final scores.
        return build_defense_stat_index(frame, load_schedules([int(season)]), int(season), int(week))
    except Exception:
        logger.warning("Native defense statistics unavailable for %s week %s", season, week, exc_info=True)
        return {}
