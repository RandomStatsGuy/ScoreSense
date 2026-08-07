"""Target-week opponent DvP context (defense_epa_table / attach_matchup_context)."""

import pandas as pd

from src.projections.matchup_context import attach_matchup_context, defense_epa_table


def _features(rows):
    return pd.DataFrame(
        rows,
        columns=[
            "season",
            "week",
            "opponent",
            "opponent_pass_epa_allowed",
            "opponent_rush_epa_allowed",
        ],
    )


def _mid_season_features():
    rows = []
    # 5 weeks of 2025 data: KC stingy vs pass, DEN soft vs pass, CHI middle.
    for wk in range(1, 6):
        rows.append([2025, wk, "KC", -0.20, 0.00])
        rows.append([2025, wk, "DEN", 0.25, -0.10])
        rows.append([2025, wk, "CHI", 0.05, 0.10])
    return _features(rows)


def test_defense_epa_table_uses_current_season_games_before_week():
    table = defense_epa_table(_mid_season_features(), season=2025, week=6)
    assert set(table["opponent"]) == {"KC", "DEN", "CHI"}
    kc = table[table["opponent"] == "KC"].iloc[0]
    assert kc["opponent_pass_epa_allowed"] == -0.20


def test_defense_epa_table_falls_back_to_prior_season_early():
    rows = [[2024, wk, team, epa, 0.0] for wk in range(1, 18) for team, epa in [("KC", -0.2), ("DEN", 0.25)]]
    rows.append([2025, 1, "KC", 0.9, 0.0])  # one noisy current-season game
    table = defense_epa_table(_features(rows), season=2025, week=2)
    # Prior-season sample blended in, so DEN is present despite no 2025 games.
    assert "DEN" in set(table["opponent"])


def test_defense_epa_table_missing_columns_returns_empty():
    table = defense_epa_table(pd.DataFrame({"season": [2025]}), season=2025, week=3)
    assert table.empty


def test_attach_matchup_context_ranks_pass_defense_for_qb():
    result = pd.DataFrame(
        {
            "Player": ["A", "B", "C"],
            "Opponent": ["KC", "DEN", "BYE"],
        }
    )
    out = attach_matchup_context(result, _mid_season_features(), season=2025, week=6, position="qb")
    kc_rank = out.loc[out["Opponent"] == "KC", "Opp Def Rank"].iloc[0]
    den_rank = out.loc[out["Opponent"] == "DEN", "Opp Def Rank"].iloc[0]
    # KC allows the least pass EPA -> rank 1 (toughest); DEN the most -> rank 3 (softest).
    assert kc_rank == 1
    assert den_rank == 3
    # BYE has no ranked opponent.
    assert pd.isna(out.loc[out["Opponent"] == "BYE", "Opp Def Rank"].iloc[0])


def test_attach_matchup_context_uses_rush_metric_for_rb():
    result = pd.DataFrame({"Player": ["A", "B"], "Opponent": ["KC", "DEN"]})
    out = attach_matchup_context(result, _mid_season_features(), season=2025, week=6, position="rb")
    kc_rank = out.loc[out["Opponent"] == "KC", "Opp Def Rank"].iloc[0]
    den_rank = out.loc[out["Opponent"] == "DEN", "Opp Def Rank"].iloc[0]
    # Rush EPA allowed: DEN -0.10 (toughest), KC 0.00 (middle of three).
    assert den_rank == 1
    assert kc_rank == 2


def test_attach_matchup_context_noop_without_opponent_column():
    result = pd.DataFrame({"Player": ["A"]})
    out = attach_matchup_context(result, _mid_season_features(), season=2025, week=6, position="qb")
    assert "Opp Def Rank" not in out.columns
