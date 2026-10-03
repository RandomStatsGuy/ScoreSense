import asyncio
from concurrent.futures import Future, ThreadPoolExecutor
import json
import sqlite3
import threading
import time

import pytest

from src.ops import job_diagnostics as diag
from src.ops.job_report import main, read_report


def rows(path):
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute("SELECT * FROM runs ORDER BY submitted")]


def test_queue_execution_cpu_and_private_payloads_are_separate(diagnostics_enabled, monkeypatch):
    clock = {"ns": 100_000_000_000, "cpu": 10.0}
    monkeypatch.setattr(diag.time, "monotonic_ns", lambda: clock["ns"])
    monkeypatch.setattr(diag.time, "process_time", lambda: clock["cpu"])
    private = {"status": "ok", "secret": "credential-test-only", "league_id": "private-league",
               "players": [{"email": "private@example.test"}]}
    def newly_added_job(token):
        diag.annotate_job(season=2026, week=4, input_revision="opaque-input", force=True,
                          email=token, league_id="private-league", raw_payload=private)
        clock["ns"] += 3_000_000_000
        clock["cpu"] += 1.25
        return private
    ticket = diag.queue_job(newly_added_job)
    clock["ns"] += 2_000_000_000
    assert diag.execute_job(newly_added_job, ("private@example.test",), {}, ticket) is private
    run = rows(diagnostics_enabled)[0]
    assert (run["queue_s"], run["wall_s"], run["cpu_s"], run["scope"]) == (2, 3, 1.25, "process")
    report = read_report(diagnostics_enabled)
    assert report["jobs"][0]["queue_avg_s"] == 2
    assert report["jobs"][0]["cpu_total_s"] == 1.25
    output = json.dumps(report) + json.dumps(run)
    for secret in ("private@example.test", "credential-test-only", "private-league", "opaque-input"):
        assert secret not in output
    assert json.loads(run["metadata"])["input_revision"]


def test_nested_phases_skips_failures_and_repeated_revisions(diagnostics_enabled):
    @diag.observe_job("example")
    def job(fail=False):
        diag.annotate_job(input_revision="same", season=2026, week=4)
        diag.call_phase("check", lambda: {"status": "skipped", "reason": "no_material_change"})
        if fail:
            raise ValueError("sensitive exception text")
        return {"status": "current"}
    job()
    with pytest.raises(ValueError, match="sensitive exception text"):
        job(True)
    report = read_report(diagnostics_enabled)
    parent = next(job for job in report["jobs"] if job["job"] == "example")
    child = next(job for job in report["jobs"] if job["job"] == "example.check")
    assert parent["runs"] == 2 and parent["failures"] == 1 and parent["same_input"] == 1
    assert child["nested"] and child["skips"] == 2
    assert child["recent_reasons"] == {"no_material_change": 2}
    assert "sensitive exception text" not in json.dumps(report)
    assert report["recent_problems"][0]["error_type"] == "ValueError"
    assert parent["queue_avg_s"] is None  # direct invocation has no measured queue


def test_cpu_clock_failure_is_unknown_not_zero(diagnostics_enabled, monkeypatch):
    monkeypatch.setattr(diag, "_cpu", lambda _: None)
    result = diag.execute_job(abs, (-3,), {}, diag.queue_job(abs))
    assert result == 3
    report = read_report(diagnostics_enabled)
    job = report["jobs"][0]
    assert job["cpu_total_s"] is None and job["cpu_max_s"] is None
    assert job["cpu_samples"] == 0 and job["cpu_wall_ratio_sample"] is None
    assert "cpu_sum" not in job and "cpu_max" not in job


@pytest.mark.parametrize("broken", ["_options", "_write", "_start", "_finish"])
def test_instrumentation_failure_preserves_exact_result_and_exception(diagnostics_enabled, monkeypatch, broken):
    ticket = diag.queue_job(abs)
    def fail(*args, **kwargs):
        raise OSError("secret path")
    monkeypatch.setattr(diag, broken, fail)
    calls, payload = [], object()
    def job():
        calls.append(1)
        return payload
    assert diag.execute_job(job, (), {}, ticket) is payload
    error = ValueError("same exception object")
    def failing():
        raise error
    with pytest.raises(ValueError) as caught:
        diag.execute_job(failing, (), {}, ticket)
    assert caught.value is error and calls == [1]


def test_disabled_diagnostics_create_no_file(tmp_path, monkeypatch):
    from src import config
    path = tmp_path / "disabled.sqlite3"
    monkeypatch.setattr(config, "JOB_DIAGNOSTICS_ENABLED", False)
    monkeypatch.setattr(config, "JOB_DIAGNOSTICS_PATH", path)
    @diag.observe_job("disabled")
    def job():
        return 7
    assert job() == 7 and diag.queue_job(job) is None
    assert not path.exists()


