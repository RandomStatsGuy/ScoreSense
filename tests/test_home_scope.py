"""Home reads the displayed league without changing saved Fantasy focus."""
import pytest
from fastapi.testclient import TestClient
from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules

@pytest.fixture
def home_rooms(hub_db, monkeypatch):
    a=storage.create_league("home-scope-staff", "Focused", 2026, LeagueRules())
    b=storage.create_league("home-scope-staff", "Displayed", 2025, LeagueRules())
    storage.join_league("home-scope-member", b["room_code"], "Member")
    storage.set_hub_focus("home-scope-staff", league_id=a["id"])
    storage.set_hub_focus("home-scope-member", league_id=None)
    monkeypatch.setattr("src.draft_hub.league_home.build_league_home", lambda ctx, **kwargs: {"hub_context":ctx})
    yield a,b
    app.dependency_overrides.pop(require_hub_user, None)

@pytest.mark.parametrize("sub", ["home-scope-staff", "home-scope-member"])
def test_home_explicit_league_preserves_saved_focus(home_rooms, sub):
    a,b=home_rooms
    app.dependency_overrides[require_hub_user]=lambda:{"sub":sub,"auth_type":"dev"}
    before=storage.get_hub_focus_league_id(sub)
    response=TestClient(app).get("/api/hub/home", params={"league_id":b["id"],"include_week":False})
    assert response.status_code==200, response.text
    ctx=response.json()["hub_context"]
    assert ctx["league_id"]==b["id"]
    assert ctx["season"]==2025
    assert storage.get_hub_focus_league_id(sub)==before

@pytest.mark.parametrize("destination,status", [("other",403),("missing",404)])
def test_home_rejects_inaccessible_explicit_league(home_rooms, destination, status):
    a,b=home_rooms
    app.dependency_overrides[require_hub_user]=lambda:{"sub":"home-scope-outsider","auth_type":"dev"}
    response=TestClient(app).get("/api/hub/home", params={"league_id":b["id"] if destination=="other" else "missing"})
    assert response.status_code==status, response.text

def test_home_legacy_request_uses_saved_focus(home_rooms):
    a,b=home_rooms
    app.dependency_overrides[require_hub_user]=lambda:{"sub":"home-scope-staff","auth_type":"dev"}
    response=TestClient(app).get("/api/hub/home?include_week=false")
    assert response.status_code==200
    assert response.json()["hub_context"]["league_id"]==a["id"]
