"""HTTP award is commissioner/staff only; timer award_nominee stays ungated."""

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.draft_state import nominate, start_draft, user_is_draft_staff
from src.draft_hub.schemas import LeagueRules


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _player():
    return {
        "player_id": "00-0033873",
        "player_name": "Patrick Mahomes",
        "player": "Patrick Mahomes",
        "team": "KC",
        "position": "QB",
        "fair_value": 40,
    }


def _stub_nom(monkeypatch, player):
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: player,
    )


def test_member_cannot_award_via_http(hub_db, monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("comm-award", "Award League", 2026, rules, team_count=10)
    storage.join_league("member-award", league["room_code"], "Member Team")
    start_draft(league["id"], "comm-award", allow_empty=True)
    _stub_nom(monkeypatch, _player())
    nominate(league["id"], "comm-award", _player())

    member = _client_for("member-award")
    try:
        res = member.post(f"/api/hub/league/{league['id']}/award")
        assert res.status_code == 403
        assert "commissioner" in (res.json().get("detail") or "").lower()
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_commissioner_can_award_via_http(hub_db, monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("comm-award-ok", "Award League", 2026, rules, team_count=10)
    start_draft(league["id"], "comm-award-ok", allow_empty=True)
    _stub_nom(monkeypatch, _player())
    nominate(league["id"], "comm-award-ok", _player())

    comm = _client_for("comm-award-ok")
    try:
        res = comm.post(f"/api/hub/league/{league['id']}/award")
        assert res.status_code == 200
        body = res.json()
        session = body.get("session") or body
        assert session.get("status") in ("nominating", "completed", "bidding") or "session" in body
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_user_is_draft_staff_matches_primary_or_co_comm(hub_db):
    rules = LeagueRules()
    league = storage.create_league("staff-comm", "Staff League", 2026, rules, team_count=10)
    member = storage.join_league("staff-member", league["room_code"], "Member")
    assert user_is_draft_staff(league["id"], "staff-comm") is True
    assert user_is_draft_staff(league["id"], "staff-member") is False
    storage.set_team_co_commissioner(league["id"], member["id"], enabled=True, actor_sub="staff-comm")
    assert user_is_draft_staff(league["id"], "staff-member") is True
