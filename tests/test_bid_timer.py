"""Bid timer extension tests."""

from datetime import datetime, timedelta, timezone

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_state import _extend_bid_deadline, nominate, place_bid, start_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _remaining_seconds(iso):
    deadline = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return (deadline - datetime.now(timezone.utc)).total_seconds()


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


def test_extend_bid_deadline_ignores_early_bids():
    rules = load_preset("salary_cap_auction_v1")
    now = datetime.now(timezone.utc)
    session = {"bid_deadline": (now + timedelta(seconds=28)).isoformat()}
    extended = datetime.fromisoformat(_extend_bid_deadline(session, rules))
    delta = (extended - now).total_seconds()
    assert 27 <= delta <= 29  # still plenty of clock — do not refill to 30


def test_extend_bid_deadline_rapid_bids_do_not_reset_opening_clock():
    rules = load_preset("salary_cap_auction_v1")
    now = datetime.now(timezone.utc)
    session = {"bid_deadline": (now + timedelta(seconds=30)).isoformat()}
    for _ in range(8):
        session = {"bid_deadline": _extend_bid_deadline(session, rules)}
    extended = datetime.fromisoformat(session["bid_deadline"])
    delta = (extended - datetime.now(timezone.utc)).total_seconds()
    assert 0 <= delta <= 31


def test_extend_bid_deadline_leaves_long_clock_alone():
    rules = load_preset("salary_cap_auction_v1")
    now = datetime.now(timezone.utc)
    session = {"bid_deadline": (now + timedelta(seconds=48)).isoformat()}
    extended = datetime.fromisoformat(_extend_bid_deadline(session, rules))
    delta = (extended - now).total_seconds()
    assert 47 <= delta <= 49


def test_place_bid_rapid_raises_do_not_exceed_opening_clock(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("timer-cap")
    league = storage.create_league("timer-cap", "Timer Cap", 2026, rules, workspace_id=ws["id"])
    player = {
        "player_id": "cap-wr",
        "player": "Cap WR",
        "player_name": "Cap WR",
        "team": "DAL",
        "position": "WR",
        "fair_value": 10,
        "is_rookie": False,
    }
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: player,
    )
    start_draft(league["id"], "timer-cap", allow_empty=True)
    nominate(league["id"], "timer-cap", player)
    for amount in range(2, 10):
        place_bid(league["id"], "timer-cap", amount)
    session = storage.get_draft_session(league["id"])
    remaining = _remaining_seconds(session["bid_deadline"])
    cap = int(rules.auction.bid_timer_sec)
    assert remaining <= cap + 1
    assert float(session["high_bid"]) == 9
