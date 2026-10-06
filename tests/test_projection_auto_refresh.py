"""Exercise durable cadence, failures, and routine invalidation without feeds."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock
import pandas as pd
import pytest
from src.projections.refresh_policy import refresh_health
from src.jobs import season_refresh

NOW = datetime(2026, 10, 6, 1, tzinfo=timezone.utc)


@pytest.mark.parametrize("kind,minutes", [("season",14),("weekly",14),("season",1439),("weekly",59)])
def test_routine_invalidation_does_not_become_attention(kind,minutes):
    health = refresh_health(built_at=(NOW-timedelta(minutes=minutes)).isoformat(), available=True, dirty=True, kind=kind, now=NOW)
    assert health["refresh_state"] == "scheduled"
    assert not health["needs_attention"]


@pytest.mark.parametrize("kind,hours", [("season",26),("weekly",2)])
def test_overdue_and_failed_refresh_are_visible(kind,hours):
    old = (NOW-timedelta(hours=hours)).isoformat()
    assert refresh_health(built_at=old,available=True,kind=kind,now=NOW)["needs_attention"]
    failed = {"status":"error","started_at":(NOW-timedelta(minutes=3)).isoformat(),"completed_at":NOW.isoformat()}
    health = refresh_health(built_at=(NOW-timedelta(minutes=14)).isoformat(), available=True,kind=kind,attempt=failed,now=NOW)
    assert health["needs_attention"] and health["refresh_state"] == "failed"


def test_later_publication_clears_failure_and_running_has_a_bounded_grace():
    failed = {"status":"error","completed_at":(NOW-timedelta(minutes=15)).isoformat()}
    assert not refresh_health(built_at=(NOW-timedelta(minutes=14)).isoformat(),available=True,attempt=failed,now=NOW)["needs_attention"]
    running = {"status":"running","started_at":NOW.isoformat()}
    assert not refresh_health(built_at=None,available=False,attempt=running,now=NOW)["needs_attention"]
    running["started_at"] = (NOW-timedelta(hours=2)).isoformat()
    assert refresh_health(built_at=None,available=False,attempt=running,now=NOW)["needs_attention"]


@pytest.fixture
def worker(tmp_path,monkeypatch):
    class Frozen(datetime):
        @classmethod
        def now(cls,tz=None): return NOW
    monkeypatch.setattr(season_refresh,"datetime",Frozen)
    monkeypatch.setattr(season_refresh,"CACHE_DIR",tmp_path)
    monkeypatch.setattr(season_refresh,"STATUS_PATH",tmp_path/"season.json")
    monkeypatch.setattr(season_refresh,"_current_targets",lambda:[("draft",2026,1),("ros",2026,4)])
    metadata = {"draft":[],"ros":[]}
    monkeypatch.setattr(season_refresh,"target_metadata",lambda kind,*args: metadata[kind])
    metadata.update(draft=[{}],ros=[{}])
    def prepare(kind,season,week):
        metadata[kind] = [{"season":season,"week":week,"built_at":NOW.isoformat(),"rows":10}]
    producer = Mock(side_effect=prepare)
    monkeypatch.setattr(season_refresh,"_prepare",producer)
    return producer, metadata


def test_daily_work_is_shared_and_recent_dirty_inputs_wait(worker):
    producer,metadata = worker
    assert season_refresh.run_season_refresh()["prepared"] == 2
    assert season_refresh.run_season_refresh()["prepared"] == 0
    assert producer.call_count == 2
    for values in metadata.values(): values[0]["fingerprint"] = "old-inputs"
    assert season_refresh.run_season_refresh()["prepared"] == 0
    for values in metadata.values(): values[0]["built_at"] = (NOW-timedelta(days=1)).isoformat()
    # Prior attempt cooldown is durable even after a process restart.
    assert season_refresh.run_season_refresh()["prepared"] == 0
    season_refresh.STATUS_PATH.unlink()
    assert season_refresh.run_season_refresh()["prepared"] == 2


def test_failure_retries_after_cooldown_without_stopping_other_targets(worker):
    producer,metadata = worker
    def prepare(kind,season,week):
        if kind == "draft": raise ValueError("broken model")
        metadata[kind] = [{"season":season,"week":week,"built_at":NOW.isoformat()}]
    producer.side_effect = prepare
    assert season_refresh.run_season_refresh() == {"status":"error","prepared":1,"failed":1}
    assert season_refresh.read_status()["draft:2026"]["status"] == "error"
    assert season_refresh.run_season_refresh()["prepared"] == 0
    assert producer.call_count == 2
    status = season_refresh.read_status()
    status["draft:2026"]["started_at"] = (NOW-timedelta(minutes=16)).isoformat()
    season_refresh._save(status)
    season_refresh.run_season_refresh()
    assert producer.call_count == 3


def test_season_job_respects_full_pipeline_lock(worker):
    from src.jobs.refresh_lock import refresh_lock
    with refresh_lock(season_refresh.CACHE_DIR/"last_refresh.lock"):
        assert season_refresh.run_season_refresh()["status"] == "busy"
    worker[0].assert_not_called()


def test_empty_rebuild_keeps_prior_season_artifact(tmp_path,monkeypatch):
    from src.draft_hub import draft_pool_cache as pool
    old = tmp_path/"pool.parquet"
    old.write_bytes(b"last successful forecast")
    monkeypatch.setattr(pool,"_compute_pool",lambda *a:(pd.DataFrame(),{}))
    save = Mock(side_effect=lambda *a:old.write_bytes(b"replacement"))
    monkeypatch.setattr(pool,"save_pool_artifact",save)
    with pytest.raises(ValueError,match="previous artifact retained"):
        season_refresh._prepare("draft",2026,1)
    assert old.read_bytes() == b"last successful forecast"
    save.assert_not_called()


def test_daily_ros_builds_all_positions_and_both_variants(monkeypatch):
    producer = Mock(return_value=pd.DataFrame([{"ROS P50":100}]))
    monkeypatch.setattr("src.projections.ros_cache.load_ros_prediction",producer)
    season_refresh._prepare("ros",2026,4)
    assert [(c.args[0],c.kwargs["apply_injury_adjustments"]) for c in producer.call_args_list] == [(pos,inj) for pos in ("qb","rb","wr") for inj in (True,False)]
    assert all(c.kwargs["force"] for c in producer.call_args_list)


def test_season_ticker_waits_after_completion_and_stops_cleanly(monkeypatch):
    from app import season_refresh_ticker as ticker
    monkeypatch.setattr(ticker,"PROJECTION_AUTO_REFRESH_ENABLED",True)
    sleeps,starts = [],[]
    async def sleep(seconds): sleeps.append(seconds)
    async def submit(job):
        starts.append(job)
        if len(starts)==2: raise asyncio.CancelledError
    monkeypatch.setattr(ticker.asyncio,"sleep",sleep)
    monkeypatch.setattr(ticker,"submit_cpu_job",submit)
    with pytest.raises(asyncio.CancelledError): asyncio.run(ticker.season_refresh_ticker_loop())
    assert sleeps == [60,300]
    assert starts == [season_refresh.run_season_refresh]*2


def test_season_ticker_disabled_has_no_requests(monkeypatch):
    from app import season_refresh_ticker as ticker
    monkeypatch.setattr(ticker,"PROJECTION_AUTO_REFRESH_ENABLED",False)
    monkeypatch.setattr(ticker,"submit_cpu_job",lambda *a:pytest.fail("unexpected work"))
    asyncio.run(ticker.season_refresh_ticker_loop())


@pytest.mark.parametrize("module", ["src.draft_hub.draft_pool_cache","src.projections.weekly_cache","src.projections.ros_cache"])
def test_timestamp_only_input_copy_does_not_invalidate_forecasts(tmp_path,monkeypatch,module):
    import importlib
    cache = importlib.import_module(module)
    monkeypatch.setattr(cache,"PROCESSED_DATA_DIR",tmp_path)
    monkeypatch.setattr(cache,"MODEL_DIR",tmp_path)
    path=tmp_path/"qb_mlready.parquet"
    path.write_bytes(b"actual feature contents")
    fingerprint = getattr(cache,"pool_fingerprint",None) or getattr(cache,"weekly_fingerprint",None) or cache.ros_fingerprint
    before = fingerprint()
    os.utime(path,(1000000000,1000000000))
    assert fingerprint() == before
    path.write_bytes(b"changed feature contents")
    assert fingerprint() != before


def test_recent_season_reads_do_not_queue_a_job(worker,monkeypatch):
    from app import projection_recovery as recovery
    season_refresh.run_season_refresh()
    tasks=Mock()
    assert recovery.queue_projection_recovery(tasks,2026,1,["draft"]) == {"status":"scheduled"}
    tasks.add_task.assert_not_called()


def test_status_poll_detects_overdue_and_clears_superseded_failures(monkeypatch):
    from src.projections import automatic_status as status
    from src.projections import refresh_policy
    class Frozen(datetime):
        @classmethod
        def now(cls,tz=None): return NOW
    monkeypatch.setattr(refresh_policy,"datetime",Frozen)
    monkeypatch.setattr("src.projections.projection_meta.get_projection_meta",lambda *a:{"default_season":2026,"default_week":4})
    monkeypatch.setattr(status,"read_cached_metadata",lambda *a:{})
    attempt = {"status":"error","completed_at":(NOW-timedelta(minutes=15)).isoformat(),
               "last_success_at":(NOW-timedelta(days=2)).isoformat()}
    monkeypatch.setattr(status,"read_status",lambda:{"draft:2026":attempt})
    metadata = [{"built_at":(NOW-timedelta(minutes=14)).isoformat()}]
    monkeypatch.setattr(status,"target_metadata",lambda *a:metadata)
    assert not status.automatic_refresh_status()["health"]["draft:2026"]["needs_attention"]
    metadata[0]["built_at"] = (NOW-timedelta(days=2)).isoformat()
    assert status.automatic_refresh_status()["health"]["draft:2026"]["refresh_state"] == "failed"
    attempt["status"] = "ok"
    assert status.automatic_refresh_status()["health"]["draft:2026"]["refresh_state"] == "overdue"
    # A failed archived target must never warn on a historical projection page.
    monkeypatch.setattr(status,"read_status",lambda:{"weekly:2026:3":attempt})
    attempt["status"] = "error"
    assert not status.automatic_refresh_status()["health"]["weekly:2026:3"]["needs_attention"]


def test_weekly_worker_publishes_exact_reuse_proof(monkeypatch):
    from src.jobs import dfs_inputs, dfs_refresh
    monkeypatch.setattr(dfs_inputs,"prepare_sources",lambda *a:None)
    monkeypatch.setattr(dfs_inputs,"input_revision",lambda *a:"same-inputs")
    monkeypatch.setattr(dfs_inputs,"output_revisions",lambda *a:{"saved-frame":"digest"})
    monkeypatch.setattr(dfs_refresh,"_warm_supporting_data",lambda *a:None)
    producer = Mock(return_value=pd.DataFrame([{"Projected Points":20}]))
    monkeypatch.setattr("src.projections.weekly_cache.load_weekly_prediction",producer)
    receipt = season_refresh._prepare("weekly",2026,4)["forecast_reuse"]
    assert receipt["revision"] == "same-inputs" and receipt["outputs"] == {"saved-frame":"digest"}
    assert producer.call_count == 6
    assert dfs_inputs.can_reuse({"status":"ok","forecast_reuse":receipt},"same-inputs",2026,4,
                              now=receipt["computed_epoch"]+300,max_age=3600)


def test_dfs_specialist_failure_does_not_flag_shared_weekly_forecasts(monkeypatch):
    from src.projections import automatic_status as status
    monkeypatch.setattr("src.projections.projection_meta.get_projection_meta",lambda *a:{"default_season":2026,"default_week":4})
    monkeypatch.setattr("src.core.projection_context.is_nfl_offseason",lambda:False)
    now = datetime.now(timezone.utc)
    attempt = {"season":2026,"week":4,"status":"error","forecast_status":"ok","started_at":now.isoformat()}
    monkeypatch.setattr(status,"read_cached_metadata",lambda *a:attempt)
    monkeypatch.setattr(status,"read_status",lambda:{})
    built = (now-timedelta(minutes=1)).isoformat()
    assert not status.forecast_refresh_health("weekly",2026,4,built)["needs_attention"]
    attempt["forecast_status"] = "error"
    assert status.forecast_refresh_health("weekly",2026,4,built)["refresh_state"] == "failed"
    monkeypatch.setattr("src.core.projection_context.is_nfl_offseason",lambda:True)
    assert status.forecast_refresh_health("weekly",2026,4,built)["refresh_state"] == "archived"
