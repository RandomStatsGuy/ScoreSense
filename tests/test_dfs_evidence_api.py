import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import require_patron
from app import dfs_evidence_routes as routes


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[require_patron] = lambda: {"sub": "test-evidence"}
    return TestClient(app)


@pytest.fixture
def payload():
    return {"context": {"season": 2026, "week": 5, "slate_id": "exact-slate"},
            "pool": [{"player_id": f"p{i}", "name": f"Player {i}", "team": "BUF", "position": "WR",
                      "proj": 10, "floor": 5, "ceiling": 15, "salary": 5000} for i in range(9)],
            "input_snapshot_id": "decision:exact", "frozen_at": "2026-10-01T00:00:00Z"}


def test_missing_evidence_is_cache_only_and_does_not_expose_restricted_source(client, monkeypatch):
    contexts = []
    def read(context):
        contexts.append(context)
        return {"status": "unavailable", "context": context, "content_id": None, "games": [],
                "players": [], "sources": [], "capabilities": {}, "reason": "Exact slate cache missing."}
    monkeypatch.setattr(routes, "read_opportunity_artifact", read)
    response = client.get("/api/lineup/evidence?season=2026&week=5&slate_id=exact-slate")
    assert response.status_code == 200
    assert response.json()["games"] == []
    assert contexts == [{"site": "draftkings", "sport": "NFL", "format": "classic", "season": 2026, "week": 5, "slate_id": "exact-slate"}]
    monkeypatch.setattr(routes, "read_opportunity_artifact", lambda context: {"context": context, "sources": [{"private": "must-not-leak"}], "games": [1], "capabilities": {"hosted_display_allowed": False}})
    assert client.get("/api/lineup/evidence?season=2026&week=5&slate_id=exact-slate").json()["sources"] == []


def test_available_and_corrupt_evidence(client, monkeypatch):
    monkeypatch.setattr(routes, "read_opportunity_artifact", lambda context: {"context": context, "content_id": "a", "observation_ledger": {"raw": "offline"}, "capabilities": {"hosted_display_allowed": True}})
    body = client.get("/api/lineup/evidence?season=2026&week=5&slate_id=x").json()
    assert body["status"] == "available"
    assert "observation_ledger" not in body
    def broken(context):
        raise ValueError("bad hash")
    monkeypatch.setattr(routes, "read_opportunity_artifact", broken)
    assert client.get("/api/lineup/evidence?season=2026&week=5&slate_id=x").status_code == 503


@pytest.mark.parametrize("query", ["season=2026&week=0&slate_id=x", "season=2026&week=5", "site=draftkings_showdown&season=2026&week=5&slate_id=x"])
def test_query_bounds(client, query):
    assert client.get("/api/lineup/evidence?" + query).status_code == 422


def test_compare_offloads_one_frozen_pool_without_loading_current_forecasts(client, payload, monkeypatch):
    captured = {}
    async def submit(func, pool, **kwargs):
        captured.update(func=func, pool=pool, kwargs=kwargs)
        return {"snapshot_id": "common:1", "candidates": []}
    monkeypatch.setattr(routes, "submit_cpu_job", submit)
    result = client.post("/api/lineup/compare-classic", json=payload)
    assert result.status_code == 200
    assert captured["func"] is routes.compare_classic_lineups
    assert captured["pool"][0].proj == 10
    assert captured["kwargs"]["snapshot_context"]["input_snapshot_id"] == "decision:exact"
    assert captured["kwargs"]["site"] == "draftkings"


@pytest.mark.parametrize("mutation", ["padded", "duplicate", "null", "reversed", "salary", "too-many", "extra", "badformat", "minsalary", "duplicate-lock", "boolean", "numeric-string"])
def test_comparison_rejects_invalid_frozen_inputs(client, payload, mutation):
    if mutation == "padded": payload["pool"][0]["player_id"] = " padded "
    if mutation == "duplicate": payload["pool"][1]["player_id"] = "p0"
    if mutation == "null": payload["pool"][0]["proj"] = None
    if mutation == "reversed": payload["pool"][0]["floor"] = 11
    if mutation == "salary": payload["pool"][0]["salary"] = 5000.5
    if mutation == "too-many": payload["pool"] = payload["pool"] * 84
    if mutation == "extra": payload["write_lineups"] = True
    if mutation == "badformat": payload["context"]["format"] = "showdown"
    if mutation == "minsalary": payload.update(min_salary=50000, salary_cap=49000)
    if mutation == "duplicate-lock": payload["locked_player_ids"] = ["p0", "p0"]
    if mutation == "boolean": payload["pool"][0]["proj"] = True
    if mutation == "numeric-string": payload["pool"][0]["proj"] = "10"
    assert client.post("/api/lineup/compare-classic", json=payload).status_code == 422


def test_native_rule_conflict_is_not_silently_relaxed(client, payload, monkeypatch):
    async def submit(*args, **kwargs):
        raise ValueError("Unsupported attachment control.")
    monkeypatch.setattr(routes, "submit_cpu_job", submit)
    response = client.post("/api/lineup/compare-classic", json=payload)
    assert response.status_code == 400


def test_both_routes_require_the_existing_auth_dependency():
    from fastapi import HTTPException
    app = FastAPI()
    app.include_router(routes.router)
    def deny():
        raise HTTPException(401, "Sign in")
    app.dependency_overrides[require_patron] = deny
    client = TestClient(app)
    assert client.get("/api/lineup/evidence?season=2026&week=5&slate_id=x").status_code == 401
    assert client.post("/api/lineup/compare-classic", json={}).status_code == 401


@pytest.mark.parametrize("mutation", ["unknown-control", "oversize-core", "optional-count", "unknown-case-field"])
def test_nested_comparison_controls_are_bounded_and_strict(client, payload, mutation):
    case = {"id": "one", "qb_id": "p0", "attachments": {"mode": "exact", "count": 1},
            "bring_back": {"mode": "optional", "count": 0}, "core_player_ids": []}
    if mutation == "unknown-control": case["attachments"]["guess_routes"] = True
    if mutation == "oversize-core": case["core_player_ids"] = [f"p{i}" for i in range(10)]
    if mutation == "optional-count": case["bring_back"]["count"] = 1
    if mutation == "unknown-case-field": case["submit_entries"] = True
    payload["requests"] = [case]
    assert client.post("/api/lineup/compare-classic", json=payload).status_code == 422
