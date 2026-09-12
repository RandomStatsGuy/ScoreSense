"""Refresh status file — running marker, errors, and UI-facing completed flag."""

from __future__ import annotations

import json
from unittest.mock import patch

from src.jobs import weekly_refresh as wr


def test_mark_refresh_started_writes_running(tmp_path, monkeypatch):
    status_path = tmp_path / "last_refresh.json"
    monkeypatch.setattr(wr, "REFRESH_STATUS", status_path)
    started = wr.mark_refresh_started(retrain=False, draft_only=False)
    assert started["status"] == "running"
    assert started["started_at"]
    on_disk = json.loads(status_path.read_text())
    assert on_disk["status"] == "running"
    assert wr.get_refresh_status()["status"] == "running"


def test_get_refresh_status_legacy_completed(tmp_path, monkeypatch):
    status_path = tmp_path / "last_refresh.json"
    status_path.write_text(
        json.dumps({"started_at": "2026-06-01T00:00:00+00:00", "completed_at": "2026-06-01T01:00:00+00:00"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(wr, "REFRESH_STATUS", status_path)
    status = wr.get_refresh_status()
    assert status["status"] == "completed"


def test_run_weekly_refresh_records_error(tmp_path, monkeypatch):
    status_path = tmp_path / "last_refresh.json"
    monkeypatch.setattr(wr, "REFRESH_STATUS", status_path)
    with patch.object(wr, "invalidate_weekly_cache", side_effect=RuntimeError("cache locked")):
        try:
            wr.run_weekly_refresh(retrain=False, seasons=[2026], draft_only=False)
        except RuntimeError:
            pass
        else:
            raise AssertionError("expected RuntimeError")
    status = wr.get_refresh_status()
    assert status["status"] == "error"
    assert "cache locked" in status["error"]
    assert status.get("completed_at")


def test_retrain_false_skips_etl(tmp_path, monkeypatch):
    status_path = tmp_path / "last_refresh.json"
    monkeypatch.setattr(wr, "REFRESH_STATUS", status_path)
    with (
        patch.object(wr, "build_all_datasets") as etl,
        patch.object(wr, "invalidate_weekly_cache", side_effect=RuntimeError("stop after skip")),
    ):
        try:
            wr.run_weekly_refresh(retrain=False, seasons=[2026], draft_only=False)
        except RuntimeError:
            pass
        else:
            raise AssertionError("expected RuntimeError")
    etl.assert_not_called()


def test_running_worker_is_single_flight_and_dead_worker_is_reported(tmp_path, monkeypatch):
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    with wr.refresh_lock(wr.REFRESH_STATUS.with_suffix(".lock")):
        wr.mark_refresh_started(retrain=False)
        wr._progress("weekly")
        assert wr.public_refresh_status()["status"] == "running"
        with patch.object(wr, "_execute_weekly_refresh") as execute:
            assert wr.run_weekly_refresh(False)["status"] == "running"
            execute.assert_not_called()
    assert wr.public_refresh_status()["status"] == "error"


def test_failure_preserves_last_success_and_progress(tmp_path, monkeypatch):
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    wr._write_refresh_status({"status": "completed", "started_at": "old", "completed_at": "2026-09-10T01:00:00+00:00"})
    wr.mark_refresh_started(retrain=False)
    wr._progress("draft")
    wr.record_refresh_failure("disk full")
    status = wr.get_refresh_status()
    assert status["status"] == "error"
    assert status["stage"] == "draft"
    assert status["last_completed_at"] == "2026-09-10T01:00:00+00:00"
    assert not list(tmp_path.glob("*.tmp"))


def test_manual_refresh_orders_inputs_before_all_projection_caches(tmp_path, monkeypatch):
    from contextlib import ExitStack
    import pandas as pd
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    events = []
    def event(name, result=None):
        def call(*args, **kwargs):
            events.append(name)
            return result
        return call
    with ExitStack() as stack:
        def mock(target, **kwargs):
            return stack.enter_context(patch(target, **kwargs))
        mock("src.jobs.weekly_refresh.get_nfl_state", return_value={"season": 2026, "week": 1})
        mock("src.jobs.weekly_refresh.is_nfl_offseason", return_value=False)
        mock("src.jobs.weekly_refresh.get_projection_meta", return_value={"default_season": 2026, "default_week": 1})
        mock("src.jobs.weekly_refresh.get_draft_meta", return_value={"default_season": 2026})
        mock("src.integrations.fantasypros.fantasypros_api_key_configured", return_value=True)
        mock("src.integrations.fantasypros.archive_fantasypros_week", return_value={})
        mock("src.integrations.fantasypros_enrich.enrich_position_mlready", side_effect=event("inputs"))
        mock("src.jobs.weekly_refresh.predict_all_positions", side_effect=event("weekly", {"qb": pd.DataFrame()}))
        warm = mock("src.jobs.weekly_refresh.prewarm_weekly_predictions", return_value={})
        mock("src.projections.projection_movement.build_projection_movement_payload", return_value={})
        mock("src.jobs.weekly_refresh.prewarm_ros_predictions", side_effect=event("ros", {}))
        mock("src.jobs.weekly_refresh.save_pool_artifact", side_effect=event("draft"))
        mock("src.jobs.weekly_refresh.pool_artifact_status", return_value={"cached": True, "position_counts": {"QB": 1}})
        mock("src.integrations.fantasypros.prefetch_draft_season_ecr", return_value={})
        mock("src.integrations.dfs_slates.prefetch_all_main_slates", return_value={})
        mock("src.integrations.odds_api.odds_api_key_configured", return_value=False)
        sentiment = mock("src.jobs.sentiment_refresh.run_sentiment_refresh")
        mock("src.jobs.prewarm_fantasy_media_digests.prewarm_fantasy_media_digests", return_value={})
        mock("src.projections.injury_overlay.prewarm_injury_overlays", return_value={})
        mock("src.projections.player_context.prewarm_player_context", side_effect=RuntimeError("notes unavailable"))
        mock("src.jobs.weekly_refresh.injured_players", return_value=[])
        report = mock("src.jobs.weekly_refresh.save_target_quality_report")
        result = wr.run_weekly_refresh(retrain=False, seasons=[2026])
    assert events == ["inputs", "inputs", "inputs", "weekly", "ros", "draft"]
    assert warm.call_args.kwargs["force"] is False  # predict_all already saved all six variants
    sentiment.assert_not_called()
    report.assert_not_called()
    assert result["warnings"] == ["player_context_prewarm"]
    assert wr.get_refresh_status()["last_completed_at"] == result["completed_at"]


def test_refresh_route_returns_immediately_and_reuses_queued_job(tmp_path, monkeypatch):
    import asyncio
    from app import api
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    monkeypatch.setattr(api, "REFRESH_STATUS", wr.REFRESH_STATUS)
    with patch.object(api, "submit_cpu_job") as submit:
        first = asyncio.run(api.refresh(retrain=False, _user={}))
        second = asyncio.run(api.refresh(retrain=False, _user={}))
    assert first["status"] == second["status"] == "running"
    assert first["started_at"] == second["started_at"]
    submit.assert_called_once_with(wr.run_weekly_refresh, False, None, False, first["started_at"])


def test_refresh_route_records_submission_failure(tmp_path, monkeypatch):
    import asyncio
    import pytest
    from fastapi import HTTPException
    from app import api
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    monkeypatch.setattr(api, "REFRESH_STATUS", wr.REFRESH_STATUS)
    with patch.object(api, "submit_cpu_job", side_effect=RuntimeError("pool unavailable")):
        with pytest.raises(HTTPException):
            asyncio.run(api.refresh(retrain=False, _user={}))
    assert wr.public_refresh_status()["status"] == "error"


def test_legacy_interrupted_job_is_persisted_and_can_be_retried(tmp_path, monkeypatch):
    import asyncio
    from app import api
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    monkeypatch.setattr(api, "REFRESH_STATUS", wr.REFRESH_STATUS)
    # Same shape as the production marker left behind by a container restart.
    wr.REFRESH_STATUS.write_text(json.dumps({
        "status": "running", "started_at": "2026-09-01T01:00:00+00:00",
        "retrain": False, "draft_only": False,
        "last_completed_at": "2026-08-31T01:00:00+00:00",
    }))
    stopped = wr.public_refresh_status()
    assert stopped["status"] == wr.get_refresh_status()["status"] == "error"
    assert stopped["completed_at"]
    with patch.object(api, "submit_cpu_job") as submit:
        retry = asyncio.run(api.refresh(retrain=False, _user={}))
    assert retry["status"] == "running"
    assert retry["stage"] == "queued"
    assert retry["last_completed_at"] == stopped["last_completed_at"]
    assert "error" not in wr.get_refresh_status()
    submit.assert_called_once()
    submit.return_value.add_done_callback.assert_called_once()


def test_background_failure_updates_status_without_waiting_for_queue_timeout(tmp_path, monkeypatch):
    import asyncio
    from app import api
    from concurrent.futures.process import BrokenProcessPool
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    monkeypatch.setattr(api, "REFRESH_STATUS", wr.REFRESH_STATUS)

    async def exercise():
        future = asyncio.get_running_loop().create_future()
        with patch.object(api, "submit_cpu_job", return_value=future):
            started = await api.refresh(retrain=False, _user={})
        future.set_exception(BrokenProcessPool("worker died"))
        await asyncio.sleep(0)
        status = wr.get_refresh_status()
        assert status["status"] == "error"
        assert status["started_at"] == started["started_at"]
        assert "worker" in status["error"]
    asyncio.run(exercise())


def test_late_worker_callback_does_not_overwrite_new_run_or_original_error(tmp_path, monkeypatch):
    from concurrent.futures import Future
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    first = wr.mark_refresh_started(retrain=False)
    failed = Future()
    failed.set_exception(RuntimeError("dispatch failure"))
    wr.record_refresh_failure("specific failure", started_at=first["started_at"])
    wr.record_refresh_job_result(failed, started_at=first["started_at"])
    assert wr.get_refresh_status()["error"] == "specific failure"
    next_run = wr.mark_refresh_started(retrain=False)
    wr.record_refresh_job_result(failed, started_at=first["started_at"])
    assert wr.get_refresh_status()["started_at"] == next_run["started_at"]
    assert wr.get_refresh_status()["status"] == "running"


def test_cancelled_background_job_is_not_left_running(tmp_path, monkeypatch):
    from concurrent.futures import Future
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    started = wr.mark_refresh_started(retrain=False)
    cancelled = Future()
    cancelled.cancel()
    wr.record_refresh_job_result(cancelled, started_at=started["started_at"])
    assert wr.get_refresh_status()["status"] == "error"
    assert "cancelled" in wr.get_refresh_status()["error"]


def test_delayed_worker_reclaims_its_marker_after_startup_grace(tmp_path, monkeypatch):
    monkeypatch.setattr(wr, "REFRESH_STATUS", tmp_path / "refresh.json")
    started = "2026-09-01T01:00:00+00:00"
    wr._write_refresh_status({"status": "running", "stage": "queued", "started_at": started})
    assert wr.public_refresh_status()["status"] == "error"
    def inspect_running(**kwargs):
        status = wr.get_refresh_status()
        assert status["status"] == "running"
        assert status["stage"] == "starting"
        assert status["error"] is None
        assert status["completed_at"] is None
        return status
    monkeypatch.setattr(wr, "_run_weekly_refresh", inspect_running)
    wr.run_weekly_refresh(retrain=False, started_at=started)
