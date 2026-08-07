"""Cold-cache weekly predictions run in the process pool, not the request thread."""

import pandas as pd
import pytest

import app.api as api


class _InlineFuture:
    def __init__(self, fn, *args, **kwargs):
        self._fn, self._args, self._kwargs = fn, args, kwargs

    def result(self):
        return self._fn(*self._args, **self._kwargs)


class _InlineExecutor:
    def __init__(self):
        self.submissions = 0

    def submit(self, fn, *args, **kwargs):
        self.submissions += 1
        return _InlineFuture(fn, *args, **kwargs)


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


def test_cold_cache_computes_via_process_pool(monkeypatch):
    state = {"warm": False}
    compute_calls = []

    def fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True):
        assert allow_compute is False, "API should never compute inline when season/week are set"
        return _rows() if state["warm"] else pd.DataFrame()

    def fake_compute(position, season, week, apply_injury):
        compute_calls.append((position, season, week, apply_injury))
        state["warm"] = True
        return 1

    executor = _InlineExecutor()
    monkeypatch.setattr(api, "load_weekly_prediction", fake_load)
    monkeypatch.setattr(api, "compute_weekly_artifact", fake_compute)
    monkeypatch.setattr(api, "get_process_executor", lambda: executor)

    response = api._predict_response("qb", season=2025, week=10, apply_injury_adjustments=False)

    assert executor.submissions == 1
    assert compute_calls == [("qb", 2025, 10, False)]
    assert response["count"] == 1


def test_cache_hit_skips_process_pool(monkeypatch):
    def fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True):
        return _rows()

    def fail_executor():
        raise AssertionError("process pool should not be used on cache hits")

    monkeypatch.setattr(api, "load_weekly_prediction", fake_load)
    monkeypatch.setattr(api, "get_process_executor", fail_executor)

    response = api._predict_response("qb", season=2025, week=10)
    assert response["count"] == 1


def test_missing_artifacts_raise_503(monkeypatch):
    def fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True):
        return pd.DataFrame()

    def fake_compute(position, season, week, apply_injury):
        raise FileNotFoundError("model missing")

    monkeypatch.setattr(api, "load_weekly_prediction", fake_load)
    monkeypatch.setattr(api, "compute_weekly_artifact", fake_compute)
    monkeypatch.setattr(api, "get_process_executor", lambda: _InlineExecutor())

    with pytest.raises(api.HTTPException) as exc_info:
        api._predict_response("qb", season=2025, week=10)
    assert exc_info.value.status_code == 503
