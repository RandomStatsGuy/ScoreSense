"""Target-week opponent defensive context (DvP) derived from mlready game rows.

The model's opponent_*_epa_allowed features come from each player's prior game
row and can describe a different defense than the scheduled opponent. These
helpers recompute defensive EPA allowed per team for the *target* week's
opponent so the UI can show accurate matchup context.
"""

from __future__ import annotations

import pandas as pd

from src.core.team_codes import normalize_team_to_mlready

# WR bucket includes TE; QB/WR matchups are pass-defense driven, RB rush-defense.
_PASS_POSITIONS = {"qb", "wr", "te", "rec", "wr_te"}

# Below this many distinct in-season weeks, blend in the latest prior season
# so early-season ranks are not driven by one or two games.
_MIN_CURRENT_WEEKS = 4

_EPA_COLS = ("opponent_pass_epa_allowed", "opponent_rush_epa_allowed")


def _metric_for_position(position: str) -> str:
    pos = str(position or "").lower()
    return "opponent_pass_epa_allowed" if pos in _PASS_POSITIONS else "opponent_rush_epa_allowed"


def defense_epa_table(features: pd.DataFrame, season: int, week: int) -> pd.DataFrame:
    """Per-defense mean EPA allowed from games played before season/week.

    Falls back to (or blends with) the latest prior season when the current
    season has too few weeks of data. Returns an empty frame when the feature
    columns are unavailable.
    """
    required = {"season", "week", "opponent", *_EPA_COLS}
    empty = pd.DataFrame(columns=["opponent", *_EPA_COLS])
    if not required.issubset(features.columns):
        return empty

    games = (
        features[list(required)]
        .dropna(subset=["opponent"])
        .drop_duplicates(subset=["season", "week", "opponent"])
    )
    games = games[games["opponent"].astype(str).str.len() > 0]

    current = games[(games["season"] == season) & (games["week"] < week)]
    sample = current
    if current.empty or current["week"].nunique() < _MIN_CURRENT_WEEKS:
        prior = games[games["season"] < season]
        if not prior.empty:
            last_season = int(prior["season"].max())
            sample = pd.concat(
                [prior[prior["season"] == last_season], current], ignore_index=True
            )
    if sample.empty:
        return empty

    agg = sample.groupby("opponent", as_index=False).agg(
        opponent_pass_epa_allowed=("opponent_pass_epa_allowed", "mean"),
        opponent_rush_epa_allowed=("opponent_rush_epa_allowed", "mean"),
    )
    agg["opponent"] = agg["opponent"].map(normalize_team_to_mlready)
    return agg


def attach_matchup_context(
    result: pd.DataFrame,
    features: pd.DataFrame,
    season: int,
    week: int,
    position: str,
) -> pd.DataFrame:
    """Add ``Opp Def EPA`` and ``Opp Def Rank`` (1 = toughest defense) per row.

    The rank uses the position-relevant metric (pass EPA allowed for QB/WR,
    rush EPA allowed for RB); higher ranks mean softer matchups. Rows without
    a ranked opponent (e.g. BYE) get nulls.
    """
    if result.empty or "Opponent" not in result.columns:
        return result
    table = defense_epa_table(features, season, week)
    if table.empty:
        return result

    metric = _metric_for_position(position)
    table = table.dropna(subset=[metric])
    if table.empty:
        return result

    ranks = table[metric].rank(method="min", ascending=True).astype(int)
    epa_map = dict(zip(table["opponent"], table[metric].round(3)))
    rank_map = dict(zip(table["opponent"], ranks))

    opp = result["Opponent"].astype(str).map(normalize_team_to_mlready)
    result["Opp Def EPA"] = opp.map(epa_map)
    result["Opp Def Rank"] = opp.map(rank_map)
    return result
