"""Rules save binds to the form league, not hub focus."""

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.hub_context import resolve_hub_context
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


def _client(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def test_workspace_put_writes_requested_league_not_focus(hub_db):
    sub = "rules-save-comm"
    rules = load_preset("salary_cap_auction_v1")
    alpha = storage.create_league(sub, "Alpha", 2026, rules)
    beta = storage.create_league(
        sub,
        "Beta",
        2026,
        LeagueRules.model_validate(rules.model_dump()),
    )
    storage.set_hub_focus(sub, league_id=beta["id"])
    assert resolve_hub_context(sub)["league_id"] == beta["id"]

    client = _client(sub)
    try:
        patched = rules.model_dump()
        patched["salary_cap"] = 177
        put = client.put(
            "/api/hub/workspace",
            json={
                "name": "Alpha",
                "season": 2026,
                "rules": patched,
                "league_id": alpha["id"],
            },
        )
        assert put.status_code == 200, put.text
        body = put.json()
        assert body["saved_league_id"] == alpha["id"]
        assert body["hub_context"]["league_id"] == beta["id"]
        assert body["hub_context"]["rules"]["salary_cap"] == rules.salary_cap
        assert storage.get_league(alpha["id"])["rules"]["salary_cap"] == 177
        assert storage.get_league(beta["id"])["rules"]["salary_cap"] == rules.salary_cap
        assert resolve_hub_context(sub)["league_id"] == beta["id"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_workspace_put_rejects_non_commissioner_target(hub_db):
    comm = "alpha-comm"
    other = "other-comm"
    rules = load_preset("salary_cap_auction_v1")
    alpha = storage.create_league(comm, "Alpha", 2026, rules)
    storage.create_league(other, "Other", 2026, rules)
    client = _client(other)
    try:
        put = client.put(
            "/api/hub/workspace",
            json={
                "name": "Hijack",
                "season": 2026,
                "rules": rules.model_dump(),
                "league_id": alpha["id"],
            },
        )
        assert put.status_code == 403
        assert storage.get_league(alpha["id"])["name"] == "Alpha"
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
