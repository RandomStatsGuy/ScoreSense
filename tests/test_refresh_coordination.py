import asyncio
from unittest.mock import Mock

import pandas as pd
import pytest
from fastapi import BackgroundTasks


@pytest.mark.parametrize("module,enabled,preflight", [
    ("app.season_refresh_ticker", "PROJECTION_AUTO_REFRESH_ENABLED", "season_refresh_needed"),
    ("app.dfs_refresh_ticker", "DFS_REFRESH_ENABLED", "dfs_refresh_needed"),
])
@pytest.mark.parametrize("busy,due", [(True, True), (False, False)])
def test_routine_checks_do_not_enter_a_busy_or_unneeded_queue(monkeypatch, module, enabled, preflight, busy, due):
    import importlib
    ticker = importlib.import_module(module)
    monkeypatch.setattr(ticker, enabled, True)
    monkeypatch.setattr(ticker, "cpu_jobs_busy", lambda: busy)
    check = Mock(return_value=due)
    monkeypatch.setattr(ticker, preflight, check)
    monkeypatch.setattr(ticker, "submit_cpu_job", lambda *a: pytest.fail("unnecessary queued job"))
    sleeps = []
    async def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 2:
            raise asyncio.CancelledError
    monkeypatch.setattr(ticker.asyncio, "sleep", sleep)
    loop = ticker.season_refresh_ticker_loop if "season" in module else ticker.dfs_refresh_ticker_loop
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(loop())
    assert check.call_count == (0 if busy else 1)
    if busy:
        assert sleeps[-1] == 30


def test_overlapping_recovery_bundles_share_each_target(monkeypatch):
    from app import projection_recovery as recovery
    monkeypatch.setattr(recovery, "_ACTIVE", set())
    monkeypatch.setattr(recovery, "_RESULTS", {})
    monkeypatch.setattr("src.jobs.season_refresh.target_due", lambda *a: True)
    calls = []
    async def submit(func, season, week, kinds):
        calls.append((season, week, kinds))
        return {"status": "ok", "failed": []}
    monkeypatch.setattr(recovery, "submit_cpu_job", submit)
    tasks = BackgroundTasks()
    assert recovery.queue_projection_recovery(tasks, 2026, 5, ["weekly", "ros"])["status"] == "queued"
    assert recovery.queue_projection_recovery(tasks, 2026, 5, ["weekly", "draft"])["status"] == "queued"
    assert recovery.queue_projection_recovery(tasks, 2026, 5, ["weekly"])["status"] == "running"
    asyncio.run(tasks())
    assert calls == [(2026, 5, ("ros", "weekly")), (2026, 5, ("draft",))]
    assert not recovery._ACTIVE


def test_ros_repaired_while_waiting_does_not_repeat_inference(tmp_path, monkeypatch):
    from src.jobs import projection_recovery as repair
    from src.projections import ros_cache
    monkeypatch.setattr(repair, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(ros_cache, "ROS_PREDICTIONS_DIR", tmp_path / "ros")
    monkeypatch.setattr(ros_cache, "ros_fingerprint", lambda: "stable")
    monkeypatch.setattr(ros_cache, "_with_roster_identity", lambda frame, *a, **kw: frame)
    producer = Mock(side_effect=AssertionError("duplicate inference after another refresh published"))
    monkeypatch.setattr(ros_cache, "predict_rest_of_season", producer)
    frame = pd.DataFrame([{"ROS P10": 10, "ROS P50": 20, "ROS P90": 30}])
    for pos in ("qb", "rb", "wr"):
        for injury in (True, False):
            ros_cache.save_ros_artifact(pos, 2026, 5, injury, frame)
    assert repair.rebuild_projection_context(2026, 5, ("ros",))["status"] == "ok"
    producer.assert_not_called()


def test_cancelled_repair_observer_keeps_target_claimed_until_worker_finishes(monkeypatch):
    from app import projection_recovery as recovery
    monkeypatch.setattr(recovery, "_ACTIVE", set())
    monkeypatch.setattr(recovery, "_RESULTS", {})

    async def exercise():
        worker = asyncio.get_running_loop().create_future()
        monkeypatch.setattr(recovery, "submit_cpu_job", lambda *a: worker)
        tasks = BackgroundTasks()
        recovery.queue_projection_recovery(tasks, 2026, 5, ["weekly"])
        observer = asyncio.create_task(tasks())
        await asyncio.sleep(0)
        observer.cancel()
        with pytest.raises(asyncio.CancelledError):
            await observer
        assert recovery.queue_projection_recovery(BackgroundTasks(), 2026, 5, ["weekly"])["status"] == "running"
        assert not worker.cancelled()
        worker.set_result({"status": "ok", "failed": []})
        await asyncio.sleep(0)
        assert not recovery._ACTIVE
        assert recovery.projection_recovery_status(2026, 5, ["weekly"])["status"] == "ok"

    asyncio.run(exercise())


def test_partial_repair_failure_is_reported_only_for_affected_target(monkeypatch):
    from app import projection_recovery as recovery
    monkeypatch.setattr(recovery, "_ACTIVE", set())
    monkeypatch.setattr(recovery, "_RESULTS", {})
    monkeypatch.setattr("src.jobs.season_refresh.target_due", lambda *a: True)

    async def submit(*a):
        return {"status": "error", "failed": ["ros:qb"]}

    monkeypatch.setattr(recovery, "submit_cpu_job", submit)
    tasks = BackgroundTasks()
    recovery.queue_projection_recovery(tasks, 2026, 5, ["weekly", "ros"])
    asyncio.run(tasks())
    weekly = recovery.projection_recovery_status(2026, 5, ["weekly"])
    assert weekly["status"] == "ok" and weekly["failed"] == []
    assert recovery.projection_recovery_status(2026, 5, ["ros"])["failed"] == ["ros:qb"]
