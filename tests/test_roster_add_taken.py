"""Adding a player already on another roster requires commissioner confirm."""

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules

ET = ZoneInfo("America/New_York")


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


def _open_fa(monkeypatch, league):
    storage.update_league_settings(league["id"], draft_completed=True)
    monkeypatch.setattr(
        "src.draft_hub.acquisition_window.get_nfl_state",
        lambda use_cache=True: {"season_type": "regular", "week": 4, "season": 2026},
    )
    monkeypatch.setattr(
        "src.draft_hub.acquisition_window._now_et",
        lambda now=None: datetime(2026, 9, 24, 15, 0, tzinfo=ET),
    )


def test_member_cannot_add_taken_player(hub_db, monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("comm-taken", "Taken League", 2026, rules, team_count=10)
    _open_fa(monkeypatch, league)
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


def test_commissioner_needs_force_then_can_reassign(hub_db, monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("comm-reassign", "Reassign League", 2026, rules, team_count=10)
    _open_fa(monkeypatch, league)
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


def test_already_on_own_roster_rejected(hub_db, monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("comm-own", "Own Roster League", 2026, rules, team_count=8)
    _open_fa(monkeypatch, league)
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


def test_commissioner_can_add_player_to_another_team(hub_db, monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("comm-add-other", "Add Other League", 2026, rules, team_count=10)
    _open_fa(monkeypatch, league)
    owner = storage.join_league("owner-add-other", league["room_code"], "Disappointment")
    storage.join_league("member-add-other", league["room_code"], "Member Team")
    ws_id = storage.roster_workspace_for_league(league)

    client = _client_for("comm-add-other")
    try:
        # Owner posting team_id=owner["id"] is their own team (allowed). A
        # third member targeting Disappointment must be rejected.
        member = _client_for("member-add-other")
        blocked = member.post(
            "/api/hub/roster",
            json=_payload(player_id="4039", player_name="Ja'Marr Chase", team_id=owner["id"]),
        )
        assert blocked.status_code == 403, blocked.text
        assert "commissioner" in blocked.json()["detail"].lower()

        # _client_for mutates shared dependency_overrides — rebind commissioner.
        client = _client_for("comm-add-other")
        missing = client.post(
            "/api/hub/roster",
            json=_payload(player_id="4039", player_name="Ja'Marr Chase", team_id="not-a-team"),
        )
        assert missing.status_code == 400

        ok = client.post(
            "/api/hub/roster",
            json=_payload(
                player_id="4039",
                player_name="Ja'Marr Chase",
                team="CIN",
                position="WR",
                salary=12,
                contract_years=2,
                contract_type="rookie",
                team_id=owner["id"],
            ),
        )
        assert ok.status_code == 200, ok.text
        slot = storage.get_roster_slot(ws_id, "4039")
        assert slot["team_id"] == owner["id"]
        assert slot["player_name"] == "Ja'Marr Chase"
        assert slot["salary"] == 12
        assert (slot.get("contract") or {}).get("contract_type") == "rookie"
        comm_team = storage.get_team_by_user(league["id"], "comm-add-other")
        assert slot["team_id"] != comm_team["id"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_commissioner_force_reassigns_to_requested_team(hub_db, monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("comm-force-target", "Force Target League", 2026, rules, team_count=10)
    _open_fa(monkeypatch, league)
    owner = storage.join_league("owner-force-target", league["room_code"], "Alpha")
    dest = storage.join_league("dest-force-target", league["room_code"], "Disappointment")
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

    client = _client_for("comm-force-target")
    try:
        blocked = client.post("/api/hub/roster", json=_payload(team_id=dest["id"]))
        assert blocked.status_code == 409
        assert "Alpha" in blocked.json()["detail"]
        assert "Disappointment" in blocked.json()["detail"]
        assert "Confirm" in blocked.json()["detail"]

        already = client.post(
            "/api/hub/roster",
            json=_payload(team_id=owner["id"], force=True),
        )
        assert already.status_code == 409
        assert "this roster" in already.json()["detail"]

        ok = client.post("/api/hub/roster", json=_payload(team_id=dest["id"], force=True))
        assert ok.status_code == 200, ok.text
        slot = storage.get_roster_slot(ws_id, "00-0033873")
        assert slot["team_id"] == dest["id"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
