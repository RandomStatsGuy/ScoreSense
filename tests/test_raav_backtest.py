"""SCORE-3: unit tests for RAAV risk_z calibration helpers."""

from __future__ import annotations

import pandas as pd

from src.analytics.raav_backtest import _weekly_actual_variance
from src.draft_hub.auction_values import risk_z_scores, season_cv
from src.draft_hub.schemas import LeagueRules


def test_weekly_actual_variance_aggregates_by_player():
    df = pd.DataFrame(
        {
            "season": [2024] * 6,
            "week": [1, 2, 3, 1, 2, 3],
            "player_id": ["a", "a", "a", "b", "b", "b"],
            "Fpts": [10.0, 12.0, 14.0, 5.0, 25.0, 15.0],
        }
    )
    out = _weekly_actual_variance(df, 2024)
    by_id = {r["player_id"]: r for r in out.to_dict("records")}
    assert by_id["a"]["games_played"] == 3
    assert by_id["a"]["weekly_std"] < by_id["b"]["weekly_std"]


def test_high_cv_maps_to_higher_risk_z():
    cvs = [
        season_cv(190, 210, 230),  # tight
        season_cv(140, 210, 280),  # wide
        season_cv(160, 210, 250),  # mid
    ]
    zs = risk_z_scores(cvs)
    assert zs[1] > zs[0]
    assert zs[1] > zs[2]


def test_league_rules_risk_tolerance_bounds():
    assert LeagueRules().risk_tolerance == 0.0
    assert LeagueRules(risk_tolerance=-1.0).risk_tolerance == -1.0
    assert LeagueRules(risk_tolerance=1.0).risk_tolerance == 1.0
    try:
        LeagueRules(risk_tolerance=1.5)
        raised = False
    except Exception:
        raised = True
    assert raised
