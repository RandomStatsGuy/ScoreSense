"""Reconcile real saved files; new artifact timestamps cannot hide old inputs."""
import pandas as pd
import pytest

from src.projections import data_integrity as audit, weekly_cache, ros_cache, player_card_history
from src.draft_hub import draft_pool_cache


@pytest.fixture
def files(tmp_path, monkeypatch, trusted_native_catalog):
    processed = tmp_path / "processed"
    processed.mkdir()
    monkeypatch.setattr(audit, "PROCESSED_DATA_DIR", processed)
    monkeypatch.setattr(player_card_history, "PROCESSED_DATA_DIR", processed)
    monkeypatch.setattr(draft_pool_cache, "DRAFT_POOL_DIR", tmp_path / "draft_pool")
    monkeypatch.setattr(draft_pool_cache, "PROCESSED_DATA_DIR", processed)
    monkeypatch.setattr(draft_pool_cache, "pool_fingerprint", lambda: "fixture")
    for module, attribute, directory in ((weekly_cache, "WEEKLY_PREDICTIONS_DIR", "weekly"),
                                         (ros_cache, "ROS_PREDICTIONS_DIR", "ros")):
        monkeypatch.setattr(module, attribute, tmp_path / directory)
        monkeypatch.setattr(module, "PROCESSED_DATA_DIR", processed)
        monkeypatch.setattr(module, "_with_roster_identity", lambda frame, *a, **k: frame)
        monkeypatch.setattr(module, f"{directory}_fingerprint", lambda: "fixture")
    schedule = tmp_path / "schedule.parquet"
    games = pd.DataFrame([{"season": 2026, "week": week, "game_type": "REG", "home_team": "DAL", "away_team": "NYG",
                          "home_score": 20 if week <= 6 else None, "away_score": 17 if week <= 6 else None}
                         for week in range(1, 18)])
    games.to_parquet(schedule)
    monkeypatch.setattr(audit, "SCHEDULE_CACHE", schedule)
    monkeypatch.setattr(player_card_history, "SCHEDULE_CACHE", schedule)
    monkeypatch.setattr("app.projection_recovery.projection_recovery_snapshot", lambda: [])
    monkeypatch.setattr("src.jobs.weekly_refresh.get_refresh_status", lambda: {"status": "completed"})
    for i, position in enumerate(("qb", "rb", "wr"), start=1):
        trusted_native_catalog(str(8000 + i), name=f"Test {position}", team="DAL", position=position.upper(), gsis_id=f"00-003700{i}")
    for i, position in enumerate(("qb", "rb", "wr"), start=1):
        pid = f"00-003700{i}"
        pd.DataFrame([{"player_id": pid, "season": 2026, "week": week, "team": "DAL", "Fpts": 0.0}
                      for week in range(1, 5)]).to_parquet(processed / f"{position}_mlready.parquet")
        weekly = pd.DataFrame([{"player_id": pid, "Season": 2026, "Week": 7, "Player": f"Test {position}",
                                "Position": position.upper(), "Projected Points": 10.0}])
        weekly_cache.save_weekly_artifact(position, 2026, 7, True, weekly)
        ros = pd.DataFrame([{"player_id": pid, "Season": 2026, "From Week": 7, "ROS P50": 100.0, "Season P50": 200.0}])
        ros_cache.save_ros_artifact(position, 2026, 7, True, ros)
    draft_pool_cache.save_pool_artifact(2026, pd.DataFrame([
        {"player_id": f"00-003700{i}", "Season": 2026, "Position": position.upper(), "Season Proj": 170.0, "Season P50": 170.0}
        for i, position in enumerate(("qb", "rb", "wr"), start=1)]))
    yield processed
    ros_cache.invalidate_ros_cache()


def test_recent_forecast_publication_does_not_hide_old_source_cutoff(files):
    report = audit.audit_projection_integrity(season=2026, week=7, player_ids=["8003"])
    assert report["status"] == "warning"
    assert report["sources"]["wr"]["source_through_week"] == 4
    assert report["sources"]["wr"]["source_ingested_at"] is None
    assert report["sources"]["schedule"]["latest_completed_game_week"] == 6
    assert all(d["status"] == "ready" for d in report["artifacts"].values())
    gaps = [f for f in report["findings"] if f["code"] == "source_cutoff_behind_completed_games"]
    assert len(gaps) == 3
    player = report["players"][0]
    assert player["identity"]["canonical_id"] == "00-0037003"
    assert player["history_coverage"]["unverified_weeks"] == [5, 6]


def test_duplicate_game_keys_report_ids_and_requested_context(files):
    path = files / "wr_mlready.parquet"
    frame = pd.read_parquet(path)
    pd.concat([frame, frame.iloc[[0]]]).to_parquet(path, index=False)
    report = audit.audit_projection_integrity(season=2026, week=7)
    duplicate = next(f for f in report["findings"] if f["code"] == "duplicate_player_game_keys")
    assert report["status"] == "failed"
    assert duplicate["season"] == 2026 and duplicate["week"] == 7
    assert duplicate["examples"][0]["player_id"] == "00-0037003"


def test_alias_duplicates_in_forecast_fail_canonical_cardinality(files):
    frame = pd.DataFrame([{"player_id": "00-0037003", "Season": 2026, "Week": 7, "Projected Points": 10.0},
                          {"player_id": "sleeper-8003", "Season": 2026, "Week": 7, "Projected Points": 10.0}])
    weekly_cache.save_weekly_artifact("wr", 2026, 7, True, frame)
    report = audit.audit_projection_integrity(season=2026, week=7)
    conflict = next(f for f in report["findings"] if f["code"] == "duplicate_canonical_projection")
    assert conflict["resolved_id"] == "00-0037003"
    assert conflict["source"] == "weekly:wr"
    assert report["status"] == "failed"


def test_failed_recovery_is_reported_without_retrying(files, monkeypatch):
    monkeypatch.setattr("app.projection_recovery.projection_recovery_snapshot", lambda: [
        {"status": "failed", "kind": "weekly", "season": 2026, "week": 7, "reason": "no_predictions"}])
    report = audit.audit_projection_integrity(season=2026, week=7)
    assert any(f["code"] == "recovery_failed" for f in report["findings"])
    assert report["status"] == "failed"


def test_missing_requested_identity_and_forecast_cannot_silently_pass(files, trusted_native_catalog):
    trusted_native_catalog("8999", name="Missing Rookie", team="DAL", position="WR", gsis_id="00-0037999")
    report = audit.audit_projection_integrity(season=2026, week=7, player_ids=["8999", "unknown"])
    assert any(f["code"] == "requested_projection_missing" and f["resolved_id"] == "00-0037999" for f in report["findings"])
    assert any(f["code"] == "unresolved_requested_identity" and f["requested_id"] == "unknown" for f in report["findings"])


def test_malformed_source_diagnostics_preserve_null_in_json(files):
    import json
    path = files / "wr_mlready.parquet"
    frame = pd.read_parquet(path)
    frame.loc[0, "player_id"] = None
    pd.concat([frame, frame.iloc[[0]]]).to_parquet(path, index=False)
    report = audit.audit_projection_integrity(season=2026, week=7)
    assert report["status"] == "failed"
    json.dumps(report, allow_nan=False)
    duplicate = next(f for f in report["findings"] if f["code"] == "duplicate_player_game_keys")
    assert duplicate["examples"][0]["player_id"] is None
