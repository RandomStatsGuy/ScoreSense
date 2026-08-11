"""Auction fair value calibration tests."""

import pandas as pd

from src.draft_hub.auction_values import (
    RISK_WEIGHT,
    auction_relevant_count,
    build_player_values,
    fair_auction_value,
    risk_adjusted_auction_value,
    risk_z_scores,
    season_cv,
    upside_skew,
)
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


def _rules():
    return load_preset("salary_cap_auction_v1")


def test_top_wr_fair_value_10_team():
    rules = _rules()
    fair = fair_auction_value(0, auction_relevant_count("WR", 10, rules), "WR", rules, team_count=10)
    assert fair >= 30
    assert fair <= 50


def test_top_wr_higher_in_smaller_league():
    rules = _rules()
    small = fair_auction_value(0, auction_relevant_count("WR", 10, rules), "WR", rules, team_count=10)
    large = fair_auction_value(0, auction_relevant_count("WR", 14, rules), "WR", rules, team_count=14)
    assert small > large


def test_top_five_wr_above_25():
    rules = _rules()
    n = auction_relevant_count("WR", 10, rules)
    for rank in range(5):
        assert fair_auction_value(rank, n, "WR", rules, team_count=10) >= 25 - rank * 4


def test_qb_relevant_includes_roster_minimum():
    """Leagues that require 2 QBs should price more than starter*teams QBs."""
    rules = _rules()
    # Force a 2-QB minimum like the live cap league.
    roster = dict(rules.roster or {})
    qb = dict(roster.get("qb") or {})
    qb.update({"starter": 1, "min": 2, "max": 4})
    roster["qb"] = qb
    rules = rules.model_copy(update={"roster": roster})
    n = auction_relevant_count("QB", 10, rules)
    assert n >= 18
    # Rank 14 (e.g. Lamar in a noisy pool) still gets a non-min bid.
    assert fair_auction_value(14, n, "QB", rules, team_count=10) > 1


def test_elite_below_cap_quarter():
    rules = _rules()
    cap = float(rules.salary_cap)
    for pos in ("QB", "RB", "WR", "TE"):
        n = auction_relevant_count(pos, 10, rules)
        fair = fair_auction_value(0, n, pos, rules, team_count=10)
        assert fair < cap * 0.25


def test_build_player_values_from_pool():
    rules = _rules()
    pool = pd.DataFrame([
        {"player_id": "w1", "Player": "Alpha", "Position": "WR", "Season Proj": 300},
        {"player_id": "w2", "Player": "Beta", "Position": "WR", "Season Proj": 250},
        {"player_id": "q1", "Player": "QB1", "Position": "QB", "Season Proj": 400},
    ])
    values = build_player_values(pool, rules, team_count=10)
    assert values["w1"]["fair_value"] > values["w2"]["fair_value"]
    assert values["w1"]["min_sal"] <= values["w1"]["fair_value"] <= values["w1"]["max_sal"]


def test_fair_value_for_te_falls_back_to_wr_pool():
    from src.draft_hub.auction_values import fair_value_for_row

    rules = _rules()
    pool = pd.DataFrame([
        {"player_id": "00-0036970", "Player": "Kyle Pitts", "Position": "WR", "Season Proj": 180},
        {"player_id": "w2", "Player": "Alpha WR", "Position": "WR", "Season Proj": 300},
    ])
    te_row = {"player_id": "00-0036970", "position": "TE", "salary": 12}
    fair = fair_value_for_row(te_row, pool, rules, team_count=10)
    assert fair is not None
    assert fair > 0


def test_upside_skew_matches_frontend_formula():
    # (280-210)/(210-140) = 70/70 = 1.0
    assert upside_skew(140, 210, 280) == 1.0
    # Boom/bust: (280-210)/(210-140) wait — (280-210)/(210-100)
    assert abs(upside_skew(100, 210, 280) - (70 / 110)) < 1e-9
    assert upside_skew(190, 210, 230) == 1.0
    assert upside_skew(None, 210, 280) is None
    assert upside_skew(210, 210, 280) is None  # zero downside


def test_season_cv_guards_nonpositive_p50():
    assert season_cv(140, 210, 280) == (280 - 140) / (2 * 210)
    assert season_cv(10, 0, 20) is None
    assert season_cv(10, -5, 20) is None


