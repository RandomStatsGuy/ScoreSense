"""Auction fair value calibration tests."""

import pandas as pd

from src.draft_hub.auction_values import (
    auction_relevant_count,
    build_player_values,
    fair_auction_value,
)
from src.draft_hub.presets import load_preset


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
