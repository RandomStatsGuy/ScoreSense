"""League season and rules persist when commissioner saves via workspace API."""

from src.draft_hub.hub_context import resolve_hub_context
from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules


def test_commissioner_season_save_updates_league_row(hub_db):
    league = storage.create_league("comm-sub", "Cap League", 2025, LeagueRules())
    league_id = league["id"]
    assert storage.get_league(league_id)["season"] == 2025

    storage.update_league_season(league_id, 2026)
    updated = storage.get_league(league_id)
    assert updated["season"] == 2026

    ctx = resolve_hub_context("comm-sub")
    assert ctx["season"] == 2026


def test_workspace_put_persists_league_season(hub_db):
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user

    sub = "season-save-user"

    def _user():
        return {"sub": sub, "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    try:
        league = storage.create_league(sub, "Persist League", 2025, LeagueRules())
        client = TestClient(app)

        put = client.put(
            "/api/hub/workspace",
            json={"name": "Persist League", "season": 2026, "rules": LeagueRules().model_dump()},
        )
        assert put.status_code == 200
        body = put.json()
        assert body["season"] == 2026
        assert body["name"] == "Persist League"
        assert body["hub_context"]["season"] == 2026

        get = client.get("/api/hub/workspace")
        assert get.status_code == 200
        ws = get.json()
        assert ws["season"] == 2026
        assert ws["name"] == "Persist League"

        assert storage.get_league(league["id"])["season"] == 2026
        assert resolve_hub_context(sub)["season"] == 2026
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_workspace_preset_syncs_league_rules(hub_db):
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user

    sub = "preset-sync-user"

    def _user():
        return {"sub": sub, "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    try:
        league = storage.create_league(sub, "Preset League", 2025, LeagueRules(salary_cap=200))
        client = TestClient(app)

        put = client.put(
            "/api/hub/workspace",
            json={"preset_id": "salary_cap_auction_v1", "name": "Preset League", "season": 2025},
        )
        assert put.status_code == 200
        preset_cap = put.json()["rules"]["salary_cap"]

        league_row = storage.get_league(league["id"])
        assert league_row["rules"]["salary_cap"] == preset_cap
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
