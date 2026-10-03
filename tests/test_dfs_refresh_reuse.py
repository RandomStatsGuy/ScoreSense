"""Reuse real roster/prediction assembly, with model heads and feeds isolated."""
import json
from unittest.mock import Mock

import numpy as np
import pandas as pd
import pytest

from src.jobs import dfs_refresh
from src.projections import dfs_pool, predict, weekly_cache


@pytest.fixture
def prediction_env(tmp_path, monkeypatch):
    weekly_dir = tmp_path / "weekly"
    monkeypatch.setattr(weekly_cache, "WEEKLY_PREDICTIONS_DIR", weekly_dir)
    monkeypatch.setattr(weekly_cache, "weekly_fingerprint", lambda: "fresh-inputs")
    monkeypatch.setattr(predict, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(dfs_pool, "DFS_PREDICTIONS_DIR", tmp_path / "dfs")
    monkeypatch.setattr(dfs_pool, "pool_fingerprint", lambda: "fresh-inputs")
    monkeypatch.setattr(dfs_refresh.dfs_inputs, "prepare_sources", lambda *a: None)
    monkeypatch.setattr(dfs_refresh.dfs_inputs, "input_revision", lambda *a: "fixture-inputs")
    monkeypatch.setattr("src.projections.ros_cache.ROS_PREDICTIONS_DIR", tmp_path / "ros")
    monkeypatch.setattr("src.projections.projection_movement.WEEKLY_PROJECTION_CHANGES_DIR", tmp_path / "movement")
    roster, nflverse, rookies = [], [], {}
    for index, pos in enumerate(("qb", "rb", "wr")):
        rows = []
        for offset, role in enumerate(("Starter", "Backup", "Rookie"), 1):
            pid = f"00-{index * 10 + offset:07d}"
            position = "TE" if pos == "wr" and role == "Backup" else pos.upper()
            name = f"{pos.upper()} {role}"
            row = {"player_id": pid, "player_display_name": name, "team": "KC", "position": position,
                   "season": 2026, "week": 3, "value": float(12 - offset),
                   "carry_share_avg": .25, "target_share_avg": .25,
                   "_projection_injury_status": "Out" if role == "Backup" else ""}
            roster.append({"sleeper_id": pid, "gsis_id": pid, "full_name": name, "team": "KC",
                           "position": position, "status": "Active", "injury_status": row["_projection_injury_status"]})
            if role == "Rookie":
                rookies[pos] = {**row, "_rookie_estimate": True, "_roster_estimate": True,
                                "_opportunity_observed": False}
            else:
                rows.append(row)
                nflverse.append({"player_id": pid, "team": "KC", "position": position, "status": "ACT"})
        pd.DataFrame(rows).to_parquet(tmp_path / f"{pos}_mlready.parquet")
    roster.append({"sleeper_id": "reserve", "gsis_id": "00-0000099", "full_name": "Reserve RB",
                   "team": "KC", "position": "RB", "status": "Inactive", "injury_status": "IR"})
    roster = pd.DataFrame(roster)
    monkeypatch.setattr("src.integrations.sleeper.players_dataframe", lambda **k: roster.copy())
    monkeypatch.setattr("src.integrations.nflverse_roster.load_seasonal_roster", lambda *a, **k: pd.DataFrame(nflverse))
    monkeypatch.setattr("src.projections.roster_coverage.projection_roster_players", lambda *a: roster.copy())
    def overlay(frame, pos, **kwargs):
        assert kwargs["add_missing"] and kwargs["add_rookies"]
        assert not kwargs["add_emerging"]
        rookie = {**rookies[pos], "week": kwargs["target_week"]}
        return pd.concat([frame, pd.DataFrame([rookie])], ignore_index=True), {"applied": True}
    monkeypatch.setattr("src.integrations.sleeper.apply_sleeper_roster_overlay", overlay)
    monkeypatch.setattr(predict, "attach_schedule_context", lambda frame, *a: frame.assign(opponent="BUF"))
    monkeypatch.setattr("src.integrations.sleeper.apply_vet_backup_projection_scale", lambda frame, *a: frame)
    monkeypatch.setattr("src.projections.matchup_context.attach_matchup_context", lambda frame, *a: frame)
    injuries = roster[roster.injury_status.eq("Out")]
    monkeypatch.setattr(predict, "injured_players", lambda: injuries.copy())
    monkeypatch.setattr("src.core.opportunity.injured_players", lambda: injuries.copy())
    monkeypatch.setattr(predict, "load_model", lambda *a: {"quantile_models": {0.5: object()}, "feature_cols": ["value"]})
    def features(frame, *a, **k):
        out = frame[["value"]].copy()
        out.attrs["input_quality"] = {"complete": True, "rows": len(out)}
        return out
    monkeypatch.setattr(predict, "prepare_feature_matrix", features)
    heads = Mock(side_effect=lambda models, x: pd.DataFrame({"q10": x.value - 2, "q50": x.value, "q90": x.value + 3}))
    monkeypatch.setattr(predict, "predict_quantiles", heads)
    history = pd.DataFrame([{"season": 2026, "week": 3}])
    history.attrs["current_season_available"] = True
    monkeypatch.setattr(dfs_pool.joblib, "load", lambda *a: {"history": history})
    monkeypatch.setattr("src.jobs.dfs_special_history.refresh_special_history", lambda *a: history.copy())
    monkeypatch.setattr("src.core.schedule_utils.week_matchups", lambda *a: {"KC": "BUF"})
    special = pd.DataFrame([{"player_id": pid, "Player": pos, "Position": pos, "Team": "KC",
                             "Projected Points": 6., "Low (P10)": 1., "High (P90)": 12.,
                             "projection_source": "ScoreSense" if pos == "DST" else "Historical estimate",
                             "projection_model": "test-special", "projection_site": "draftkings" if pos == "DST" else "dk_fd_kicking"}
                            for pid, pos in (("dst:KC", "DST"), ("kicker", "K"))])
    monkeypatch.setattr(dfs_pool, "special_team_predictions", lambda *a: special.copy())
    return heads


def test_scheduled_refresh_reuses_six_passes_with_equivalent_dfs_output(prediction_env, tmp_path, monkeypatch, diagnostics_enabled):
    # Establish the original standalone path for both variants before reuse.
    dfs_pool.refresh_dfs_pool(2026, 4)
    expected = {injury: dfs_pool.load_dfs_pool(2026, 4, injury) for injury in (True, False)}
    assert prediction_env.call_count == 6
    prediction_env.reset_mock()
    monkeypatch.setattr(dfs_refresh, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(dfs_refresh, "STATUS_PATH", tmp_path / "status.json")
    monkeypatch.setattr("src.integrations.injury_poll.run_injury_poll", lambda **k: {"status": "ok"})
    monkeypatch.setattr("src.integrations.sleeper.get_nfl_state", lambda **k: {"season": 2026, "week": 4, "season_type": "regular"})
    monkeypatch.setattr("src.projections.ros_cache.load_ros_prediction", lambda *a, **k: pd.DataFrame([{"ROS P50": 100}]))
    result = dfs_refresh.run_dfs_refresh()
    assert result["status"] == "ok"
    assert prediction_env.call_count == 6
    for injury in (True, False):
        actual = dfs_pool.load_dfs_pool(2026, 4, injury)
        original = expected[injury]
        pd.testing.assert_frame_equal(actual, original)
        assert actual.attrs.keys() == original.attrs.keys()
        assert {k: v for k, v in actual.attrs.items() if k != "built_at"} == {k: v for k, v in original.attrs.items() if k != "built_at"}
        assert not actual.player_id.duplicated().any()
        assert {"QB", "RB", "WR", "TE", "K", "DST"} <= set(actual.Position)
        assert actual.projection_source.eq("Roster estimate").sum() == 3
        assert np.isnan(actual.loc[actual.player_id.eq("00-0000099"), "Projected Points"]).all()
        assert not actual.attrs["projection_stale"]
    assert not expected[True]["Projected Points"].equals(expected[False]["Projected Points"])
    from src.ops.job_report import read_report
    jobs = {item["job"]: item for item in read_report(diagnostics_enabled, limit=100)["jobs"]}
    assert jobs["dfs_refresh"]["runs"] == 1
    assert jobs["dfs_refresh.weekly_qb_raw"]["last_observed_metadata"]["force"] is True
    assert jobs["dfs_refresh.weekly_qb_raw"]["last_observed_metadata"]["input_revision"]
    assert jobs["dfs_refresh.pool"]["nested"] is True


def test_reuse_bypasses_only_read_overlay_and_preserves_published_weekly_frame(prediction_env, tmp_path):
    fresh = weekly_cache.load_weekly_prediction("qb", 2026, 4, force=True, apply_identity=False)
    assert set(fresh.player_id) == {"00-0000001", "00-0000002", "00-0000003"}
    parquet, meta = weekly_cache._artifact_paths("qb", 2026, 4, True)
    assert set(pd.read_parquet(parquet).player_id) == set(fresh.player_id)
    assert fresh.attrs["built_at"] and meta.exists()
    # Preserve the default reader's existing identity filtering behavior.
    default = weekly_cache.load_weekly_prediction("qb", 2026, 4, allow_compute=False)
    assert set(default.player_id) == {"00-0000001", "00-0000002"}
    assert prediction_env.call_count == 1


def test_mixed_cache_and_inference_phase_does_not_report_whole_job_skipped(prediction_env, diagnostics_enabled):
    from src.ops.job_diagnostics import observe_job
    from src.ops.job_report import read_report
    weekly_cache.load_weekly_prediction("qb", 2026, 4, force=True, apply_identity=False)
    @observe_job("mixed_prediction")
    def job():
        weekly_cache.load_weekly_prediction("qb", 2026, 4, apply_identity=False)
        return weekly_cache.load_weekly_prediction("rb", 2026, 4, force=True, apply_identity=False)
    assert not job().empty
    observed = next(item for item in read_report(diagnostics_enabled)["jobs"] if item["job"] == "mixed_prediction")
    assert observed["skips"] == 0
    assert observed["last_observed_metadata"]["computation_performed"] is True
    assert observed["last_observed_metadata"]["cache_hit"] is False


def test_failed_weekly_variant_keeps_previous_dfs_pools_and_success(prediction_env, tmp_path, monkeypatch):
    dfs_pool.refresh_dfs_pool(2026, 4)
    before = {injury: dfs_pool.artifact_path(2026, 4, injury).read_bytes() for injury in (True, False)}
    monkeypatch.setattr(dfs_refresh, "CACHE_DIR", tmp_path)
    status_path = tmp_path / "status.json"
    monkeypatch.setattr(dfs_refresh, "STATUS_PATH", status_path)
    status_path.write_text(json.dumps({"last_success_at": "previous-success"}))
    monkeypatch.setattr("src.integrations.injury_poll.run_injury_poll", lambda **k: {"status": "ok"})
    monkeypatch.setattr("src.integrations.sleeper.get_nfl_state", lambda **k: {"season": 2026, "week": 4, "season_type": "regular"})
    monkeypatch.setattr("src.projections.ros_cache.load_ros_prediction", lambda *a, **k: pd.DataFrame([{"ROS P50": 100}]))
    head = prediction_env.side_effect
    prediction_env.reset_mock()
    def fail_raw_qb(models, x):
        if prediction_env.call_count == 2:
            raise RuntimeError("raw QB head failed")
        return head(models, x)
    prediction_env.side_effect = fail_raw_qb
    result = dfs_refresh.run_dfs_refresh()
    assert result["status"] == "error"
    assert result["last_success_at"] == "previous-success"
    assert "dfs" not in result["positions"]
    assert {"rb", "wr", "ros_qb", "ros_rb", "ros_wr"} <= result["positions"].keys()
    assert prediction_env.call_count == 6
    assert {injury: dfs_pool.artifact_path(2026, 4, injury).read_bytes() for injury in (True, False)} == before


@pytest.mark.parametrize("damage", ["missing_variant", "missing_position", "empty", "stale", "week", "season", "selective", "duplicate"])
def test_invalid_reuse_preserves_both_previous_pools(prediction_env, monkeypatch, damage):
    dfs_pool.refresh_dfs_pool(2026, 4)
    before = {injury: dfs_pool.artifact_path(2026, 4, injury).read_bytes() for injury in (True, False)}
    frames = {injury: {pos: weekly_cache.load_weekly_prediction(pos, 2026, 4, force=True,
                       apply_injury_adjustments=injury, apply_identity=False) for pos in ("qb", "rb", "wr")}
              for injury in (True, False)}
    raw = frames[False]["wr"]
    if damage == "missing_variant":
        del frames[False]
    elif damage == "missing_position":
        del frames[False]["wr"]
    elif damage == "empty":
        frames[False]["wr"] = pd.DataFrame()
    elif damage == "stale":
        raw.attrs["projection_stale"] = True
    elif damage in {"week", "season"}:
        raw[damage.title()] = 3 if damage == "week" else 2025
    elif damage == "selective":
        raw.attrs["inference_meta"]["depth_mode"] = "starter"
    else:
        raw.loc[0, "player_id"] = frames[False]["qb"].iloc[0].player_id
    inference = Mock(side_effect=AssertionError("must not repeat inference"))
    monkeypatch.setattr(predict, "predict_upcoming_week", inference)
    with pytest.raises(ValueError):
        dfs_pool.refresh_dfs_pool(2026, 4, skill_predictions=frames)
    inference.assert_not_called()
    assert {injury: dfs_pool.artifact_path(2026, 4, injury).read_bytes() for injury in (True, False)} == before


def test_unchanged_refresh_uses_real_saved_readers_and_refreshes_specialists(prediction_env, tmp_path, monkeypatch):
    from src.projections import ros_cache
    monkeypatch.setattr(dfs_refresh, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(dfs_refresh, "STATUS_PATH", tmp_path / "status.json")
    monkeypatch.setattr("src.integrations.injury_poll.run_injury_poll", lambda **k: {"status": "ok"})
    monkeypatch.setattr("src.integrations.sleeper.get_nfl_state", lambda **k: {"season": 2026, "week": 4, "season_type": "regular"})
    monkeypatch.setattr(ros_cache, "ros_fingerprint", lambda: "fresh-inputs")
    ros_heads = Mock(side_effect=lambda *a, **k: pd.DataFrame([{"ROS P50": 100.0}]))
    monkeypatch.setattr(ros_cache, "predict_rest_of_season", ros_heads)
    now = [1800000000.0]
    monkeypatch.setattr(dfs_refresh.time, "time", lambda: now[0])
    assert dfs_refresh.run_dfs_refresh()["forecasts_reused"] is False
    expected = {injury: dfs_pool.load_dfs_pool(2026, 4, injury) for injury in (True, False)}
    assert prediction_env.call_count == 6 and ros_heads.call_count == 3
    prediction_env.reset_mock()
    ros_heads.reset_mock()
    # Fresh specialist values must reach the pool while all six skill frames
    # are read from their original materialized artifacts.
    special_columns = ["player_id", "Player", "Position", "Team", "Projected Points", "Low (P10)", "High (P90)",
                       "projection_source", "projection_model", "projection_site"]
    special = Mock(side_effect=lambda *a: expected[True].loc[
        expected[True].Position.isin(["K", "DST"]), special_columns].assign(**{"Projected Points": 7.0}))
    monkeypatch.setattr(dfs_pool, "special_team_predictions", special)
    now[0] += dfs_refresh.DFS_REFRESH_SECONDS
    assert dfs_refresh.run_dfs_refresh()["forecasts_reused"] is True
    prediction_env.assert_not_called()
    ros_heads.assert_not_called()
    special.assert_called_once()
    for injury in (True, False):
        actual = dfs_pool.load_dfs_pool(2026, 4, injury)
        skill = actual[actual.Position.isin(["QB", "RB", "WR", "TE"])]
        prior = expected[injury][expected[injury].Position.isin(["QB", "RB", "WR", "TE"])]
        pd.testing.assert_frame_equal(skill.reset_index(drop=True), prior.reset_index(drop=True))
        assert actual[actual.Position.isin(["K", "DST"])]["Projected Points"].eq(7).all()


def test_changed_sources_after_specialist_assembly_preserve_both_real_pools(prediction_env):
    dfs_pool.refresh_dfs_pool(2026, 4)
    before = {injury: dfs_pool.artifact_path(2026, 4, injury).read_bytes() for injury in (True, False)}
    frames = {injury: {pos: weekly_cache.load_weekly_prediction(pos, 2026, 4,
        force=True, apply_injury_adjustments=injury, apply_identity=False) for pos in ("qb", "rb", "wr")}
        for injury in (True, False)}
    def changed():
        raise RuntimeError("source changed before publication")
    with pytest.raises(RuntimeError, match="source changed"):
        dfs_pool.refresh_dfs_pool(2026, 4, skill_predictions=frames, validate_inputs=changed)
    assert {injury: dfs_pool.artifact_path(2026, 4, injury).read_bytes() for injury in (True, False)} == before
