"""Exercise registered production entry points with isolated sources, not just decorators."""
import asyncio
from contextlib import contextmanager
import json
from types import SimpleNamespace
import time

import pandas as pd
import pytest

from src.ops.job_report import read_report


def job_map(path):
    return {item["job"]: item for item in read_report(path, limit=100)["jobs"]}


def test_context_current_batch_and_startup_are_observed(diagnostics_enabled, monkeypatch):
    from src.draft_hub import prepared_week_context as pc, prepared_k_def_context as kc
    from src.draft_hub.week_context_warmup import warm_fantasy_week_context
    monkeypatch.setattr(kc, "source_revision", lambda: "special-revision")
    monkeypatch.setattr(kc, "_snapshot", lambda: {"revision": "special-revision"})
    monkeypatch.setattr(pc, "source_revision", lambda *args: "week-revision")
    monkeypatch.setattr(pc, "_snapshot", lambda *args: {"revision": "week-revision"})
    monkeypatch.setattr(pc, "discover_contexts", lambda **kw: [(2026, 4, True), (2026, 4, False)])
    from src.ops.job_diagnostics import execute_job, queue_job
    result = execute_job(warm_fantasy_week_context, (), {}, queue_job(warm_fantasy_week_context))
    assert all(item["status"] == "current" for item in result.values())
    assert all(item["status"] == "current" for item in pc.refresh_week_contexts().values())
    observed = read_report(diagnostics_enabled, limit=100)["jobs"]
    jobs = job_map(diagnostics_enabled)
    assert jobs["fantasy_context.batch"]["skips"] == 1
    assert jobs["fantasy_context.batch"]["last_observed_metadata"]["checked"] == 2
    # CPU-worker startup and direct calls have separate, correctly labeled CPU
    # scopes. Count observations across both rather than overwrite one by name.
    assert sum(item["same_input"] for item in observed if item["job"] == "fantasy_context.prepare") >= 1
    assert sum(item["skips"] for item in observed if item["job"] == "fantasy_specialists.prepare") == 4
    assert "src.draft_hub.week_context_warmup.warm_fantasy_week_context" in jobs


def test_context_batch_caught_error_is_reported(diagnostics_enabled, monkeypatch):
    from src.draft_hub import prepared_week_context as pc
    monkeypatch.setattr(pc, "discover_contexts", lambda **kw: [(2026, 4, True)])
    def fail(*args):
        raise ValueError("private player detail")
    monkeypatch.setattr(pc, "prepare_week_context", fail)
    assert pc.refresh_week_contexts() == {"2026:w4:inj1": {"status": "error"}}
    job = job_map(diagnostics_enabled)["fantasy_context.batch"]
    assert job["failures"] == 1 and job["last_observed_metadata"]["failed"] == 1
    assert "private player detail" not in json.dumps(read_report(diagnostics_enabled))


def test_clock_valuations_native_and_sleeper_preserve_noop_results(diagnostics_enabled, hub_db, monkeypatch):
    from src.draft_hub import draft_state, native_score_refresh as native, storage
    from src.draft_hub.value_snapshot_warmup import warm_fantasy_value_snapshots
    from app.sleeper_sync_ticker import sync_all_live_sleeper_leagues
    # Keep the pre-startup valuation path genuinely missing.
    assert warm_fantasy_value_snapshots() == {"prepared": 0, "unavailable": 0}
    assert draft_state.tick_expired_drafts() == []
    assert native.refresh_pending_scores() == {"completed": 0, "failed": 0}
    monkeypatch.setattr("src.draft_hub.league_live_scoring.resolve_current_week", lambda: (4, {"season": 2026, "season_type": "off"}))
    assert native.queue_current_native_weeks() is None
    monkeypatch.setattr(storage, "list_live_sleeper_league_ids", lambda: [])
    result = sync_all_live_sleeper_leagues()
    assert result == {"status": "complete", "synced": 0, "failed": 0, "leagues": [], "failures": []}
    jobs = job_map(diagnostics_enabled)
    assert jobs["draft_clock"]["recent_reasons"] == {"unchanged": 1}
    assert jobs["native_scores.batch"]["last_observed_metadata"]["attempts"] == 0
    assert {"fantasy_valuations", "native_scores.schedule", "sleeper_rosters"} <= jobs.keys()


