"""Recorded-stat backfills can refresh forecasts without retraining models."""
from unittest.mock import Mock

import pandas as pd
import pytest

from src.jobs import weekly_refresh as refresh


@pytest.fixture
def isolated_refresh(tmp_path, monkeypatch):
    events = []
    monkeypatch.setattr(refresh, "REFRESH_STATUS", tmp_path / "refresh.json")
    monkeypatch.setattr(refresh, "default_ingestion_seasons", lambda: [2025, 2026])
    # Every producer, provider and artifact reader is replaced. Only the job's
    # isolated status file/lock may be written by these orchestration tests.
    def step(name, result=None):
        return Mock(side_effect=lambda *args, **kwargs: events.append(name) or result)
    mocks = {
        "build_all_datasets": step("ingest"), "train_all": step("train"),
        "save_target_quality_report": step("quality_report"),
        "invalidate_weekly_cache": step("invalidate_weekly"),
        "invalidate_ros_cache": step("invalidate_ros"),
        "predict_all_positions": step("weekly_forecast", {"qb": pd.DataFrame([{"player_id": "fixture"}])}),
        "prewarm_weekly_predictions": step("weekly_publish", {}),
        "prewarm_ros_predictions": step("ros_publish", {}),
        "save_pool_artifact": step("draft_publish"),
        "pool_artifact_status": Mock(return_value={"cached": True, "position_counts": {"QB": 1}}),
        "get_nfl_state": Mock(return_value={"season": 2026, "week": 7}),
        "is_nfl_offseason": Mock(return_value=True),
        "get_projection_meta": Mock(return_value={"default_season": 2026, "default_week": 7}),
        "get_draft_meta": Mock(return_value={"default_season": 2026}),
        "injured_players": Mock(return_value=[]),
    }
    for name, replacement in mocks.items():
        monkeypatch.setattr(refresh, name, replacement)
    monkeypatch.setattr("src.integrations.fantasypros.fantasypros_api_key_configured", lambda: False)
    monkeypatch.setattr("src.integrations.fantasypros_enrich.enrich_all_mlready", lambda **_: None)
    monkeypatch.setattr("src.integrations.fantasypros_enrich.enrich_position_mlready", lambda *_, **__: None)
    monkeypatch.setattr("src.projections.projection_movement.build_projection_movement_payload", lambda *_: {})
    monkeypatch.setattr("src.jobs.prewarm_fantasy_media_digests.prewarm_fantasy_media_digests", lambda **_: {})
    monkeypatch.setattr("src.projections.injury_overlay.prewarm_injury_overlays", lambda *_, **__: {})
    monkeypatch.setattr("src.projections.player_context.prewarm_player_context", lambda *_, **__: {})
    monkeypatch.setattr("src.jobs.projection_cache_warmup.finalize_projection_caches", lambda *_, **__: {"draft_pool_artifact": {"position_counts": {"QB": 1}}})
    monkeypatch.setattr("src.projections.data_integrity.validate_recorded_backfill", lambda **_: {"status": "ready", "source_through_week": 6})
    monkeypatch.setattr("src.projections.data_integrity.audit_projection_integrity", lambda **_: {"status": "passed", "sources": {}, "findings": []})
    monkeypatch.setattr("requests.sessions.Session.request", lambda *_, **__: pytest.fail("job orchestration test attempted a provider request"))
    return events, mocks


def test_explicit_ingestion_precedes_forecasts_without_training(isolated_refresh):
    events, mocks = isolated_refresh
    result = refresh.run_weekly_refresh(False, [2025, 2026], False, None, ingest=True)
    assert events.index("ingest") < events.index("weekly_forecast") < events.index("ros_publish")
    assert events.count("ingest") == 1
    mocks["build_all_datasets"].assert_called_once_with(seasons=[2025, 2026])
    mocks["train_all"].assert_not_called()
    mocks["save_target_quality_report"].assert_not_called()
    assert result["ingest"] is True
    assert result["retrain"] is False
    assert result["ingestion_seasons"] == [2025, 2026]
    assert refresh.get_refresh_status()["ingest"] is True
    assert refresh.get_refresh_status()["status"] == "completed"


def test_default_no_retrain_preserves_existing_artifact_only_behavior(isolated_refresh):
    events, mocks = isolated_refresh
    result = refresh.run_weekly_refresh(False, [2026], False, None)
    mocks["build_all_datasets"].assert_not_called()
    mocks["train_all"].assert_not_called()
    assert "weekly_forecast" in events
    assert result["ingest"] is False
    assert result["ingestion_seasons"] is None


def test_retraining_keeps_frozen_training_split_and_ingests_only_once(isolated_refresh):
    events, mocks = isolated_refresh
    training_split = list(refresh.DEFAULT_TRAIN_SEASONS)
    result = refresh.run_weekly_refresh(True, [2025, 2026], False, None, ingest=True)
    assert events.index("ingest") < events.index("train") < events.index("weekly_forecast")
    mocks["train_all"].assert_called_once_with(train_seasons=training_split)
    mocks["build_all_datasets"].assert_called_once_with(seasons=[2025, 2026])
    assert refresh.DEFAULT_TRAIN_SEASONS == training_split
    assert result["retrain"] is True


def test_ingestion_failure_preserves_flag_and_does_not_publish_forecasts(isolated_refresh):
    _, mocks = isolated_refresh
    mocks["build_all_datasets"].side_effect = RuntimeError("recorded source unavailable")
    with pytest.raises(RuntimeError, match="recorded source"):
        refresh.run_weekly_refresh(retrain=False, seasons=[2026], ingest=True)
    mocks["predict_all_positions"].assert_not_called()
    mocks["prewarm_weekly_predictions"].assert_not_called()
    mocks["train_all"].assert_not_called()
    status = refresh.get_refresh_status()
    assert status["status"] == "error"
    assert status["ingest"] is True
    assert status["retrain"] is False


def test_queued_positional_api_call_remains_compatible(isolated_refresh):
    _, mocks = isolated_refresh
    started = refresh.mark_refresh_started(retrain=False, ingest=True)
    result = refresh.run_weekly_refresh(False, None, False, started["started_at"], ingest=True)
    mocks["build_all_datasets"].assert_called_once_with(seasons=[2025, 2026])
    assert result["started_at"] == started["started_at"]


def test_cli_exposes_backfill_without_retraining(monkeypatch):
    import sys
    run = Mock(return_value={"status": "completed"})
    monkeypatch.setattr(refresh, "run_weekly_refresh", run)
    monkeypatch.setattr(sys, "argv", ["weekly_refresh", "--no-retrain", "--ingest"])
    refresh.main()
    assert run.call_args.kwargs["retrain"] is False
    assert run.call_args.kwargs["ingest"] is True
    assert run.call_args.kwargs["lock_timeout"] == 1800
    assert callable(run.call_args.kwargs["on_lock_wait"])


def test_incomplete_backfill_cannot_publish_or_report_a_completed_refresh(isolated_refresh, monkeypatch):
    _, mocks = isolated_refresh
    def incomplete(**kwargs):
        raise ValueError("source_backfill_incomplete: missing finalized team games week 6 DAL")
    monkeypatch.setattr("src.projections.data_integrity.validate_recorded_backfill", incomplete)
    with pytest.raises(ValueError, match="source_backfill_incomplete"):
        refresh.run_weekly_refresh(retrain=False, seasons=[2026], ingest=True)
    mocks["predict_all_positions"].assert_not_called()
    mocks["train_all"].assert_not_called()
    assert refresh.get_refresh_status()["status"] == "error"
    assert refresh.get_refresh_status()["stage"] == "source_coverage"
