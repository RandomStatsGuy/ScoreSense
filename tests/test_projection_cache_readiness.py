"""Production refresh regressions: real artifacts and background HTTP jobs."""
import asyncio
import json
import os
from concurrent.futures import Future
from unittest.mock import patch

import pandas as pd
import pytest

from src.core.artifact_revision import file_content_revision
from src.projections import weekly_cache, ros_cache, input_policy
from src.draft_hub import draft_pool_cache
from src.jobs import projection_cache_warmup as warmup


@pytest.fixture
def artifacts(tmp_path, monkeypatch):
    import src.config as config
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(input_policy, "CACHE_DIR", tmp_path)
    for mod, directory in ((weekly_cache, "WEEKLY_PREDICTIONS_DIR"),
                           (ros_cache, "ROS_PREDICTIONS_DIR"),
                           (draft_pool_cache, "DRAFT_POOL_DIR")):
        monkeypatch.setattr(mod, directory, tmp_path / directory)
        monkeypatch.setattr(mod, "PROCESSED_DATA_DIR", tmp_path / "processed")
        monkeypatch.setattr(mod, "MODEL_DIR", tmp_path / "models")
        monkeypatch.setattr(mod, "_with_roster_identity", lambda frame, *a, **k: frame.copy())
    monkeypatch.setattr("src.projections.projection_movement.save_projection_movement_artifact", lambda *a, **k: None)
    feature = tmp_path / "processed" / "qb_mlready.parquet"
    feature.parent.mkdir()
    feature.write_bytes(b"old")
    frame = pd.DataFrame({"Player": ["Test TE"], "player_id": ["te"], "Position": ["TE"],
                          "Team": ["BUF"], "Projected Points": [12.],
                          "Season Proj": [180.], "ROS P10": [60.], "ROS P50": [120.], "ROS P90": [180.]})
    calls = []
    def predict(*a, **k):
        calls.append((a, k))
        return frame.copy()
    monkeypatch.setattr(weekly_cache, "predict_upcoming_week", predict)
    monkeypatch.setattr(ros_cache, "predict_rest_of_season", predict)
    monkeypatch.setattr(draft_pool_cache, "_compute_pool", lambda season: (predict(), {}))
    monkeypatch.setattr(warmup, "warm_fantasy_value_snapshots", lambda **kw: {"prepared": 1, "unavailable": 0})
    monkeypatch.setattr(warmup, "prewarm_injury_overlays", lambda *a, **k: {"status": "ok"})
    monkeypatch.setattr(warmup, "prewarm_player_context", lambda *a, **k: {"status": "ok"})
    monkeypatch.setattr(warmup, "prewarm_week_context", lambda *a: {"inj1": {"status": "current"}, "inj0": {"status": "current"}})
    return feature, calls


def test_poll_rewrite_preserves_all_forecast_fingerprints_but_real_changes_invalidate(artifacts, tmp_path):
    roster = tmp_path / "sleeper_players.json"
    schedule = tmp_path / "nfl_schedules.parquet"
    roster.write_bytes(b'{"a":{"position":"WR","team":"BUF","news_updated":1}}')
    schedule.write_bytes(b"schedule")
    loaders = (weekly_cache.weekly_fingerprint, ros_cache.ros_fingerprint, draft_pool_cache.pool_fingerprint)
    before = [loader() for loader in loaders]
    for path in (roster, schedule):
        contents = path.read_bytes()
        stamp = path.stat().st_mtime_ns + 1_000_000
        path.write_bytes(contents)
        os.utime(path, ns=(stamp, stamp))
    assert [loader() for loader in loaders] == before
    # News, ranks and availability wait for the scheduled weekly rebuild.
    roster.write_bytes(b'{"a":{"position":"WR","team":"BUF","news_updated":2,"injury_status":"Out"},'
                       b'"b":{"position":"LB","team":"SEA"}}')
    assert [loader() for loader in loaders] == before
    roster.write_bytes(b'{"a":{"position":"WR","team":"SEA"}}')
    after_roster = [loader() for loader in loaders]
    assert all(old != new for old, new in zip(before, after_roster))
    schedule.write_bytes(b"new game market")
    assert all(loader() != old for loader, old in zip(loaders, after_roster))


def test_player_feed_digests_split_identity_from_availability(tmp_path):
    from src.integrations.sleeper import forecast_player_revisions
    feed = tmp_path / "players.json"
    def write(**changes):
        feed.write_text(json.dumps({"1": {"position": "RB", "team": "BUF", "news_updated": 1, **changes},
                                    "2": {"position": "CB", "team": "BUF"}}))
        return forecast_player_revisions(feed)
    identity, availability = write()
    assert write(news_updated=9, search_rank=3) == (identity, availability)
    out = write(injury_status="Out")
    assert out[0] == identity and out[1] != availability
    assert write(depth_chart_order=2)[1] not in (availability, out[1])
    assert write(team="MIA")[0] != identity
    feed.write_text("not json")
    assert forecast_player_revisions(feed)[0] not in (None, identity)
    feed.unlink()
    assert forecast_player_revisions(feed) == (None, None)