def test_retention_bounds_runs_without_losing_hourly_counts(diagnostics_enabled, monkeypatch):
    from src import config
    monkeypatch.setattr(config, "JOB_DIAGNOSTICS_MAX_RUNS", 3)
    @diag.observe_job("repeat")
    def job():
        return {"status": "current"}
    for _ in range(7):
        job()
    assert len(rows(diagnostics_enabled)) == 3
    assert read_report(diagnostics_enabled)["jobs"][0]["runs"] == 7
    with sqlite3.connect(diagnostics_enabled) as conn:
        conn.execute("UPDATE runs SET submitted=0")
        conn.execute("UPDATE buckets SET hour=0")
    diag.queue_job(abs)
    assert len(rows(diagnostics_enabled)) == 1
    assert read_report(diagnostics_enabled)["jobs"] == []


def test_concurrent_writers_and_locked_store_cannot_break_jobs(diagnostics_enabled):
    @diag.observe_job("concurrent")
    def job(value):
        return value * 2
    job(0)  # initialize before contention
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(job, range(12))) == [n * 2 for n in range(12)]
    with sqlite3.connect(diagnostics_enabled) as conn:
        conn.execute("BEGIN IMMEDIATE")
        assert job(7) == 14
        conn.rollback()
    with sqlite3.connect(diagnostics_enabled) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert read_report(diagnostics_enabled)["available"]


def test_size_guard_drops_evidence_and_keeps_job_result(diagnostics_enabled, monkeypatch):
    from src import config
    @diag.observe_job("size_guard")
    def job():
        return 19
    assert job() == 19
    before = len(rows(diagnostics_enabled))
    monkeypatch.setattr(config, "JOB_DIAGNOSTICS_MAX_BYTES", 1)
    assert job() == 19
    assert len(rows(diagnostics_enabled)) == before
    assert read_report(diagnostics_enabled)["available"]


def test_overlapping_async_work_has_no_attributed_cpu(diagnostics_enabled):
    @diag.observe_async_job("async_example")
    async def job():
        await asyncio.sleep(0)
        return 11
    async def run():
        assert await asyncio.gather(job(), job()) == [11, 11]
    asyncio.run(run())
    report = read_report(diagnostics_enabled)
    assert report["retained_top_level_overlap_intervals"] == 1
    assert report["jobs"][0]["cpu_total_s"] is None


def test_observer_cancel_does_not_claim_worker_stopped_and_loss_has_unknown_cpu(diagnostics_enabled):
    ticket = diag.queue_job(abs)
    future = Future()
    future.cancel()
    diag.future_observed(future, ticket)
    assert rows(diagnostics_enabled)[0]["state"] == "queued"
    assert rows(diagnostics_enabled)[0]["observer_cancelled"] == 1
    diag.execute_job(abs, (-2,), {}, ticket)
    assert rows(diagnostics_enabled)[0]["state"] == "finished"
    lost = diag.queue_job(abs)
    future = Future()
    future.set_exception(RuntimeError("private worker details"))
    diag.future_observed(future, lost)
    problem = read_report(diagnostics_enabled)["recent_problems"][0]
    assert problem["state"] == "lost" and problem["cpu_s"] is None and problem["wall_s"] is None


def test_executor_failure_after_execution_keeps_timing_and_records_failure_once(diagnostics_enabled):
    ticket = diag.queue_job(abs)
    assert diag.execute_job(abs, (-2,), {}, ticket) == 2
    future = Future()
    future.set_exception(TypeError("sensitive serialization details"))
    diag.future_observed(future, ticket)
    diag.future_observed(future, ticket)
    report = read_report(diagnostics_enabled)
    assert report["jobs"][0]["failures"] == 1
    assert report["recent_problems"][0]["wall_s"] is not None
    assert report["recent_problems"][0]["error_type"] == "TypeError"
    assert "sensitive serialization" not in json.dumps(report)


def _exit_diagnostic_worker():
    import os
    os._exit(7)


def test_actual_worker_loss_is_observed_and_later_work_still_runs(diagnostics_enabled):
    from app import process_pool
    from concurrent.futures.process import BrokenProcessPool
    async def run():
        with pytest.raises(BrokenProcessPool):
            await asyncio.wait_for(process_pool.submit_cpu_job(_exit_diagnostic_worker), 20)
        await asyncio.sleep(0)
        assert await asyncio.wait_for(process_pool.submit_cpu_job(abs, -5), 20) == 5
    asyncio.run(run())
    report = read_report(diagnostics_enabled)
    problem = next(item for item in report["recent_problems"] if item["state"] == "lost")
    assert problem["error_type"] == "BrokenProcessPool" and problem["cpu_s"] is None
    assert any(job["job"] == "builtins.abs" and job["cpu_samples"] == 1 for job in report["jobs"])


