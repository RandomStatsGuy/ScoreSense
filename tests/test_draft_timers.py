"""Draft timer, nomination expiry, and pick value grading."""

from datetime import datetime, timedelta, timezone

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_state import (
    _pick_value_blurb,
    _pick_value_grade,
    check_timers,
    start_draft,
    tick_expired_drafts,
)
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_pick_value_grade_steal():
    assert _pick_value_grade(10.0, 20.0) == "steal"


def test_pick_value_grade_reach():
    assert _pick_value_grade(30.0, 20.0) == "reach"


def test_pick_value_blurb_includes_ppg():
    text = _pick_value_blurb("great_value", amount=18.0, fair_value=24.0, per_game=14.2)
    assert "Great value" in text
    assert "14.2 PPG" in text
    assert "$18 spent" in text


def _past():
    return (datetime.now(timezone.utc) - timedelta(seconds=3)).isoformat()


def test_expired_nomination_auto_nominates(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("timer-nom")
    league = storage.create_league("timer-nom", "Timer Nom", 2026, rules, workspace_id=ws["id"])
    player = {
        "player_id": "auto-te",
        "player": "Auto TE",
        "player_name": "Auto TE",
        "team": "KC",
        "position": "TE",
        "fair_value": 6,
        "season_proj": 90,
        "is_rookie": False,
    }
    monkeypatch.setattr(
        "src.draft_hub.draft_pool.build_nomination_pool",
        lambda **kwargs: {
            "rows": [player],
            "count": 1,
            "drafted_count": 0,
            "hub_available_count": 0,
            "pool_mode": "full",
        },
    )
    start_draft(league["id"], "timer-nom", allow_empty=True)
    storage.update_draft_session(league["id"], nomination_deadline=_past())
    state = check_timers(league["id"], "timer-nom")
    session = state["session"]
    assert session["status"] == "bidding"
    assert (session.get("current_nominee") or {}).get("player_id") == "auto-te"
    assert float(session.get("high_bid") or 0) == 1
    team = storage.get_team_by_user(league["id"], "timer-nom")
    assert session.get("high_bidder_team_id") == team["id"]


def test_expired_nomination_skips_when_pool_empty(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("timer-skip")
    league = storage.create_league(
        "timer-skip", "Timer Skip", 2026, rules, team_count=2, workspace_id=ws["id"]
    )
    storage.join_league("other-skip", league["room_code"], "Other")
    monkeypatch.setattr(
        "src.draft_hub.draft_pool.build_nomination_pool",
        lambda **kwargs: {
            "rows": [],
            "count": 0,
            "drafted_count": 0,
            "hub_available_count": 0,
            "pool_mode": "full",
        },
    )
    start_draft(league["id"], "timer-skip", allow_empty=True)
    session = storage.get_draft_session(league["id"])
    first = int(session.get("nominator_index") or 0)
    storage.update_draft_session(league["id"], nomination_deadline=_past())
    state = check_timers(league["id"], "timer-skip")
    session = storage.get_draft_session(league["id"])
    assert session["status"] == "nominating"
    assert int(session.get("nominator_index") or 0) != first
    passes = [e for e in state["events"] if e.get("event_type") == "pass"]
    assert passes and passes[-1]["payload"].get("reason") == "nomination_timeout"


def test_tick_expired_drafts_awards_expired_bid(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("tick-award")
    league = storage.create_league("tick-award", "Tick Award", 2026, rules, workspace_id=ws["id"])
    player = {
        "player_id": "p1",
        "player": "Tick WR",
        "player_name": "Tick WR",
        "team": "DAL",
        "position": "WR",
        "fair_value": 10,
        "is_rookie": False,
    }
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: player,
    )
    from src.draft_hub.draft_state import nominate

    start_draft(league["id"], "tick-award", allow_empty=True)
    nominate(league["id"], "tick-award", player)
    storage.update_draft_session(league["id"], bid_deadline=_past())
    changed = tick_expired_drafts()
    assert league["id"] in changed
    team = storage.get_team_by_user(league["id"], "tick-award")
    roster = storage.list_team_roster(league["id"], team["id"])
    assert any(r.get("player_id") == "p1" for r in roster)
