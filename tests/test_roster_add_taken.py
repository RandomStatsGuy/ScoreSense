"""Adding a player already on another roster requires commissioner confirm."""

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _payload(**overrides):
    body = {
        "player_id": "00-0033873",
        "player_name": "Patrick Mahomes",
        "team": "KC",
        "position": "QB",
        "salary": 40,
        "contract_years": 1,
    }
    body.update(overrides)
    return body


def test_member_cannot_add_taken_player(hub_db):
    rules = LeagueRules()
    league = storage.create_league("comm-taken", "Taken League", 2026, rules, team_count=10)
    owner = storage.join_league("owner-taken", league["room_code"], "Owner Team")
    storage.join_league("member-taken", league["room_code"], "Member Team")
    ws_id = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-0033873",
            "player_name": "Patrick Mahomes",
            "team": "KC",
            "position": "QB",
            "salary": 40,
            "contract_years": 1,
        },
        team_id=owner["id"],
    )

    client = _client_for("member-taken")
    try:
        res = client.post("/api/hub/roster", json=_payload())
        assert res.status_code == 409
        assert "Owner Team" in res.json()["detail"]
        assert "already on" in res.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_commissioner_needs_force_then_can_reassign(hub_db):
    rules = LeagueRules()
    league = storage.create_league("comm-reassign", "Reassign League", 2026, rules, team_count=10)
    owner = storage.join_league("owner-reassign", league["room_code"], "Alpha")
    ws_id = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-0033873",
            "player_name": "Patrick Mahomes",
            "team": "KC",
            "position": "QB",
            "salary": 40,
            "contract_years": 1,
        },
        team_id=owner["id"],
    )

    client = _client_for("comm-reassign")
    try:
        blocked = client.post("/api/hub/roster", json=_payload())
        assert blocked.status_code == 409
        assert "Confirm" in blocked.json()["detail"]

        ok = client.post("/api/hub/roster", json=_payload(force=True))
        assert ok.status_code == 200
        slot = storage.get_roster_slot(ws_id, "00-0033873")
        comm_team = storage.get_team_by_user(league["id"], "comm-reassign")
        assert slot["team_id"] == comm_team["id"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_already_on_own_roster_rejected(hub_db):
    rules = LeagueRules()
    league = storage.create_league("comm-own", "Own Roster League", 2026, rules, team_count=8)
    team = storage.get_team_by_user(league["id"], "comm-own")
    ws_id = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-0033873",
            "player_name": "Patrick Mahomes",
            "team": "KC",
            "position": "QB",
            "salary": 40,
            "contract_years": 1,
        },
        team_id=team["id"],
    )

    client = _client_for("comm-own")
    try:
        res = client.post("/api/hub/roster", json=_payload(force=True))
        assert res.status_code == 409
        assert "already on your roster" in res.json()["detail"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