def test_native_mixed_skips_and_failure_counts_are_recorded(diagnostics_enabled, hub_db, monkeypatch):
    from src.draft_hub import native_score_refresh as native, storage, hub_scoring as hs
    from src.draft_hub.schemas import ScoringRules
    rules = {"scoring": ScoringRules().model_dump()}
    monkeypatch.setattr(storage, "get_league", lambda lid: {"draft_completed": lid != "skip-private", "rules": rules})
    monkeypatch.setattr(storage, "get_week_scoring_run", lambda *args: None)
    monkeypatch.setattr(hs, "nfl_week_started", lambda *args: True)
    monkeypatch.setattr(hs, "load_week_stat_index", lambda *args: {})
    monkeypatch.setattr(hs, "apply_week_scores", lambda *args, **kw: {"scored": False, "reason": "no_stats"})
    for lid in ("skip-private", "fail-private"):
        native.request_refresh(lid, 2026, 4)
    assert native.refresh_pending_scores() == {"completed": 0, "failed": 1}
    jobs = job_map(diagnostics_enabled)
    assert jobs["native_scores.batch"]["failures"] == 1
    assert jobs["native_scores.batch"]["last_observed_metadata"]["skipped"] == 1
    assert "native_scores.batch.load_stats" in jobs and "native_scores.batch.apply_scores" in jobs
    assert "private" not in json.dumps(read_report(diagnostics_enabled))


def test_refresh_busy_injury_overlay_skip_and_special_feed_are_observed(diagnostics_enabled, tmp_path, monkeypatch):
    from src.jobs import dfs_refresh as dfs, weekly_refresh as weekly, projection_recovery as repair, dfs_special_history as special
    from src.integrations import injury_poll as poll
    from src.projections import injury_overlay as overlay, player_context as notes
    from src.jobs.refresh_lock import RefreshBusy
    monkeypatch.setattr(dfs, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(dfs, "STATUS_PATH", tmp_path / "dfs.json")
    dfs.STATUS_PATH.write_text(json.dumps({"completed_epoch": time.time()}))
    assert dfs.run_dfs_refresh()["status"] == "not_due"
    @contextmanager
    def busy(*args, **kwargs):
        raise RefreshBusy()
        yield
    monkeypatch.setattr(weekly, "refresh_lock", busy)
    monkeypatch.setattr(weekly, "get_refresh_status", lambda: {})
    assert weekly.run_weekly_refresh(retrain=False)["status"] == "busy"
    monkeypatch.setattr(repair, "CACHE_DIR", tmp_path)
    assert repair.rebuild_projection_context(2026, 4, ()) == {"status": "ok", "failed": []}
    monkeypatch.setattr(poll, "get_injury_poll_status", lambda: {"raw": "private injury data"})
    assert poll._POLL_LOCK.acquire(blocking=False)
    try:
        assert poll.run_injury_poll()["status"] == "already_running"
    finally:
        poll._POLL_LOCK.release()
    monkeypatch.setattr(overlay, "build_injury_snapshot", lambda **kw: {"injury_snapshot_id": "revision", "players": []})
    monkeypatch.setattr(overlay, "save_injury_snapshot", lambda *args: None)
    monkeypatch.setattr(overlay, "load_injury_overlay_artifact", lambda *args: (pd.DataFrame([{"x": 1}]), {}))
    monkeypatch.setattr(overlay, "diff_injury_snapshots", lambda *args: {"changed_teams": []})
    assert overlay.recompute_injury_overlays(2026, 4, previous_snapshot={})["reason"] == "no_material_change"
    monkeypatch.setattr(special.requests, "get", lambda *args, **kw: SimpleNamespace(status_code=404))
    retained = pd.DataFrame([{"season": 2025}])
    assert special.refresh_special_history(2026, retained).attrs["current_season_available"] is False
    def fail_context(*args):
        raise ValueError("private notes")
    monkeypatch.setattr(notes, "season_week_context", fail_context)
    with pytest.raises(ValueError, match="private notes"):
        notes.refresh_player_context(2026, 4)
    jobs = job_map(diagnostics_enabled)
    assert jobs["dfs_refresh"]["recent_reasons"] == {"not_due": 1}
    assert jobs["weekly_refresh"]["recent_reasons"] == {"busy": 1}
    assert jobs["injury_poll"]["recent_reasons"] == {"already_running": 1}
    assert jobs["injury_overlay"]["recent_reasons"] == {"no_material_change": 1}
    assert jobs["player_notes.refresh"]["failures"] == 1
    assert {"projection_repair", "dfs_special_history"} <= jobs.keys()
    assert "private notes" not in json.dumps(read_report(diagnostics_enabled))


def test_broadcast_wall_only_has_separate_thread_queue_and_no_room_payload(diagnostics_enabled, monkeypatch):
    from app import hub_routes
    from src.draft_hub.ws_manager import DraftRoomManager
    manager = DraftRoomManager()
    monkeypatch.setattr(hub_routes, "draft_room_manager", manager)
    monkeypatch.setattr(hub_routes, "get_room_state", lambda *args: {"email": "private@example.test"})
    asyncio.run(hub_routes.broadcast_room("private-room"))
    jobs = job_map(diagnostics_enabled)
    parent = jobs["draft_broadcast"]
    assert parent["cpu_scope"] == "async_wall_only" and parent["cpu_total_s"] is None
    assert parent["last_observed_metadata"]["recipients"] == 0
    child = next(job for job in jobs.values() if job["cpu_scope"] == "thread")
    assert child["nested"] and child["queue_samples"] == 1
    assert "private" not in json.dumps(read_report(diagnostics_enabled))
