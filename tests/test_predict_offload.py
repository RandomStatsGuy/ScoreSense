"""Projection reads serve artifacts immediately and queue missing forecasts."""

import asyncio
import json
from fastapi import BackgroundTasks
import pandas as pd
import pytest

import app.api as api


def _rows():
    return pd.DataFrame(
        {
            "Player": ["A. Player"],
            "Projected Points": [18.0],
            "Team": ["KC"],
            "Season": [2025],
            "Week": [10],
        }
    )


def test_cold_cache_returns_before_shared_worker_recovery(monkeypatch):
    from app import projection_recovery as recovery
    monkeypatch.setattr(recovery, "_ACTIVE", set())
    monkeypatch.setattr(recovery, "_RESULTS", {})
    state = {"warm": False}
    compute_calls = []

    def fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True, allow_stale=False):
        assert allow_compute is False, "API should never compute inline when season/week are set"
        return _rows() if state["warm"] else pd.DataFrame()

    def fake_compute(position, season, week, apply_injury):
        compute_calls.append((position, season, week, apply_injury))
        state["warm"] = True
        return 1

    async def submit(func, season, week, kinds):
        assert kinds == ("weekly",)
        fake_compute("qb", season, week, False)
        return {"status": "ok"}
    monkeypatch.setattr(api, "load_weekly_prediction", fake_load)
    monkeypatch.setattr(api, "compute_weekly_artifact", fake_compute)
    monkeypatch.setattr(recovery, "submit_cpu_job", submit)
    monkeypatch.setattr(api, "get_process_executor", lambda: pytest.fail("HTTP read waited for inference"))

    tasks = BackgroundTasks()
    response = api._predict_response("qb", season=2025, week=10, apply_injury_adjustments=False, background_tasks=tasks)

    assert response.status_code == 503
    assert response.headers["retry-after"] == "60"
    assert json.loads(response.body)["projection_recovery"]["status"] == "queued"
    assert not compute_calls
    asyncio.run(response.background())
    assert compute_calls == [("qb", 2025, 10, False)]
    response = api._predict_response("qb", season=2025, week=10, apply_injury_adjustments=False)
    assert response["count"] == 1


def test_cache_hit_skips_process_pool(monkeypatch):
    def fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True, allow_stale=False):
        return _rows()

    def fail_executor():
        raise AssertionError("process pool should not be used on cache hits")

    monkeypatch.setattr(api, "load_weekly_prediction", fake_load)
    monkeypatch.setattr(api, "get_process_executor", fail_executor)

    response = api._predict_response("qb", season=2025, week=10)
    assert response["count"] == 1


def test_missing_artifacts_respond_503_without_loading_a_model(monkeypatch):
    def fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True, allow_stale=False):
        return pd.DataFrame()

    def fake_compute(position, season, week, apply_injury):
        raise FileNotFoundError("model missing")

    monkeypatch.setattr(api, "load_weekly_prediction", fake_load)
    monkeypatch.setattr(api, "compute_weekly_artifact", fake_compute)
    monkeypatch.setattr(api, "get_process_executor", lambda: pytest.fail("read must not submit inference"))

    response = api._predict_response("qb", season=2025, week=10)
    assert response.status_code == 503