def test_risk_z_scores_within_group():
    zs = risk_z_scores([0.1, 0.2, 0.3, None])
    assert abs(sum(zs[:3])) < 1e-9  # zero-mean over finite values
    assert zs[3] == 0.0
    assert risk_z_scores([0.2, 0.2, 0.2]) == [0.0, 0.0, 0.0]


def test_build_player_values_neutral_risk_tolerance_keeps_raav_null():
    rules = _rules()
    assert float(rules.risk_tolerance) == 0.0
    pool = pd.DataFrame(
        [
            {
                "player_id": "safe",
                "Player": "Safe RB",
                "Position": "RB",
                "Season Proj": 210,
                "Season P10": 190,
                "Season P50": 210,
                "Season P90": 230,
            },
            {
                "player_id": "volatile",
                "Player": "Vol WR",
                "Position": "RB",
                "Season Proj": 210,
                "Season P10": 140,
                "Season P50": 210,
                "Season P90": 280,
            },
        ]
    )
    values = build_player_values(pool, rules, team_count=10)
    # Same median proj → tied ranks still get distinct risk_score from P10/P90 width.
    assert values["safe"]["risk_adjusted_value"] is None
    assert values["volatile"]["risk_adjusted_value"] is None
    assert values["volatile"]["risk_score"] > values["safe"]["risk_score"]


def test_build_player_values_aggressive_raises_high_risk_and_is_budget_neutral():
    rules = _rules().model_copy(update={"risk_tolerance": 1.0})
    pool = pd.DataFrame(
        [
            {
                "player_id": "safe",
                "Player": "Safe",
                "Position": "WR",
                "Season Proj": 220,
                "Season P10": 200,
                "Season P50": 220,
                "Season P90": 240,
            },
            {
                "player_id": "mid",
                "Player": "Mid",
                "Position": "WR",
                "Season Proj": 200,
                "Season P10": 170,
                "Season P50": 200,
                "Season P90": 230,
            },
            {
                "player_id": "boom",
                "Player": "Boom",
                "Position": "WR",
                "Season Proj": 180,
                "Season P10": 100,
                "Season P50": 180,
                "Season P90": 280,
            },
        ]
    )
    values = build_player_values(pool, rules, team_count=10)
    fair_sum = sum(v["fair_value"] for v in values.values())
    raav_sum = sum(v["risk_adjusted_value"] for v in values.values())
    # Budget-neutral within rounding of dollar clamps.
    assert abs(fair_sum - raav_sum) <= len(values)

    boom = values["boom"]
    safe = values["safe"]
    assert boom["risk_score"] > safe["risk_score"]
    # Aggressive: high-risk player gets a premium vs their own fair baseline.
    assert boom["risk_adjusted_value"] >= boom["fair_value"]
    assert safe["risk_adjusted_value"] <= safe["fair_value"]


def test_build_player_values_conservative_discounts_high_risk():
    rules = LeagueRules(risk_tolerance=-1.0, salary_cap=200.0)
    # Copy roster/auction from preset so relevant counts stay realistic.
    preset = _rules()
    rules = rules.model_copy(update={"roster": preset.roster, "auction": preset.auction})
    pool = pd.DataFrame(
        [
            {
                "player_id": "safe",
                "Player": "Safe",
                "Position": "RB",
                "Season Proj": 210,
                "Season P10": 190,
                "Season P50": 210,
                "Season P90": 230,
            },
            {
                "player_id": "boom",
                "Player": "Boom",
                "Position": "RB",
                "Season Proj": 210,
                "Season P10": 120,
                "Season P50": 210,
                "Season P90": 300,
            },
        ]
    )
    values = build_player_values(pool, rules, team_count=10)
    assert values["boom"]["risk_adjusted_value"] < values["boom"]["fair_value"]
    assert values["safe"]["risk_adjusted_value"] > values["safe"]["fair_value"]


def test_risk_adjusted_auction_value_uses_module_weight():
    rules = LeagueRules(risk_tolerance=1.0, salary_cap=200.0)
    fair = 40.0
    # risk_z=1 → multiplier 1 + 1*RISK_WEIGHT*1
    expected = round(fair * (1.0 + RISK_WEIGHT), 0)
    assert risk_adjusted_auction_value(fair, 1.0, rules) == expected
