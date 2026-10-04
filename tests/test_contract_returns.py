import pytest
from fastapi.testclient import TestClient
from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.contract_returns import build_contract_returns
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.season_scoring import save_week


@pytest.fixture
def salary_history(hub_db, monkeypatch):
    league = storage.create_league("returns-owner", "Returns", 2026, LeagueRules())
    storage.join_league("returns-owner", league["room_code"], "Nicknames change")
    lid = league["id"]
    for year in [2024, 2025, 2026]:
        save_week(lid, year, 1, [
            {"aliases": ["player"], "points": 100, "position": "WR"},
            {"aliases": ["zero"], "points": 0, "position": "RB"},
        ])
        storage.insert_league_contract_row(lid, year, {"owner_label": "Manager", "hub_team_name": "Nicknames change",
            "player_id": "player", "player_name": "Actual Player", "position": "WR", "base_salary": 20,
            "original_draft_year": 2024, "contract_phase": "Rookie" if year < 2026 else "Extension"})
    def forbidden(*args, **kwargs):
        pytest.fail("Contract rankings contacted a scoring host")
    monkeypatch.setattr("src.draft_hub.league_history._fetch_json", forbidden)
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_league_users", forbidden)
    yield lid


def test_actual_saved_points_and_salary_keep_renewal_separate(salary_history):
    out = build_contract_returns(salary_history)
    assert len(out["rows"]) == 3
    assert out["rows"][0]["points"] == 100
    assert out["rows"][0]["salary"] == 20
    assert out["rows"][0]["deal_id"] == out["rows"][1]["deal_id"]
    assert out["rows"][1]["deal_id"] != out["rows"][2]["deal_id"]


def test_recorded_zero_ranks_but_missing_score_salary_and_ambiguous_import_do_not(salary_history):
    lid = salary_history
    for pid, salary in [("zero", 30), ("missing", 30), ("free", 0), ("invalid", None)]:
        storage.insert_league_contract_row(lid, 2026, {"owner_label": "Manager", "player_id": pid,
            "player_name": pid, "base_salary": salary, "position": "RB"})
    out = build_contract_returns(lid)
    assert next(r for r in out["rows"] if r["player_id"] == "zero")["points"] == 0
    assert out["excluded"] == 3
    storage.insert_league_contract_row(lid, 2026, {"owner_label": "Manager", "player_id": "zero", "player_name": "zero", "base_salary": 30})
    assert not any(r["player_id"] == "zero" for r in build_contract_returns(lid)["rows"])


def test_missing_feed_week_does_not_lower_a_contract_return(salary_history):
    save_week(salary_history, 2025, 3, [{"aliases": ["player"], "points": 2}])
    out = build_contract_returns(salary_history)
    assert not any(r["season"] == 2025 for r in out["rows"])


def test_contract_endpoint_checks_membership_and_money_capability(salary_history):
    user = {"sub": "returns-owner"}
    app.dependency_overrides[require_hub_user] = lambda: user
    try:
        client = TestClient(app)
        url = f"/api/hub/league/{salary_history}/insights/contracts"
        assert client.get(url).status_code == 200
        user["sub"] = "outsider"
        assert client.get(url).status_code == 403
        user["sub"] = "returns-owner"
        storage.update_league_rules(salary_history, LeagueRules(draft_type="snake"))
        assert client.get(url).status_code == 404
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
