import json
import os
import time
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pytest

from src.products.dfs_coverage import projection_coverage
from src.products.lineup_optimizer import _players_from_pool
from src.integrations import dfs_slates
from src.jobs import dfs_refresh


@pytest.fixture(autouse=True)
def _isolate_supporting_context(monkeypatch):
    monkeypatch.setattr(dfs_refresh, "_warm_supporting_data", lambda *a: None)
    monkeypatch.setattr("src.integrations.injury_poll.get_injury_poll_status", lambda: {"poll_due": True})



def test_coverage_lists_missing_quantiles_and_does_not_certify_fixed_or_imported():
    rows = [{"player_id": str(i), "Player": f"Player {i}", "Position": pos, "salary": 4000,
             "Low (P10)": low, "Projected Points": 5, "High (P90)": 10, "projection_source": source}
            for i, (pos, low, source) in enumerate([("QB", 1, "ScoreSense"), ("DST", 1, "Fixed estimate"),
                                                    ("K", None, "Missing projection"), ("WR", np.inf, "ScoreSense"),
                                                    ("RB", 1, "Imported")])]
    result = projection_coverage(pd.DataFrame(rows))
    assert result["complete_inputs"] == 3
    assert result["fixed_estimates"] == 1
    assert result["modeled_players"] == 1
    assert [p["player_id"] for p in result["missing_players"]] == ["2", "3"]
    assert not result["all_players_modeled"]
    assert not result["all_players_have_inputs"]
    assert len(_players_from_pool(pd.DataFrame(rows))) == 3
    assert not projection_coverage(pd.DataFrame())["all_players_have_inputs"]


@pytest.mark.parametrize("site", ["draftkings", "fanduel"])
def test_salary_cache_expires_after_five_minutes(tmp_path, monkeypatch, site):
    cache = tmp_path / "salary.parquet"
    # DraftKings intentionally retries caches without usable export IDs.
    pd.DataFrame([{"player_name": "Old", "dfs_id": "123"}]).to_parquet(cache)
    os.utime(cache, (time.time()-2, time.time()-2))
    monkeypatch.setattr(dfs_slates, "_cache_path", lambda *a: cache)
    monkeypatch.setattr(dfs_slates, "_cache_meta_path", lambda *a: tmp_path / "meta.json")
    monkeypatch.setattr(dfs_slates, "fanduel_auth_configured", lambda: True)
    fetch = Mock(return_value={})
    monkeypatch.setattr(dfs_slates, "_dk_get" if site == "draftkings" else "_fd_get", fetch)
    monkeypatch.setattr(dfs_slates, "parse_dk_draftables" if site == "draftkings" else "parse_fd_players",
                        lambda *a, **k: pd.DataFrame([{"player_name": "New", "dfs_id": "456"}]))
    assert dfs_slates.fetch_slate_salaries(site, "1").iloc[0].player_name == "Old"
    fetch.assert_not_called()
    os.utime(cache, (time.time()-301, time.time()-301))
    assert dfs_slates.fetch_slate_salaries(site, "1").iloc[0].player_name == "New"
    assert fetch.call_count == 1


