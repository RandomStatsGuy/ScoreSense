"""Tests for per-season salary cap storage."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules


def test_upsert_and_list_season_salary_caps(hub_db):
    league = storage.create_league("test-sub", "Cap Test", 2025, LeagueRules())
    league_id = league["id"]
    assert storage.list_season_salary_caps(league_id) == {}

    row = storage.upsert_season_salary_cap(league_id, 2024, 175.5)
    assert row["season_year"] == 2024
    assert row["salary_cap"] == pytest.approx(175.5)

    caps = storage.list_season_salary_caps(league_id)
    assert caps[2024] == pytest.approx(175.5)

    storage.upsert_season_salary_cap(league_id, 2024, 200)
    assert storage.list_season_salary_caps(league_id)[2024] == pytest.approx(200)


def test_resolve_salary_cap_for_season(hub_db):
    league = storage.create_league("test-sub", "Cap Resolve", 2025, LeagueRules())
    league_id = league["id"]
    storage.upsert_season_salary_cap(league_id, 2025, 225)
    assert storage.resolve_salary_cap_for_season(league_id, 2025, 200) == pytest.approx(225)
    assert storage.resolve_salary_cap_for_season(league_id, 2024, 200) == pytest.approx(200)


def test_upsert_season_salary_cap_rejects_negative(hub_db):
    league = storage.create_league("test-sub", "Cap Negative", 2025, LeagueRules())
    with pytest.raises(ValueError, match="non-negative"):
        storage.upsert_season_salary_cap(league["id"], 2025, -1)


def test_hub_season_salary_cap_api(hub_db, monkeypatch):
    from fastapi.testclient import TestClient

    from app.api import app
    from app.auth import require_hub_user
    from src.draft_hub.team_salary_sheets import build_team_salary_sheets_payload

    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )

    def _user():
        return {"sub": "cap-api-user", "auth_type": "dev"}

    league = storage.create_league("cap-api-user", "Cap API", 2025, LeagueRules())
    league_id = league["id"]
    storage.replace_league_contract_season(
        league_id,
        2025,
        [
            {
                "owner_label": "Owner A",
                "player_name": "Player A",
                "position": "QB",
                "cap_hit": 50,
                "base_salary": 50,
                "roster_status": "active",
            },
        ],
    )

    app.dependency_overrides[require_hub_user] = _user
    try:
        client = TestClient(app)
        put = client.put(
            f"/api/hub/league/{league_id}/season-salary-cap",
            json={"season_year": 2025, "salary_cap": 120},
        )
        assert put.status_code == 200
        assert put.json()["salary_cap"] == pytest.approx(120)

        get = client.get(f"/api/hub/league/{league_id}/team-salary-sheets?season=2025")
        assert get.status_code == 200
        body = get.json()
        assert body["salary_caps_by_season"]["2025"] == pytest.approx(120)
        assert body["summary_matrix"][0]["seasons"]["2025"]["unspent"] == pytest.approx(70)

        payload = build_team_salary_sheets_payload(league_id, season_year=2025)
        assert payload["salary_caps_by_season"]["2025"] == pytest.approx(120)
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
