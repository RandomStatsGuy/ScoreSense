import asyncio
import json
from unittest.mock import Mock

import pandas as pd
import pytest
from fastapi import BackgroundTasks


@pytest.mark.parametrize("kind", ["weekly", "ros"])
def test_default_projection_reads_resolve_context_and_never_infer(monkeypatch, kind):
    import app.api as api
    from app import projection_recovery as recovery
    monkeypatch.setattr(recovery, "_ACTIVE", set())
    monkeypatch.setattr(recovery, "_RESULTS", {})
    context = Mock(return_value=(2026, 5))
    monkeypatch.setattr(api, "resolve_cached_context", context)
    def read(position, **kwargs):
        assert kwargs["allow_compute"] is False
        assert kwargs["allow_stale"] is True
        assert (kwargs["season"], kwargs["week"]) == (2026, 5)
        return pd.DataFrame()
    monkeypatch.setattr(api, "load_weekly_prediction" if kind == "weekly" else "load_ros_prediction", read)
    monkeypatch.setattr(api, "get_process_executor", lambda: pytest.fail("synchronous inference wait"))
    result = (api._predict_response if kind == "weekly" else api._ros_response)("wr", background_tasks=BackgroundTasks())
    assert result.status_code == 503
    assert json.loads(result.body)["projection_recovery"]["status"] == "queued"
    context.assert_called_once_with("wr", None, None)


def test_injury_refresh_is_coalesced_and_runs_on_cpu_worker(monkeypatch):
    from app import injury_refresh as refresh
    monkeypatch.setattr(refresh, "_PENDING", False)
    calls = []
    async def submit(func, *args):
        calls.append((func, args))
        return {"status": "ok"}
    monkeypatch.setattr(refresh, "submit_cpu_job", submit)
    tasks = BackgroundTasks()
    assert refresh.queue_injury_refresh(tasks)["status"] == "queued"
    assert refresh.queue_injury_refresh(tasks)["status"] == "running"
    assert not calls
    asyncio.run(tasks())
    assert calls == [(refresh.run_injury_poll, (False, True, "scheduled"))]
    assert refresh._PENDING is False


def test_injury_poll_os_lock_blocks_even_forced_duplicate(tmp_path, monkeypatch):
    from src.integrations import injury_poll as poll
    from src.jobs.refresh_lock import refresh_lock
    monkeypatch.setattr(poll, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(poll, "get_injury_poll_status", lambda: {})
    producer = Mock()
    monkeypatch.setattr(poll, "load_sleeper_players", producer)
    with refresh_lock(tmp_path / "injury_poll.lock"):
        assert poll.run_injury_poll(force=True)["status"] == "already_running"
    producer.assert_not_called()


@pytest.mark.parametrize("abandoned_flag", [False, True])
def test_injury_worker_rechecks_freshness_and_recovers_abandoned_flag(tmp_path, monkeypatch, abandoned_flag):
    from datetime import datetime, timezone
    from src.integrations import injury_poll as poll
    clock = datetime(2026, 10, 9, 20, 0, tzinfo=timezone.utc)
    status_path = tmp_path / "status.json"
    status_path.write_text(json.dumps({"is_refreshing": abandoned_flag, "last_polled_at": clock.isoformat()}), encoding="utf-8")
    monkeypatch.setattr(poll, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(poll, "INJURY_POLL_STATUS_PATH", status_path)
    monkeypatch.setattr(poll, "PLAYERS_CACHE", tmp_path / "players.json")
    monkeypatch.setattr(poll, "_utc_now", lambda: clock)
    monkeypatch.setattr(poll, "get_nfl_state", lambda **kw: {"season_type": "regular"})
    producer = Mock(return_value={})
    monkeypatch.setattr(poll, "load_sleeper_players", producer)
    result = poll.run_injury_poll(recompute_overlays=False)
    assert result["status"] == ("ok" if abandoned_flag else "not_due")
    assert producer.call_count == int(abandoned_flag)
    assert json.loads(status_path.read_text())["is_refreshing"] is False


def test_default_context_uses_disk_only_and_reloads_replaced_features(tmp_path, monkeypatch):
    from src.projections import projection_meta as meta
    from src.core import projection_context as context, schedule_utils
    monkeypatch.setattr(meta, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(schedule_utils, "SCHEDULE_CACHE", tmp_path / "missing.parquet")
    def state(**kwargs):
        assert kwargs == {"allow_stale": True}
        return {}
    monkeypatch.setattr(context, "get_nfl_state", state)
    monkeypatch.setattr(schedule_utils, "_load_schedules", lambda *a, **kw: pd.DataFrame())
    frame = pd.DataFrame([{"season": 2026, "week": 4, "team": "KC"}])
    path = tmp_path / "qb_mlready.parquet"
    frame.to_parquet(path)
    assert meta.resolve_cached_context("qb", None, None) == (2026, 5)
    assert meta.resolve_cached_context("qb", None, None) == (2026, 5)
    frame["week"] = 5
    frame.to_parquet(path)
    assert meta.resolve_cached_context("qb", None, None) == (2026, 6)


def test_cached_calendar_keeps_current_season_when_schedule_cache_is_missing(tmp_path, monkeypatch):
    from src.projections import projection_meta as meta
    from src.core import projection_context as context, schedule_utils
    monkeypatch.setattr(meta, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(context, "get_nfl_state", lambda **kw: {"season": "2026", "week": 5, "season_type": "regular"})
    monkeypatch.setattr(schedule_utils, "_load_schedules", lambda *a, **kw: pd.DataFrame())
    pd.DataFrame([{"season": 2025, "week": 18, "team": "KC"}]).to_parquet(tmp_path / "qb_mlready.parquet")
    assert meta.resolve_cached_context("qb", None, None) == (2026, 5)
    assert meta.resolve_cached_context("qb", None, 6) == (2026, 6)
