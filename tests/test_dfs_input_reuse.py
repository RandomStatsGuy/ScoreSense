"""DFS eligibility with real revisions/publication and isolated inference/feeds."""
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pandas as pd
import pytest

from src.jobs import dfs_inputs, dfs_refresh


@pytest.fixture(autouse=True)
def _isolate_supporting_context(monkeypatch):
    monkeypatch.setattr(dfs_refresh, "_warm_supporting_data", lambda *a: None)
    monkeypatch.setattr("src.integrations.injury_poll.get_injury_poll_status", lambda: {"poll_due": True})

from src.projections import weekly_cache, ros_cache


@pytest.fixture
def gate_env(tmp_path, monkeypatch):
    from src import config
    from src.core import schedule_utils
    from src.integrations import sleeper, nflverse_roster, fantasypros, injury_poll
    from src.projections import predict, dfs_pool
    monkeypatch.setattr(config, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "ROOKIE_ROLE_OVERRIDES_PATH", tmp_path / "roles.yaml")
    monkeypatch.setattr(config, "SENTIMENT_FEATURES_PATH", tmp_path / "sentiment.parquet")
    for module in (predict, weekly_cache, ros_cache):
        monkeypatch.setattr(module, "PROCESSED_DATA_DIR", tmp_path / "processed")
        monkeypatch.setattr(module, "MODEL_DIR", tmp_path / "models")
    monkeypatch.setattr(schedule_utils, "SCHEDULE_CACHE", tmp_path / "schedule.parquet")
    monkeypatch.setattr(sleeper, "PLAYERS_CACHE", tmp_path / "players.json")
    monkeypatch.setattr(nflverse_roster, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(fantasypros, "FP_CACHE_DIR", tmp_path / "fp")
    monkeypatch.setattr(weekly_cache, "WEEKLY_PREDICTIONS_DIR", tmp_path / "weekly")
    monkeypatch.setattr(ros_cache, "ROS_PREDICTIONS_DIR", tmp_path / "ros")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "inference.py").write_text("# inference v1")
    for path in dfs_inputs.source_paths(2026, 4):
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(b"source-v1")
    dfs_inputs._digest.cache_clear()
    monkeypatch.setattr(dfs_inputs, "prepare_sources", Mock())
    monkeypatch.setattr(dfs_inputs, "invalidate_forecast_memory", Mock())
    monkeypatch.setattr(dfs_refresh, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(dfs_refresh, "STATUS_PATH", tmp_path / "status.json")
    clock = [1800000000.0]
    monkeypatch.setattr(dfs_refresh.time, "time", lambda: clock[0])
    state = {"season": 2026, "week": 4, "season_type": "regular"}
    monkeypatch.setattr(sleeper, "get_nfl_state", lambda **k: state.copy())
    poll = Mock(return_value={"status": "ok"})
    monkeypatch.setattr(injury_poll, "run_injury_poll", poll)
    options, calls, ros_calls, pool_calls = {}, [], [], []
    def weekly(pos, season, week, **kwargs):
        injury = kwargs.get("apply_injury_adjustments", True)
        calls.append((pos, injury, kwargs["force"]))
        paths = weekly_cache._artifact_paths(pos, season, week, injury)
        if kwargs["force"]:
            frame = pd.DataFrame([{"player_id": pos, "Season": season, "Week": week,
                "Projected Points": 11.0 if injury else 10.0}])
            frame.attrs = {"inference_meta": {"depth_mode": "coverage"}, "built_at": str(clock[0])}
            frame.to_parquet(paths[0])
            paths[1].write_text(json.dumps({"built_at": clock[0]}))
        if options.get("change_during_weekly"):
            options.pop("change_during_weekly").write_bytes(b"changed-mid-job")
        if options.get("output_change_during_reuse") and not kwargs["force"]:
            options.pop("output_change_during_reuse").write_bytes(b"changed-output")
        return pd.read_parquet(paths[0])
    monkeypatch.setattr(weekly_cache, "load_weekly_prediction", weekly)
    def ros(pos, season, week, **kwargs):
        ros_calls.append(kwargs["force"])
        paths = ros_cache._artifact_paths(pos, season, week, True)
        if kwargs["force"]:
            pd.DataFrame([{"ROS P50": 100.0}]).to_parquet(paths[0])
            paths[1].write_text(json.dumps({"built_at": clock[0]}))
        return pd.read_parquet(paths[0])
    monkeypatch.setattr(ros_cache, "load_ros_prediction", ros)
    def pool(season, week, *, skill_predictions, validate_inputs):
        pool_calls.append(skill_predictions)
        if options.get("pool_failure"):
            raise RuntimeError("fixture feed failure")
        if options.get("change_during_pool"):
            options.pop("change_during_pool").write_bytes(b"changed-mid-pool")
        validate_inputs()
        (tmp_path / "pool.bin").write_bytes(b"published")
        return {"rows": 6}
    monkeypatch.setattr(dfs_pool, "refresh_dfs_pool", pool)
    def run(**kwargs):
        clock[0] += dfs_refresh.DFS_REFRESH_SECONDS
        return dfs_refresh.run_dfs_refresh(**kwargs)
    return SimpleNamespace(root=tmp_path, calls=calls, ros_calls=ros_calls, poll=poll,
        options=options, state=state, clock=clock, run=run, pool_calls=pool_calls)


def test_unchanged_inputs_reuse_both_variants_but_recheck_feeds_and_specialists(gate_env):
    env = gate_env
    assert env.run()["forecasts_reused"] is False
    receipt = json.loads(dfs_refresh.STATUS_PATH.read_text())["forecast_reuse"]
    assert env.run()["forecasts_reused"] is True
    assert env.calls == [(pos, injury, force) for force in (True, False)
                         for pos in dfs_inputs.POSITIONS for injury in (True, False)]
    assert env.ros_calls == []  # Daily season worker owns ROS inference.
    assert env.poll.call_count == 2 and len(env.pool_calls) == 2
    assert json.loads(dfs_refresh.STATUS_PATH.read_text())["forecast_reuse"] == receipt
    assert env.pool_calls[-1][True]["qb"]["Projected Points"].iloc[0] == 11
    assert env.pool_calls[-1][False]["qb"]["Projected Points"].iloc[0] == 10


@pytest.mark.parametrize("source", ["players.json", "cache/nflverse_roster_2026.parquet", "schedule.parquet",
    "roles.yaml", "sentiment.parquet", "processed/qb_mlready.parquet", "processed/rb_mlready.csv",
    "processed/wr_mlready.parquet", "models/qb_model.joblib", "models/rb_model_calibrated.joblib",
    "models/wr_model_calibrated.joblib", "fp/2026_week04_proj.parquet", "fp/2026_week04_ecr_ALL.parquet",
    "src/inference.py", "requirements.txt"])
def test_each_real_dependency_change_forces_fresh_forecasts(gate_env, source):
    env = gate_env
    assert env.run()["status"] == "ok"
    (env.root / source).write_bytes(b"meaningfully-changed-source")
    assert env.run()["forecasts_reused"] is False
    assert all(force for _, _, force in env.calls) and all(env.ros_calls)


def test_same_content_feed_rewrite_does_not_force_inference(gate_env):
    gate_env.run()
    (gate_env.root / "players.json").write_bytes(b"source-v1")
    assert gate_env.run()["forecasts_reused"] is True


@pytest.mark.parametrize("operation", ["add", "delete"])
def test_source_appearance_or_removal_invalidates_reuse(gate_env, operation):
    path = gate_env.root / "sentiment.parquet"
    if operation == "add":
        path.unlink()
    gate_env.run()
    path.write_bytes(b"new-source") if operation == "add" else path.unlink()
    assert gate_env.run()["forecasts_reused"] is False


@pytest.mark.parametrize("context", [{"season": 2027}, {"week": 5}])
def test_season_and_week_boundaries_cannot_reuse_previous_context(gate_env, context):
    gate_env.run()
    gate_env.state.update(context)
    assert gate_env.run()["forecasts_reused"] is False


def test_age_limit_is_not_extended_by_successful_reuse_checks(gate_env):
    gate_env.run()
    for _ in range(dfs_refresh.DFS_FORECAST_MAX_AGE_SECONDS // dfs_refresh.DFS_REFRESH_SECONDS - 1):
        assert gate_env.run()["forecasts_reused"] is True
    assert gate_env.run()["forecasts_reused"] is False


@pytest.mark.parametrize("epoch", [None, "invalid", float("nan"), float("inf"), 1900000000])
def test_bad_or_future_receipt_age_fails_closed(gate_env, epoch):
    gate_env.run()
    previous = json.loads(dfs_refresh.STATUS_PATH.read_text())
    previous["forecast_reuse"]["computed_epoch"] = epoch
    dfs_refresh.STATUS_PATH.write_text(json.dumps(previous))
    assert gate_env.run()["forecasts_reused"] is False


@pytest.mark.parametrize("output", ["weekly/2026_w4_qb.parquet", "weekly/2026_w4_qb_no_inj.meta.json",
                                   "weekly/2026_w4_wr.parquet"])
@pytest.mark.parametrize("damage", ["missing", "corrupt"])
def test_artifact_damage_invalidates_receipt(gate_env, output, damage):
    gate_env.run()
    path = gate_env.root / output
    path.unlink() if damage == "missing" else path.write_bytes(b"broken")
    assert gate_env.run()["forecasts_reused"] is False


def test_force_bypasses_reuse_and_rate_gate(gate_env):
    gate_env.run()
    assert dfs_refresh.run_dfs_refresh()["status"] == "not_due"
    assert dfs_refresh.run_dfs_refresh(force=True)["forecasts_reused"] is False
    assert all(force for _, _, force in gate_env.calls)


def test_specialist_failure_preserves_weekly_proof_without_extending_it(gate_env):
    gate_env.run()
    previous = json.loads(dfs_refresh.STATUS_PATH.read_text())
    success, receipt = previous["last_success_at"], previous["forecast_reuse"]
    gate_env.options["pool_failure"] = True
    assert gate_env.run()["status"] == "error"
    failed = json.loads(dfs_refresh.STATUS_PATH.read_text())
    assert failed["last_success_at"] == success
    assert failed["forecast_status"] == "ok" and failed["forecast_reuse"] == receipt
    gate_env.options.clear()
    assert gate_env.run()["forecasts_reused"] is True


@pytest.mark.parametrize("phase", ["weekly", "pool"])
def test_inputs_changing_during_work_preserve_pool_and_cannot_seed_reuse(gate_env, phase):
    gate_env.run()
    (gate_env.root / "pool.bin").write_bytes(b"previous-pool")
    (gate_env.root / "players.json").write_bytes(b"initial-change")
    gate_env.options[f"change_during_{phase}"] = gate_env.root / "schedule.parquet"
    assert gate_env.run()["status"] == "error"
    assert (gate_env.root / "pool.bin").read_bytes() == b"previous-pool"
    assert "forecast_reuse" not in json.loads(dfs_refresh.STATUS_PATH.read_text())


def test_output_replacement_during_reuse_cannot_publish_pool(gate_env):
    gate_env.run()
    (gate_env.root / "pool.bin").write_bytes(b"previous-pool")
    gate_env.options["output_change_during_reuse"] = gate_env.root / "weekly/2026_w4_qb_no_inj.meta.json"
    assert gate_env.run()["status"] == "error"
    assert (gate_env.root / "pool.bin").read_bytes() == b"previous-pool"


def test_missing_legacy_or_unknown_receipts_recompute(gate_env):
    gate_env.run()
    previous = json.loads(dfs_refresh.STATUS_PATH.read_text())
    previous["forecast_reuse"]["version"] = -1
    dfs_refresh.STATUS_PATH.write_text(json.dumps(previous))
    assert gate_env.run()["forecasts_reused"] is False
    previous = json.loads(dfs_refresh.STATUS_PATH.read_text())
    previous.pop("forecast_reuse")
    dfs_refresh.STATUS_PATH.write_text(json.dumps(previous))
    assert gate_env.run()["forecasts_reused"] is False


def test_source_resolution_keeps_existing_feed_cache_contracts(monkeypatch):
    schedule, roster = Mock(), Mock()
    monkeypatch.setattr("src.core.schedule_utils._load_schedules", schedule)
    monkeypatch.setattr("src.integrations.nflverse_roster.load_seasonal_roster", roster)
    dfs_inputs.prepare_sources(2026)
    schedule.assert_called_once_with([2026])
    roster.assert_called_once_with(2026)


def test_force_cannot_bypass_another_refresh_owner(gate_env):
    from src.jobs.refresh_lock import refresh_lock
    with refresh_lock(dfs_refresh.CACHE_DIR / "last_refresh.lock"):
        assert dfs_refresh.run_dfs_refresh(force=True)["status"] == "already_running"
    gate_env.poll.assert_not_called()


def test_no_secrets_or_operational_status_files_enter_input_proof(gate_env):
    before = dfs_inputs.input_revision(2026, 4)
    for filename in (".env", "job_diagnostics.sqlite3", "dfs_refresh.json", "injury_poll.json"):
        (gate_env.root / filename).write_text("private-values")
    assert dfs_inputs.input_revision(2026, 4) == before


def test_model_replacement_with_preserved_mtime_is_detected(gate_env):
    import os
    gate_env.run()
    path = gate_env.root / "models/qb_model.joblib"
    original = path.stat()
    replacement = path.with_suffix(".tmp")
    replacement.write_bytes(b"source-v2")
    os.utime(replacement, ns=(original.st_atime_ns, original.st_mtime_ns))
    replacement.replace(path)
    assert gate_env.run()["forecasts_reused"] is False


def test_unstable_source_check_fails_closed(gate_env, monkeypatch):
    path = gate_env.root / "players.json"
    original = dfs_inputs._digest
    def changing(filename, *stamp):
        value = original(filename, *stamp)
        if filename == str(path):
            path.write_bytes(path.read_bytes() + b"change")
        return value
    monkeypatch.setattr(dfs_inputs, "_digest", changing)
    assert gate_env.run()["status"] == "error"
    assert not gate_env.calls


def test_rebuild_clears_old_in_memory_sources(monkeypatch):
    from src.projections import predict, rookie_role
    from src.integrations import sleeper, nflverse_roster
    from src.core import schedule_utils
    monkeypatch.setattr(predict, "_MODEL_CACHE", {"old": (0, {})})
    monkeypatch.setattr(sleeper, "_PLAYERS_RAW_CACHE", {"old": {}})
    monkeypatch.setattr(sleeper, "_PLAYERS_DF_CACHE", pd.DataFrame([{"old": 1}]))
    nfl = Mock()
    monkeypatch.setattr(nflverse_roster, "invalidate_roster_cache", nfl)
    dfs_inputs.invalidate_forecast_memory(2026)
    assert predict._MODEL_CACHE == {}
    assert sleeper._PLAYERS_RAW_CACHE is None and sleeper._PLAYERS_DF_CACHE is None
    assert rookie_role._load_overrides_file.cache_info().currsize == 0
    assert schedule_utils._schedule_snapshot.cache_info().currsize == 0
    nfl.assert_called_once_with(2026)


def test_runtime_numerical_version_change_invalidates_reuse(gate_env, monkeypatch):
    gate_env.run()
    monkeypatch.setattr(dfs_inputs, "runtime_revision", lambda: ("new-runtime",))
    assert gate_env.run()["forecasts_reused"] is False


@pytest.mark.parametrize("previous_status", ["error", "running", "unknown"])
def test_unsuccessful_status_cannot_authorize_reuse(gate_env, previous_status):
    gate_env.run()
    previous = json.loads(dfs_refresh.STATUS_PATH.read_text())
    previous["status"] = previous_status
    previous.pop("forecast_status", None)  # Legacy receipts require a whole-job success.
    dfs_refresh.STATUS_PATH.write_text(json.dumps(previous))
    assert gate_env.run()["forecasts_reused"] is False


@pytest.mark.parametrize("previous", [[], None, {"completed_epoch": "invalid"}, {"completed_epoch": float("nan")}])
def test_malformed_status_cannot_block_fresh_work(gate_env, previous):
    dfs_refresh.STATUS_PATH.write_text(json.dumps(previous))
    assert gate_env.run()["forecasts_reused"] is False


def test_public_status_exposes_reuse_decision_but_not_receipt(gate_env):
    gate_env.run()
    gate_env.run()
    status = dfs_refresh.refresh_status()
    assert status["forecasts_reused"] is True
    assert status["forecast_max_age_seconds"] == 3600
    assert "forecast_reuse" not in status
