"""Bid timer extension tests."""

from datetime import datetime, timedelta, timezone

from src.draft_hub.draft_state import _extend_bid_deadline
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


def test_extend_bid_deadline_adds_seconds():
    rules = load_preset("salary_cap_auction_v1")
    now = datetime.now(timezone.utc)
    session = {"bid_deadline": (now + timedelta(seconds=3)).isoformat()}
    extended = datetime.fromisoformat(_extend_bid_deadline(session, rules))
    delta = (extended - now).total_seconds()
    assert 7 <= delta <= 9  # 3 remaining + 5 extension


def test_extend_bid_deadline_from_empty():
    rules = LeagueRules.model_validate({"salary_cap": 200, "auction": {"bid_extension_sec": 5}})
    extended = datetime.fromisoformat(_extend_bid_deadline({}, rules))
    delta = (extended - datetime.now(timezone.utc)).total_seconds()
    assert 4 <= delta <= 6
