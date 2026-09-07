"""Multi-league focus: switch active league or solo prep."""

import pytest

from src.draft_hub import storage
from src.draft_hub.hub_context import resolve_hub_context
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_resolve_league_membership_honors_focus(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("user-multi")
    league_a = storage.create_league(
        "user-multi", "League A", 2025, rules, workspace_id=ws["id"], commissioner_team_name="A Team"
    )
    league_b = storage.create_league(
        "user-multi", "League B", 2025, rules, team_count=10, commissioner_team_name="B Team"
    )
    assert league_a["id"] != league_b["id"]

    ctx_default = resolve_hub_context("user-multi")
    assert ctx_default["mode"] == "league"
    assert ctx_default["league_id"] in {league_a["id"], league_b["id"]}

    storage.set_hub_focus("user-multi", league_id=league_a["id"])
    ctx_a = resolve_hub_context("user-multi")
    assert ctx_a["league_id"] == league_a["id"]
    assert ctx_a["team_name"] == "A Team"

    storage.set_hub_focus("user-multi", league_id=league_b["id"])
    ctx_b = resolve_hub_context("user-multi")
    assert ctx_b["league_id"] == league_b["id"]


def test_solo_focus_overrides_membership(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("user-solo")
    storage.create_league("user-solo", "Only League", 2025, rules, workspace_id=ws["id"])

    storage.set_hub_focus("user-solo", solo=True)
    ctx = resolve_hub_context("user-solo")
    assert ctx["mode"] == "solo"
    assert ctx["hub_focus"] == "solo"
    assert ctx.get("league_id") is None


def test_memberships_api_lists_leagues(hub_db, monkeypatch):
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user

    def _user():
        return {"sub": "api-user", "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    try:
        rules = load_preset("salary_cap_auction_v1")
        ws = storage.get_or_create_workspace("api-user")
        storage.create_league("api-user", "API League", 2025, rules, workspace_id=ws["id"])

        client = TestClient(app)
        res = client.get("/api/hub/memberships")
        assert res.status_code == 200
        body = res.json()
        assert len(body["memberships"]) == 1
        assert body["memberships"][0]["league_name"] == "API League"
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_active_league_api_switches_context(hub_db, monkeypatch):
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user

    def _user():
        return {"sub": "switch-user", "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    try:
        rules = load_preset("salary_cap_auction_v1")
        ws = storage.get_or_create_workspace("switch-user")
        a = storage.create_league("switch-user", "First", 2025, rules, workspace_id=ws["id"])
        b = storage.create_league("switch-user", "Second", 2025, rules, team_count=10)

        client = TestClient(app)
        res = client.put("/api/hub/active-league", json={"league_id": a["id"]})
        assert res.status_code == 200
        assert res.json()["hub_context"]["league_id"] == a["id"]

        res2 = client.put("/api/hub/active-league", json={"solo": True})
        assert res2.status_code == 200
        assert res2.json()["hub_context"]["mode"] == "solo"

        res3 = client.put("/api/hub/active-league", json={"league_id": b["id"]})
        assert res3.status_code == 200
        assert res3.json()["hub_context"]["league_id"] == b["id"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_league_route_does_not_steal_focus(hub_db, monkeypatch):
    """Reading another joined league must not change saved Fantasy focus."""
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user

    def _user():
        return {"sub": "no-steal-user", "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    try:
        rules = load_preset("salary_cap_auction_v1")
        ws = storage.get_or_create_workspace("no-steal-user")
        a = storage.create_league("no-steal-user", "Alpha", 2025, rules, workspace_id=ws["id"])
        b = storage.create_league("no-steal-user", "Beta", 2025, rules, team_count=10)

        storage.set_hub_focus("no-steal-user", league_id=a["id"])
        client = TestClient(app)

        res = client.get(f"/api/hub/league/{b['id']}/members")
        assert res.status_code == 200
        body = res.json()
        assert body["hub_context"]["league_id"] == b["id"]
        assert resolve_hub_context("no-steal-user")["league_id"] == a["id"]
        assert storage.get_hub_focus_league_id("no-steal-user") == a["id"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_test_mode_route_does_not_become_focus(hub_db, monkeypatch):
    """Practice rooms stay off the Fantasy strip even when a page reads them."""
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user

    sub = "practice-steal-user"

    def _user():
        return {"sub": sub, "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    try:
        rules = load_preset("salary_cap_auction_v1")
        live = storage.create_league(sub, "My Auction", 2025, rules)
        practice = storage.create_league(sub, "Test League", 2025, rules, test_mode=True)
        storage.set_hub_focus(sub, league_id=live["id"])
        client = TestClient(app)

        res = client.get(f"/api/hub/league/{practice['id']}/chat/league/messages?limit=10")
        assert res.status_code == 200
        assert resolve_hub_context(sub)["league_id"] == live["id"]
        assert storage.get_hub_focus_league_id(sub) == live["id"]

        storage.set_hub_focus(sub, league_id=practice["id"])
        assert storage.get_hub_focus_league_id(sub) == live["id"]
        assert resolve_hub_context(sub)["league_id"] == live["id"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