def test_two_process_writers_preserve_results_and_store_integrity(diagnostics_enabled):
    from app import process_pool
    process_pool.init_process_executor(max_workers=2)
    async def run():
        assert await asyncio.gather(*(process_pool.submit_cpu_job(abs, -n) for n in range(6))) == list(range(6))
    asyncio.run(run())
    with sqlite3.connect(diagnostics_enabled) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert read_report(diagnostics_enabled)["available"]


def test_shared_cpu_pool_automatically_observes_new_unregistered_job(diagnostics_enabled):
    from app import process_pool
    async def run():
        assert await process_pool.submit_cpu_job(abs, -17) == 17
        await asyncio.sleep(0)
    asyncio.run(run())
    report = read_report(diagnostics_enabled)
    job = next(job for job in report["jobs"] if job["job"] == "builtins.abs")
    assert job["cpu_scope"] == "process" and job["queue_samples"] == 1
    assert job["cpu_samples"] == 1 and job["runs"] == 1


def _worker_database_paths():
    from src import config
    from src.draft_hub import storage
    from src.auth import user_store
    with storage.get_conn() as conn:
        conn.execute("SELECT 1").fetchone()
    with user_store.get_conn() as conn:
        conn.execute("SELECT 1").fetchone()
    return {"hub": str(config.DRAFT_HUB_DB), "auth": str(config.AUTH_DB),
            "diagnostics": str(config.JOB_DIAGNOSTICS_PATH)}


def test_api_startup_alias_worker_inherits_disposable_paths(diagnostics_enabled):
    from app import api, process_pool
    from src import config
    import hashlib
    tracked = config.PROJECT_ROOT / "data/draft_hub/draft_hub.db"
    before = hashlib.sha256(tracked.read_bytes()).hexdigest() if tracked.exists() else None
    api.init_process_executor(max_workers=1)  # actual imported startup alias
    async def run():
        return await process_pool.submit_cpu_job(_worker_database_paths)
    result = asyncio.run(run())
    assert result == {"hub": str(config.DRAFT_HUB_DB), "auth": str(config.AUTH_DB),
                      "diagnostics": str(diagnostics_enabled)}
    assert config.DRAFT_HUB_DB.exists() and config.AUTH_DB.exists()
    after = hashlib.sha256(tracked.read_bytes()).hexdigest() if tracked.exists() else None
    assert before == after


def test_database_override_is_ignored_outside_test_mode(tmp_path):
    import os
    import subprocess
    import sys
    env = {**os.environ, "TESTING": "0", "SCORESENSE_TESTING": "0",
           "SCORESENSE_TEST_DATABASE_ROOT": str(tmp_path),
           "JWT_SECRET": "test-config-only-nonproduction-secret"}
    code = "from src.config import DRAFT_HUB_DB, PROJECT_ROOT; assert DRAFT_HUB_DB == PROJECT_ROOT / 'data/draft_hub/draft_hub.db'"
    result = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr


def test_thread_cancellation_can_finish_in_background(diagnostics_enabled):
    started, release = threading.Event(), threading.Event()
    def thread_job():
        started.set()
        assert release.wait(3)
        return {"status": "ok"}
    async def run():
        task = asyncio.create_task(diag.submit_thread_job(thread_job))
        assert await asyncio.to_thread(started.wait, 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        release.set()
    try:
        asyncio.run(run())  # waits for default executor threads to finish
    finally:
        release.set()
    run = rows(diagnostics_enabled)[0]
    assert run["state"] == "finished" and run["observer_cancelled"] == 1
    assert run["scope"] == "thread" and run["queue_s"] is not None


def test_read_command_is_bounded_read_only_and_thresholds_are_advisory(diagnostics_enabled, capsys):
    @diag.observe_job("read_example")
    def job():
        diag.annotate_job(freshness_age_s=900)
        return {"status": "other-status-with-sensitive-value"}
    job()
    report = read_report(diagnostics_enabled, limit=1, slow_s=0, cpu_s=0)
    assert len(report["jobs"]) == 1
    assert "reported_artifact_age_above_advisory" in report["jobs"][0]["advisories"]
    assert report["jobs"][0]["recent_statuses"] == {"other": 1}
    assert main(["--path", str(diagnostics_enabled), "--json", "--limit", "1"]) == 0
    assert json.loads(capsys.readouterr().out)["available"]
    missing = diagnostics_enabled.parent / "missing.sqlite3"
    assert not read_report(missing)["available"] and not missing.exists()
    corrupt = diagnostics_enabled.parent / "corrupt.sqlite3"
    corrupt.write_bytes(b"not a database")
    assert not read_report(corrupt)["available"]