def test_content_hash_is_memoized_for_hot_reads(tmp_path):
    from src.core import artifact_revision as revisions
    path = tmp_path / "source"
    path.write_bytes(b"same")
    assert file_content_revision(path)
    with patch("pathlib.Path.open", side_effect=AssertionError("hot reader hashed again")):
        assert file_content_revision(path)
    path.write_bytes(b"changed")
    assert file_content_revision(path) != file_content_revision(tmp_path / "missing")


def test_late_input_replacement_rebuilds_all_variants_before_completion(artifacts, monkeypatch):
    feature, calls = artifacts
    values_calls = []
    def values(**options):
        assert options == {"prepare_pools": True}
        values_calls.append(1)
        if len(values_calls) == 1:
            feature.write_bytes(b"new input")
        return {"prepared": 2, "unavailable": 0}
    monkeypatch.setattr(warmup, "warm_fantasy_value_snapshots", values)
    result = warmup.finalize_projection_caches(2026, 4, 2026)
    assert result["projection_cache_readiness"] == {"status": "ready", "attempts": 2}
    assert result["draft_pool_artifact"]["stale"] is False
    assert len(result["weekly_predictions_prewarm"]) == len(result["ros_predictions_prewarm"]) == 6
    assert warmup._artifacts_readable(2026, 4, 2026)
    # Empty/stale consumers cannot be concealed by the row counts of an earlier
    # successful build: both sets of variants were actually recomputed.
    assert len(calls) == 26


def test_continuously_changing_inputs_fail_instead_of_reporting_completion(artifacts, monkeypatch):
    feature, _ = artifacts
    calls = []
    def values(**options):
        calls.append(1)
        feature.write_bytes(str(len(calls)).encode())
        return {"prepared": 1, "unavailable": 0}
    monkeypatch.setattr(warmup, "warm_fantasy_value_snapshots", values)
    with pytest.raises(RuntimeError, match="--no-retrain"):
        warmup.finalize_projection_caches(2026, 4, 2026)
    assert len(calls) == 3


def test_unavailable_fantasy_valuations_fail_the_refresh(artifacts, monkeypatch):
    monkeypatch.setattr(warmup, "warm_fantasy_value_snapshots",
                        lambda **kw: {"prepared": 4, "unavailable": 4})
    with pytest.raises(RuntimeError, match="Fantasy valuation"):
        warmup.finalize_projection_caches(2026, 4, 2026)


def test_note_worker_repairs_all_weekly_variants_without_etl_or_training(artifacts, monkeypatch, tmp_path):
    from src.projections import player_context
    from src.jobs import weekly_refresh
    monkeypatch.setattr(weekly_refresh, "REFRESH_STATUS", tmp_path / "refresh.json")
    with patch.object(player_context, "prewarm_player_context", return_value={"status": "ok", "rows": 1}), \
         patch("src.draft_hub.prepared_week_context.prewarm_week_context",
               return_value={"inj1": {"status": "prepared"}, "inj0": {"status": "prepared"}}), \
         patch.object(weekly_refresh, "train_all", side_effect=AssertionError("retraining")), \
         patch.object(weekly_refresh, "build_all_datasets", side_effect=AssertionError("ETL")):
        result = player_context.refresh_player_context(2026, 4)
    assert result["status"] == "completed"
    for pos in ("qb", "rb", "wr"):
        for injury in (True, False):
            assert not weekly_cache.load_weekly_prediction(pos, 2026, 4, apply_injury_adjustments=injury,
                                                           allow_compute=False).empty


def test_background_http_refresh_coalesces_and_polls_without_waiting(monkeypatch):
    from app import api, player_context_refresh as jobs
    jobs._JOBS.clear()
    future = Future()
    submitted = []
    monkeypatch.setattr(api, "submit_cpu_job", lambda *a, **k: submitted.append((a, k)) or future)
    async def exercise():
        first = await api.players_context_refresh(2026, 4, {})
        duplicate = await api.players_context_refresh(2026, 4, {})
        assert first == duplicate
        assert first["status"] == "running"
        assert len(submitted) == 1
        assert (await api.players_context_refresh_status(first["job_id"], {}))["status"] == "running"
        future.set_result({"status": "completed", "season": 2026, "week": 4, "rows": 830})
        finished = await api.players_context_refresh_status(first["job_id"], {})
        assert finished["status"] == "completed" and finished["rows"] == 830
        assert finished["completed_at"]
    try:
        asyncio.run(exercise())
    finally:
        jobs._JOBS.clear()


def test_refresh_failure_and_worker_restart_are_visible(monkeypatch):
    from app import api, player_context_refresh as jobs
    from fastapi import HTTPException
    from src.jobs.refresh_lock import RefreshBusy
    jobs._JOBS.clear()
    future = Future()
    monkeypatch.setattr(api, "submit_cpu_job", lambda *a, **k: future)
    async def exercise():
        started = await api.players_context_refresh(2026, 4, {})
        future.set_exception(RefreshBusy())
        failed = await api.players_context_refresh_status(started["job_id"], {})
        assert failed["status"] == "error"
        assert "Another projection job" in failed["error"]
        jobs._JOBS.clear()
        with pytest.raises(HTTPException) as gone:
            await api.players_context_refresh_status(started["job_id"], {})
        assert gone.value.status_code == 404
    asyncio.run(exercise())
