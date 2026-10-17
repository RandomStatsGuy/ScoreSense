"""Imports use the reviewed league without changing saved Fantasy focus."""
import pytest
from fastapi.testclient import TestClient
from app.api import app
from app.auth import require_hub_user
from app import hub_routes
from src.draft_hub import storage, cap_sheet_import
from src.draft_hub.schemas import LeagueRules

ENDPOINTS = ["league-sheet/import", "cap-sheet/validate", "cap-sheet/import"]

@pytest.fixture
def import_room(hub_db, monkeypatch, tmp_path):
    a = storage.create_league("scope-staff", "Focused", 2026, LeagueRules())
    b = storage.create_league("scope-staff", "Reviewed", 2025, LeagueRules())
    storage.join_league("scope-member", b["room_code"], "Member")
    storage.set_hub_focus("scope-staff", league_id=a["id"])
    member_focus = storage.create_league("scope-member", "Other commissioner room", 2026, LeagueRules())
    storage.set_hub_focus("scope-member", league_id=member_focus["id"])
    calls = []
    parsed = {"rows": [], "stats": {}, "teams_found": [], "unmatched": []}
    monkeypatch.setattr(hub_routes, "parse_league_sheet_csv", lambda raw, **kwargs: parsed)
    monkeypatch.setattr(cap_sheet_import, "parse_cap_sheet_tsv", lambda raw, **kwargs: parsed)
    monkeypatch.setattr("src.config.DATA_DIR", tmp_path)
    monkeypatch.setattr(storage, "import_commissioner_league_sheet", lambda league, *args, **kwargs: calls.append(league) or {"imported": 0})
    monkeypatch.setattr(cap_sheet_import, "validate_cap_sheet_for_league", lambda league, *args, **kwargs: calls.append(league) or {"ok": True})
    monkeypatch.setattr(cap_sheet_import, "import_cap_sheet_to_league", lambda league, *args, **kwargs: calls.append(league) or {"imported": 0})
    return a, b, calls

@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_explicit_import_destination_preserves_focus(import_room, endpoint):
    a, b, calls = import_room
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "scope-staff", "auth_type": "dev"}
    try:
        client = TestClient(app)
        response = client.post(f"/api/hub/{endpoint}", params={"league_id": b["id"]}, files={"file": ("fixture.csv", b"synthetic", "text/plain")})
        assert response.status_code == 200, response.text
        assert calls == [b["id"]]
        assert storage.get_hub_focus_league_id("scope-staff") == a["id"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("sub", ["scope-member", "scope-outsider"])
def test_import_destination_rechecks_target_permission(import_room, endpoint, sub):
    _, b, calls = import_room
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    try:
        client = TestClient(app)
        response = client.post(f"/api/hub/{endpoint}", params={"league_id": b["id"]}, files={"file": ("fixture.csv", b"synthetic", "text/plain")})
        assert response.status_code == 403, response.text
        assert calls == []
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
