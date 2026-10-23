"""Synthetic same-name identities reproduce wiring, not the supplied slate."""
import pandas as pd
import pytest


def test_prediction_opportunity_preserves_same_name_row_identity(monkeypatch):
    import src.projections.predict as predict

    inputs = pd.DataFrame([
        {"player_id": "buf-id", "player_display_name": "Synthetic Same Name", "team": "BUF", "position": "WR"},
        {"player_id": "la-id", "player_display_name": "Synthetic Same Name", "team": "LA", "position": "WR"},
    ], index=[7, 12])
    monkeypatch.setattr(predict, "load_model", lambda *a, **kw: {"quantile_models": {0.5: object()}})
    features = pd.DataFrame({"feature": [1, 2]}, index=inputs.index)
    features.attrs["input_quality"] = {}
    monkeypatch.setattr(predict, "prepare_feature_matrix", lambda *a, **kw: features)
    monkeypatch.setattr(predict, "predict_quantiles", lambda *a: pd.DataFrame({"q10": [5., 5.], "q50": [10., 10.], "q90": [20., 20.]}))
    def boosts(frame):
        out = frame.copy()
        out["injury_opportunity_boost"] = [.2, 0.]
        out["injury_note"] = ["Synthetic driver (Out)", ""]
        return out
    monkeypatch.setattr(predict, "compute_vacated_usage", boosts)
    monkeypatch.setattr(predict, "_attach_sleeper_injury_status", lambda frame: frame)
    out = predict.predict_from_features(inputs, "wr").set_index("player_id")
    assert out.loc["buf-id", "Projected Points"] == pytest.approx(12)
    assert out.loc["la-id", "Projected Points"] == pytest.approx(10)
    assert out.loc["buf-id", "Injury Note"] == "Synthetic driver (Out)"
    assert out.loc["la-id", "Injury Note"] == ""


def test_overlay_opportunity_preserves_canonical_team_identity(monkeypatch):
    from src.projections import injury_overlay as overlay
    baseline = pd.DataFrame([
        {"player_id": "buf-id", "Player": "Synthetic Same Name", "Team": "BUF", "Position": "WR", "Projected Points": 10.},
        {"player_id": "la-id", "Player": "Synthetic Same Name", "Team": "LA", "Position": "WR", "Projected Points": 10.},
    ])
    roster = pd.DataFrame([
        {"player_id": "buf-id", "player_display_name": "Synthetic Same Name", "team": "BUF", "position": "WR"},
        {"player_id": "la-id", "player_display_name": "Synthetic Same Name", "team": "LA", "position": "WR"},
    ])
    def boosts(frame, **kwargs):
        out = frame.copy()
        out["injury_opportunity_boost"] = [.2, 0.]
        out["injury_note"] = ["Synthetic driver (Out)", ""]
        return out
    monkeypatch.setattr(overlay, "compute_vacated_usage", boosts)
    rows = overlay.build_overlays_for_teams(2026, 5, {"BUF", "LA"}, baseline_df=baseline, roster_df=roster,
            injury_snapshot={"injury_snapshot_id": "synthetic", "players": []})
    by_id = {row["player_id"]: row for row in rows}
    assert by_id["buf-id"]["opportunity_adjustment"] == pytest.approx(2)
    assert by_id["la-id"]["opportunity_adjustment"] == pytest.approx(0)
    assert by_id["buf-id"]["injury_note"] == "Synthetic driver (Out)"
    assert by_id["la-id"]["injury_note"] is None


def test_pre_identity_fix_artifacts_are_stale_without_recomputing_or_overwriting(tmp_path, monkeypatch):
    import json
    from src.projections import weekly_cache as weekly, dfs_pool
    monkeypatch.setattr(weekly, "WEEKLY_PREDICTIONS_DIR", tmp_path / "weekly")
    monkeypatch.setattr(weekly, "PROCESSED_DATA_DIR", tmp_path / "features")
    monkeypatch.setattr(weekly, "MODEL_DIR", tmp_path / "models")
    monkeypatch.setattr("src.projections.roster_coverage.roster_input_revisions", lambda: [])
    monkeypatch.setattr("src.projections.input_policy.projection_input_revisions", lambda: [])
    monkeypatch.setattr(dfs_pool, "DFS_PREDICTIONS_DIR", tmp_path / "dfs")
    monkeypatch.setattr(dfs_pool, "BUNDLE_PATH", tmp_path / "absent-special-model.joblib")
    calls = []
    monkeypatch.setattr(weekly, "predict_upcoming_week", lambda *a, **kw: calls.append(kw))
    with monkeypatch.context() as old:
        old.setattr(weekly, "WEEKLY_POOL_POLICY", "v4-complete-roster")
        old_fingerprint = weekly.weekly_fingerprint()
        old_dfs_fingerprint = dfs_pool.pool_fingerprint()
    assert weekly.WEEKLY_POOL_POLICY == "v5-opportunity-identity"
    assert weekly.weekly_fingerprint() != old_fingerprint
    frame = pd.DataFrame([{"player_id": "synthetic", "Player": "Synthetic", "Team": "BUF", "Position": "WR",
                           "Projected Points": 10., "Low (P10)": 1., "High (P90)": 20.}])
    parquet, metadata = weekly._artifact_paths("wr", 2026, 5, True)
    frame.to_parquet(parquet, index=False)
    metadata.write_text(json.dumps({"position": "wr", "season": 2026, "week": 5,
        "apply_injury_adjustments": True, "fingerprint": old_fingerprint, "rows": len(frame),
        "built_at": "2026-10-12T12:00:00Z"}))
    before = (parquet.read_bytes(), metadata.read_bytes())
    weekly.invalidate_weekly_cache()
    stale = weekly.load_weekly_prediction("wr", 2026, 5, allow_compute=False, allow_stale=True, apply_identity=False)
    assert stale.attrs["projection_stale"] is True
    assert stale.iloc[0]["Projected Points"] == 10.
    assert (parquet.read_bytes(), metadata.read_bytes()) == before
    assert calls == []
    deep = dfs_pool.artifact_path(2026, 5, True)
    deep.parent.mkdir(parents=True)
    frame.attrs.update(pool_version=dfs_pool.POOL_VERSION, season=2026, week=5, fingerprint=old_dfs_fingerprint,
                       special_history_current_season_available=True)
    frame.to_parquet(deep, index=False)
    before_deep = deep.read_bytes()
    assert dfs_pool.load_dfs_pool(2026, 5, True).attrs["projection_stale"] is True
    assert deep.read_bytes() == before_deep
