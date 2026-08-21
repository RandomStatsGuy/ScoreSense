"""SCORE-61: empty-seat start gate and commissioner force-nominate."""

from datetime import datetime, timedelta, timezone

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_state import (
    award_nominee,
    nominate,
    skip_nomination,
    start_draft,
    tick_expired_drafts,
)
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _league(sub="empty-comm", *, test_mode=False, team_count=12, name="Empty Seats"):
    rules = load_preset("salary_cap_auction_v1")
    ws = None if test_mode else storage.get_or_create_workspace(sub)
    return storage.create_league(
        sub,
        name,
        2026,
        rules,
        team_count=team_count,
        workspace_id=None if test_mode else ws["id"],
        test_mode=test_mode,
    )


def _player(pid="force-wr"):
    return {
        "player_id": pid,
        "player": "Force WR",
        "player_name": "Force WR",
        "team": "LAR",
        "position": "WR",
        "fair_value": 12,
        "season_proj": 140,
    }


def test_live_start_blocked_until_allow_empty(hub_db):
    league = _league()
    with pytest.raises(ValueError, match="empty seat"):
        start_draft(league["id"], "empty-comm")
    state = start_draft(league["id"], "empty-comm", allow_empty=True)
    assert state["session"]["status"] == "nominating"
    assert state["empty_seats"] == 11
    assert state["claimed_humans"] == 1


def test_full_room_starts_without_allow_empty(hub_db):
    league = _league(team_count=1)
    state = start_draft(league["id"], "empty-comm")
    assert state["session"]["status"] == "nominating"
    assert state["empty_seats"] == 0


def test_practice_start_skips_empty_seat_gate(hub_db):
    league = _league(test_mode=True, team_count=12)
    state = start_draft(league["id"], "empty-comm")
    assert state["session"]["status"] == "nominating"


def test_scheduled_tick_fails_closed_on_empty_seats(hub_db):
    league = _league(team_count=12)
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    storage.update_league_settings(league["id"], draft_starts_at=past, draft_timezone="UTC")
    changed = tick_expired_drafts()
    assert league["id"] not in changed
    session = storage.get_draft_session(league["id"])
    assert session["status"] == "setup"


def test_commissioner_cannot_nominate_out_of_turn(hub_db, monkeypatch):
    league = _league(team_count=2)
    storage.join_league("empty-member", league["room_code"], "Member")
    player = _player()
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: player,
    )
    start_draft(league["id"], "empty-comm")
    skip_nomination(league["id"], "empty-comm")
    with pytest.raises(ValueError, match="turn to nominate"):
        nominate(league["id"], "empty-comm", player)


def test_commissioner_force_nominate_uses_on_clock_team(hub_db, monkeypatch):
    league = _league(team_count=2)
    member = storage.join_league("empty-member", league["room_code"], "Member")
    comm = storage.get_team_by_user(league["id"], "empty-comm")
    player = _player()
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: player,
    )
    start_draft(league["id"], "empty-comm")
    skip_nomination(league["id"], "empty-comm")
    state = nominate(league["id"], "empty-comm", player, force=True)
    session = state["session"]
    assert session["status"] == "bidding"
    assert session["high_bidder_team_id"] == member["id"]
    nominee = session.get("current_nominee") or {}
    assert nominee.get("nominating_team_id") == member["id"]
    assert nominee.get("forced") is True
    force_events = [e for e in state["events"] if e.get("event_type") == "force_nominate"]
    assert force_events
    award_nominee(league["id"], "empty-comm")
    member_roster = storage.list_team_roster(league["id"], member["id"])
    comm_roster = storage.list_team_roster(league["id"], comm["id"])
    assert any(r["player_id"] == player["player_id"] for r in member_roster)
    assert not any(r["player_id"] == player["player_id"] for r in comm_roster)


def test_member_force_flag_does_not_bypass_turn(hub_db, monkeypatch):
    league = _league(team_count=2)
    storage.join_league("empty-member", league["room_code"], "Member")
    player = _player()
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: player,
    )
    start_draft(league["id"], "empty-comm")
    with pytest.raises(ValueError, match="turn to nominate"):
        nominate(league["id"], "empty-member", player, force=True)
