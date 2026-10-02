"""Fantasy sync observes the worker without changing focus or starting inference."""
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import projection_recovery as recovery


@pytest.fixture(autouse=True)
def isolated_recovery():
    recovery._ACTIVE.clear()
    recovery._RESULTS.clear()
    yield
    recovery._ACTIVE.clear()
    recovery._RESULTS.clear()


def test_status_tracks_running_failure_and_remaining_retry_without_queueing():
    key = (2026, 1, ("draft",))
    assert recovery.projection_recovery_status(2026, 1, ["draft"]) == {"status": "idle"}
    recovery._ACTIVE.add(key)
    assert recovery.projection_recovery_status(2026, 1, ["draft"]) == {"status": "running"}
    recovery._ACTIVE.clear()
    result = {"status": "error", "failed": ["draft"]}
    recovery._RESULTS[key] = (time.monotonic() - 30, result)
    status = recovery.projection_recovery_status(2026, 1, ["draft"])
    assert status["status"] == "error" and 29 <= status["retry_after_seconds"] <= 30
    recovery._RESULTS[key] = (time.monotonic() - 61, result)
    assert recovery.projection_recovery_status(2026, 1, ["draft"])["retry_after_seconds"] == 0
    assert not recovery._ACTIVE
    assert recovery._RESULTS[key][1] == result


@pytest.mark.parametrize("member", [False, True])
def test_freshness_exposes_requested_season_recovery_to_authorized_managers(hub_db, monkeypatch, member):
    from app.api import app
    from app import hub_routes
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    contexts = []
    monkeypatch.setattr(hub_routes, "_ctx_for_league", lambda sub, league: contexts.append(league) or {"is_commissioner": not member})
    def freshness(league, **kwargs):
        assert league == "chosen-league" and kwargs["include_contract_detail"] is not member
        return {"planning_season": 2026, "projections": {"season": 2026, "available": True, "stale": True, "built_at": "original"}}
    monkeypatch.setattr("src.draft_hub.hub_freshness.league_data_freshness", freshness)
    recovery._ACTIVE.add((2026, 1, ("draft",)))
    recovery._RESULTS[(2025, 1, ("draft",))] = (time.monotonic(), {"status": "error"})
    response = TestClient(app).get("/api/hub/league/chosen-league/freshness")
    assert response.status_code == 200
    assert response.json()["projections"] == {"season": 2026, "available": True, "stale": True, "built_at": "original", "recovery": {"status": "running"}}
    assert contexts == ["chosen-league"]


def test_non_members_cannot_read_projection_sync_status(hub_db, monkeypatch):
    from app.api import app
    from app import hub_routes
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    def unavailable(*args):
        raise HTTPException(status_code=403, detail="Members only")
    monkeypatch.setattr(hub_routes, "_ctx_for_league", unavailable)
    response = TestClient(app).get("/api/hub/league/other-league/freshness")
    assert response.status_code == 403
