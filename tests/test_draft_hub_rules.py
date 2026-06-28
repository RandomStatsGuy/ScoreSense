"""Draft Hub rules engine tests."""

from src.draft_hub.presets import load_preset
from src.draft_hub.rules_engine import cap_summary, cut_refund, validate_roster


def test_cap_summary_basic():
    rules = load_preset("salary_cap_auction_v1")
    roster = [
        {"player_id": "1", "position": "QB", "salary": 40, "contract_years": 2},
        {"player_id": "2", "position": "RB", "salary": 35, "contract_years": 1},
    ]
    summary = cap_summary(rules, roster)
    assert summary["salary_cap"] == 200
    assert summary["spent"] == 75
    assert summary["remaining"] == 125
    assert summary["by_position_count"]["QB"] == 1


def test_validate_roster_over_cap():
    rules = load_preset("salary_cap_auction_v1")
    roster = [{"player_id": "1", "position": "QB", "salary": 250, "contract_years": 1}]
    errors = validate_roster(rules, roster)
    assert any("Over cap" in e for e in errors)


def test_validate_roster_position_min():
    rules = load_preset("salary_cap_auction_v1")
    roster = [{"player_id": "1", "position": "QB", "salary": 10, "contract_years": 1}]
    errors = validate_roster(rules, roster)
    assert any("QB" in e and "more" in e for e in errors)


def test_cut_refund():
    rules = load_preset("salary_cap_auction_v1")
    assert cut_refund(rules, 20) == 10.0