@pytest.fixture
def refresh_env(tmp_path, monkeypatch):
    from src.integrations import injury_poll, sleeper
    from src.projections import weekly_cache
    monkeypatch.setattr(dfs_refresh, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(dfs_refresh, "STATUS_PATH", tmp_path / "dfs.json")
    monkeypatch.setattr(dfs_refresh.dfs_inputs, "prepare_sources", lambda *a: None)
    monkeypatch.setattr(dfs_refresh.dfs_inputs, "input_revision", lambda *a: "fixture-inputs")
    monkeypatch.setattr(dfs_refresh.dfs_inputs, "output_revisions", lambda *a: None)
    poll = Mock(return_value={"status": "ok"})
    model = Mock(return_value=pd.DataFrame([{"player_id": "x"}]))
    monkeypatch.setattr(injury_poll, "run_injury_poll", poll)
    monkeypatch.setattr(sleeper, "get_nfl_state", lambda **k: {"season": "2026", "week": 4, "season_type": "regular"})
    monkeypatch.setattr(weekly_cache, "load_weekly_prediction", model)
    monkeypatch.setattr(weekly_cache, "invalidate_weekly_cache", lambda: None)
    monkeypatch.setattr("src.projections.dfs_pool.refresh_dfs_pool", lambda *a, **k: {"rows": 100, "built_at": "test"})
    monkeypatch.setattr("src.projections.ros_cache.load_ros_prediction", lambda *a, **k: pd.DataFrame([{"ROS P50": 100}]))
    return poll, model


def test_refresh_all_positions_and_rate_limits_across_calls(refresh_env):
    poll, model = refresh_env
    first = dfs_refresh.run_dfs_refresh()
    assert first["status"] == "ok"
    assert first["last_success_at"]
    assert [c.args[0] for c in model.call_args_list] == ["qb", "qb", "rb", "rb", "wr", "wr"]
    assert all(c.kwargs["force"] for c in model.call_args_list)
    assert all(c.kwargs["apply_identity"] is False for c in model.call_args_list)
    assert dfs_refresh.run_dfs_refresh()["status"] == "not_due"
    assert poll.call_count == 1


def test_refresh_does_not_claim_success_when_player_feed_fails(refresh_env):
    poll, model = refresh_env
    poll.return_value = {"status": "error"}
    result = dfs_refresh.run_dfs_refresh()
    assert result["status"] == "error"
    assert result["last_success_at"] is None
    model.assert_not_called()


def test_refresh_attempts_other_positions_after_one_fails(refresh_env):
    _, model = refresh_env
    model.side_effect = [RuntimeError("bad model")] + [pd.DataFrame([{"x": 1}])] * 4
    result = dfs_refresh.run_dfs_refresh()
    assert result["status"] == "error"
    assert set(result["positions"]) == {"rb", "wr", "dfs"}
    assert result["last_success_at"] is None


def test_refresh_skips_when_full_pipeline_holds_lock(refresh_env):
    from src.jobs.refresh_lock import refresh_lock
    with refresh_lock(dfs_refresh.CACHE_DIR / "last_refresh.lock"):
        assert dfs_refresh.run_dfs_refresh()["status"] == "already_running"
    refresh_env[0].assert_not_called()


def test_refresh_skips_regular_projection_in_offseason(refresh_env, monkeypatch):
    from src.integrations import sleeper
    monkeypatch.setattr(sleeper, "get_nfl_state", lambda **k: {"season": "2026", "week": 1, "season_type": "pre"})
    assert dfs_refresh.run_dfs_refresh()["status"] == "offseason"
    refresh_env[1].assert_not_called()


def test_status_reports_staleness_and_hides_internal_errors(tmp_path, monkeypatch):
    path = tmp_path / "status.json"
    monkeypatch.setattr(dfs_refresh, "STATUS_PATH", path)
    assert dfs_refresh.refresh_status()["stale"]
    path.write_text(json.dumps({"status": "error", "error": "internal details", "last_success_at": "2026-01-01T00:00:00+00:00"}))
    result = dfs_refresh.refresh_status()
    assert result["stale"]
    assert result["status"] == "error"
    assert "error" not in result


def test_missing_current_history_cannot_claim_fresh_success(refresh_env, monkeypatch):
    monkeypatch.setattr("src.projections.dfs_pool.refresh_dfs_pool", lambda *a, **k: {"rows": 100, "historical_inputs_only": True})
    result = dfs_refresh.run_dfs_refresh()
    assert result["status"] == "error"
    assert result["last_success_at"] is None
    assert result["positions"]["dfs"]["rows"] == 100


@pytest.mark.parametrize("feed_status", ["ok", "error"])
def test_refresh_gap_starts_at_completion_even_after_long_job(refresh_env, monkeypatch, feed_status):
    poll, _ = refresh_env
    now = [1000.0]
    monkeypatch.setattr(dfs_refresh.time, "time", lambda: now[0])
    def slow_poll(**kwargs):
        now[0] += dfs_refresh.DFS_REFRESH_SECONDS * 2
        return {"status": feed_status}
    poll.side_effect = slow_poll
    result = dfs_refresh.run_dfs_refresh()
    assert result["status"] == feed_status
    assert result["completed_epoch"] == now[0]
    now[0] += dfs_refresh.DFS_REFRESH_SECONDS - 1
    assert dfs_refresh.run_dfs_refresh()["status"] == "not_due"
    assert poll.call_count == 1
    now[0] += 1
    assert dfs_refresh.run_dfs_refresh()["status"] == feed_status
    assert poll.call_count == 2


def test_refresh_does_not_reuse_partial_or_empty_raw_variant(refresh_env, monkeypatch):
    _, model = refresh_env
    frame = pd.DataFrame([{"player_id": "fresh"}])
    model.side_effect = [frame, pd.DataFrame(), frame, frame, frame, frame]
    pool = Mock(return_value={"rows": 100})
    monkeypatch.setattr("src.projections.dfs_pool.refresh_dfs_pool", pool)
    result = dfs_refresh.run_dfs_refresh()
    assert result["status"] == "error"
    assert result["last_success_at"] is None
    supplied = pool.call_args.kwargs["skill_predictions"]
    assert all("qb" not in supplied[injury] for injury in (True, False))
    assert all(set(supplied[injury]) == {"rb", "wr"} for injury in (True, False))


def test_legacy_status_start_time_still_rate_limits(refresh_env, monkeypatch):
    now = time.time()
    dfs_refresh.STATUS_PATH.write_text(json.dumps({"attempt_epoch": now, "status": "ok"}))
    monkeypatch.setattr(dfs_refresh.time, "time", lambda: now + 1)
    assert dfs_refresh.run_dfs_refresh()["status"] == "not_due"
    refresh_env[0].assert_not_called()


def test_input_poll_contention_is_background_progress_not_failure(tmp_path,monkeypatch):
    monkeypatch.setattr(dfs_refresh,"CACHE_DIR",tmp_path)
    monkeypatch.setattr(dfs_refresh,"STATUS_PATH",tmp_path/"dfs.json")
    monkeypatch.setattr("src.integrations.injury_poll.run_injury_poll",lambda **k:{"status":"already_running"})
    monkeypatch.setattr("src.projections.weekly_cache.load_weekly_prediction",lambda *a,**k:pytest.fail("must wait for feed"))
    result = dfs_refresh.run_dfs_refresh()
    assert result["status"] == "inputs_updating" and result["forecast_status"] == "running"
    assert not result["last_success_at"] and "error" not in result
