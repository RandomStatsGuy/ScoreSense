"""Pure joins for target-game market context; never fetches data."""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.core.team_codes import normalize_team_for_match

MARKET_COLS = ["game_implied_team_total", "game_total_line", "game_spread"]


def attach_game_market(rows: pd.DataFrame, schedules: pd.DataFrame) -> pd.DataFrame:
    """Positive nflverse spread means home favored: home total=(total+spread)/2.

    Historical lines are per-game closing proxies, not archived Thursday boards.
    Missing lines stay missing so inference can use its qualified reference head.
    """
    out = rows.drop(columns=MARKET_COLS, errors="ignore").copy()
    if schedules.empty or not {"season", "week", "home_team", "away_team"}.issubset(schedules.columns):
        for col in MARKET_COLS:
            out[col] = np.nan
        return out
    schedules = schedules.copy()
    for col in ("spread_line", "total_line"):
        if col not in schedules:
            schedules[col] = np.nan
    if "game_type" in schedules:
        schedules = schedules[schedules.game_type.isin(["REG", "POST", "WC", "DIV", "CON", "SB"])]
    frames = []
    for team_col, sign in (("home_team", 1.), ("away_team", -1.)):
        frame = schedules[["season", "week", team_col, "spread_line", "total_line"]].copy()
        frame["_market_team"] = frame[team_col].map(normalize_team_for_match)
        frame["game_spread"] = pd.to_numeric(frame.spread_line, errors="coerce").replace([np.inf, -np.inf], np.nan) * sign
        frame["game_total_line"] = pd.to_numeric(frame.total_line, errors="coerce").replace([np.inf, -np.inf], np.nan)
        frame["game_implied_team_total"] = (frame.game_total_line + frame.game_spread) / 2.
        frames.append(frame[["season", "week", "_market_team", *MARKET_COLS]])
    market = pd.concat(frames, ignore_index=True)
    keys = ["season", "week", "_market_team"]
    if market.duplicated(keys).any():
        raise ValueError("Market schedule contains multiple games for a team/week")
    out["_market_team"] = out.team.map(normalize_team_for_match)
    out["_market_order"] = np.arange(len(out))
    out = out.merge(market, on=keys, how="left", validate="many_to_one").sort_values("_market_order")
    out.index = rows.index
    return out.drop(columns=["_market_team", "_market_order"])


def missing_market(rows: pd.DataFrame) -> pd.Series:
    """Invalid/absent quotes cannot stand in for a zero scoring expectation."""
    values = rows.reindex(columns=MARKET_COLS).apply(pd.to_numeric, errors="coerce")
    return ~np.isfinite(values).all(axis=1) | values.game_total_line.le(0) | values.game_implied_team_total.le(0)
