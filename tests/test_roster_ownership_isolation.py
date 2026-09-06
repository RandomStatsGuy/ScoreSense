"""Roster delete ownership and per-league roster workspace isolation."""

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


def _add(ws_id, team_id, player_id="00-0033873", name="Patrick Mahomes"):
    return storage.add_roster_slot(
        ws_id,
        {
            "player_id": player_id,
            "player_name": name,
            "team": "KC",
            "position": "QB",
            "salary": 40,
            "contract_years": 1,
        },
        team_id=team_id,
    )


def _seed_two_teams(comm_sub, member_sub, owner_sub="owner-iso"):
    rules = LeagueRules()
    league = storage.create_league(comm_sub, "Iso League", 2026, rules, team_count=10)
    owner = storage.join_league(owner_sub, league["room_code"], "Owner Team")
    member = storage.join_league(member_sub, league["room_code"], "Member Team")
    ws_id = storage.roster_workspace_for_league(league)
    return league, owner, member, ws_id


def test_member_cannot_delete_another_team_player(hub_db, monkeypatch):
    league, owner, _member, ws_id = _seed_two_teams("comm-del", "member-del")
    _open_fa(monkeypatch, league)
    _add(ws_id, owner["id"])

    client = _client_for("member-del")
    try:
        res = client.request("DELETE", "/api/hub/roster", json={"player_id": "00-0033873"})
        assert res.status_code == 403
        assert "another team" in res.json()["detail"].lower()
        assert storage.get_roster_slot(ws_id, "00-0033873") is not None
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_member_can_delete_own_player(hub_db, monkeypatch):
    league, _owner, member, ws_id = _seed_two_teams("comm-own-del", "member-own-del")
    _open_fa(monkeypatch, league)
    _add(ws_id, member["id"], player_id="00-0035228", name="Josh Allen")

    client = _client_for("member-own-del")
    try:
        res = client.request("DELETE", "/api/hub/roster", json={"player_id": "00-0035228"})
        assert res.status_code == 200
        assert res.json()["removed"] == "00-0035228"
        assert storage.get_roster_slot(ws_id, "00-0035228") is None
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_commissioner_can_delete_another_team_player(hub_db, monkeypatch):
    league, owner, _member, ws_id = _seed_two_teams("comm-staff-del", "member-staff-del")
    _open_fa(monkeypatch, league)
    _add(ws_id, owner["id"])

    client = _client_for("comm-staff-del")
    try:
        res = client.request("DELETE", "/api/hub/roster", json={"player_id": "00-0033873"})
        assert res.status_code == 200
        assert storage.get_roster_slot(ws_id, "00-0033873") is None
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_create_league_does_not_reuse_commissioner_workspace(hub_db):
    rules = LeagueRules()
    comm_ws = storage.get_or_create_workspace("comm-dedicated")
    league = storage.create_league("comm-dedicated", "Dedicated", 2026, rules)
    league_ws = storage.roster_workspace_for_league(league)
    assert league["workspace_id"] == league["id"]
    assert league_ws == league["id"]
    assert league_ws != comm_ws["id"]


def test_two_leagues_same_commissioner_do_not_share_roster_rows(hub_db):
    rules = LeagueRules()
    league_a = storage.create_league("comm-two", "League A", 2026, rules, team_count=8)
    league_b = storage.create_league("comm-two", "League B", 2026, rules, team_count=8)
    ws_a = storage.roster_workspace_for_league(league_a)
    ws_b = storage.roster_workspace_for_league(league_b)
    assert ws_a != ws_b
    team_a = storage.list_league_teams(league_a["id"])[0]
    team_b = storage.list_league_teams(league_b["id"])[0]
    _add(ws_a, team_a["id"], player_id="00-0035228", name="Josh Allen")
    _add(ws_b, team_b["id"], player_id="00-0035228", name="Josh Allen")
    slot_a = storage.get_roster_slot(ws_a, "00-0035228")
    slot_b = storage.get_roster_slot(ws_b, "00-0035228")
    assert slot_a is not None and slot_b is not None
    assert slot_a["team_id"] == team_a["id"]
    assert slot_b["team_id"] == team_b["id"]


def test_rehome_shared_workspace_splits_roster_rows(hub_db):
    rules = LeagueRules()
    ws = storage.get_or_create_workspace("comm-shared")
    league_a = storage.create_league(
        "comm-shared", "Shared A", 2026, rules, workspace_id=ws["id"], team_count=8
    )
    league_b = storage.create_league(
        "comm-shared", "Shared B", 2026, rules, workspace_id=ws["id"], team_count=8
    )
    assert league_a["workspace_id"] == ws["id"]
    assert league_b["workspace_id"] == ws["id"]
    team_a = storage.list_league_teams(league_a["id"])[0]
    team_b = storage.list_league_teams(league_b["id"])[0]
    _add(ws["id"], team_a["id"], player_id="00-0033873", name="Patrick Mahomes")
    _add(ws["id"], team_b["id"], player_id="00-0035228", name="Josh Allen")

    moved = storage.ensure_dedicated_league_workspaces()
    assert moved >= 2

    league_a = storage.get_league(league_a["id"])
    league_b = storage.get_league(league_b["id"])
    ws_a = storage.roster_workspace_for_league(league_a)
    ws_b = storage.roster_workspace_for_league(league_b)
    assert ws_a != ws_b
    assert ws_a != ws["id"]
    assert ws_b != ws["id"]
    assert storage.get_roster_slot(ws_a, "00-0033873")["team_id"] == team_a["id"]
    assert storage.get_roster_slot(ws_b, "00-0035228")["team_id"] == team_b["id"]
    assert storage.get_roster_slot(ws_a, "00-0035228") is None
    assert storage.get_roster_slot(ws_b, "00-0033873") is None
