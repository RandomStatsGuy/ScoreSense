"""FAAB-style bidding for post-draft FA and in-season waivers."""

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.fa_market import process_window
from src.draft_hub.schemas import LeagueRules

ET = ZoneInfo("America/New_York")


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _waiver_league(monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("fa-comm", "FA League", 2026, rules, team_count=8)
    storage.update_league_settings(league["id"], draft_completed=True)
    storage.join_league("fa-a", league["room_code"], "Team A")
    storage.join_league("fa-b", league["room_code"], "Team B")
    monkeypatch.setattr(
        "src.draft_hub.acquisition_window.get_nfl_state",
        lambda use_cache=True: {"season_type": "regular", "week": 2, "season": 2026},
    )
    monkeypatch.setattr(
        "src.draft_hub.acquisition_window._now_et",
        lambda now=None: datetime(2026, 9, 15, 9, 0, tzinfo=ET),  # Tuesday
    )
    return league


def test_players_tab_add_blocked_during_waivers(hub_db, monkeypatch):
    league = _waiver_league(monkeypatch)
    client = _client_for("fa-a")
    try:
        res = client.post(
            "/api/hub/roster",
            json={
                "player_id": "00-0033873",
                "player_name": "Patrick Mahomes",
                "team": "KC",
                "position": "QB",
                "salary": 12,
                "contract_years": 1,
            },
        )
        assert res.status_code == 403
        assert "bid" in res.json()["detail"].lower() or "waiver" in res.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
    assert league["id"]


def test_highest_bid_wins_on_process(hub_db, monkeypatch):
    league = _waiver_league(monkeypatch)
    lid = league["id"]
    a = _client_for("fa-a")
    try:
        first = a.post(
            "/api/hub/fa-market/bid",
            json={
                "player_id": "00-0033873",
                "player_name": "Patrick Mahomes",
                "team": "KC",
                "position": "QB",
                "bid_amount": 8,
            },
        )
        assert first.status_code == 200, first.text
        b = _client_for("fa-b")
        second = b.post(
            "/api/hub/fa-market/bid",
            json={
                "player_id": "00-0033873",
                "player_name": "Patrick Mahomes",
                "team": "KC",
                "position": "QB",
                "bid_amount": 15,
            },
        )
        assert second.status_code == 200, second.text
        result = process_window(lid, "2026-w2-waiver")
        assert result["awarded_count"] == 1
        winner = result["awarded"][0]
        team_b = storage.get_team_by_user(lid, "fa-b")
        assert winner["team_id"] == team_b["id"]
        assert winner["salary"] == 15
        slot = storage.get_roster_slot(storage.roster_workspace_for_league(league), "00-0033873")
        assert slot["team_id"] == team_b["id"]
        assert float(slot["salary"]) == 15
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_commissioner_staff_edit_bypasses_window(hub_db, monkeypatch):
    league = _waiver_league(monkeypatch)
    client = _client_for("fa-comm")
    try:
        res = client.post(
            "/api/hub/roster",
            json={
                "player_id": "00-0035228",
                "player_name": "Josh Allen",
                "team": "BUF",
                "position": "QB",
                "salary": 40,
                "contract_years": 2,
                "staff_edit": True,
            },
        )
        assert res.status_code == 200, res.text
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
    assert league["id"]


def test_bid_rejected_when_rosters_locked(hub_db, monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("lock-comm", "Locked League", 2026, rules, team_count=8)
    storage.join_league("lock-a", league["room_code"], "Team A")
    monkeypatch.setattr(
        "src.draft_hub.acquisition_window.get_nfl_state",
        lambda use_cache=True: {"season_type": "off", "week": 1, "season": 2026},
    )
    client = _client_for("lock-a")
    try:
        res = client.post(
            "/api/hub/fa-market/bid",
            json={
                "player_id": "00-0033873",
                "player_name": "Patrick Mahomes",
                "team": "KC",
                "position": "QB",
                "bid_amount": 8,
            },
        )
        assert res.status_code in {400, 403}
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

