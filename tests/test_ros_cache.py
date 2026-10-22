"""Tests for materialized ROS prediction cache."""

from __future__ import annotations

import json
from unittest.mock import patch

import pandas as pd
import pytest

from src.projections import ros_cache


@pytest.fixture(autouse=True)
def _clear_ros_cache():
    ros_cache.invalidate_ros_cache()
    yield
    ros_cache.invalidate_ros_cache()


def test_ros_fingerprint_stable(monkeypatch, tmp_path):
    feat = tmp_path / "qb_mlready.parquet"
    feat.write_bytes(b"x")
    monkeypatch.setattr(ros_cache, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(ros_cache, "MODEL_DIR", tmp_path)
    fp1 = ros_cache.ros_fingerprint()
    fp2 = ros_cache.ros_fingerprint()
    assert fp1 == fp2
    assert len(fp1) == 16


def test_load_ros_prediction_uses_artifact(monkeypatch, tmp_path):
    season, week = 2025, 10
    ros_dir = tmp_path / "ros"
    monkeypatch.setattr(ros_cache, "ROS_PREDICTIONS_DIR", ros_dir)
    monkeypatch.setattr(ros_cache, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(ros_cache, "MODEL_DIR", tmp_path)

    sample = pd.DataFrame(
        {
            "player_id": ["00-0000001"],
            "Player": ["Test Player"],
            "Season": [season],
            "From Week": [week],
            "Weeks Remaining": [8],
            "ROS P50": [100.0],
            "Season P50": [200.0],
        }
    )
    ros_cache.save_ros_artifact("qb", season, week, True, sample)

    with patch.object(ros_cache, "predict_rest_of_season") as compute:
        loaded = ros_cache.load_ros_prediction("qb", season=season, week=week)
        compute.assert_not_called()

    assert len(loaded) == 1
    assert loaded.iloc[0]["Player"] == "Test Player"



def test_artifact_invalidates_on_fingerprint_change(monkeypatch, tmp_path):
    season, week = 2025, 10
    ros_dir = tmp_path / "ros"
    monkeypatch.setattr(ros_cache, "ROS_PREDICTIONS_DIR", ros_dir)
    monkeypatch.setattr(ros_cache, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(ros_cache, "MODEL_DIR", tmp_path)

    sample = pd.DataFrame({"player_id": ["00-0000001"], "Player": ["A"], "Season": [season], "ROS P50": [100.0], "Season P50": [200.0]})
    ros_cache.save_ros_artifact("qb", season, week, True, sample)

    # Staleness follows the source revision, not a forged compatibility sidecar.
    monkeypatch.setattr(ros_cache, "ros_fingerprint", lambda: "new-input-fingerprint")

    recomputed = pd.DataFrame({"player_id": ["00-0000002"], "Player": ["B"], "Season": [season], "ROS P50": [100.0], "Season P50": [200.0]})
    with patch.object(ros_cache, "predict_rest_of_season", return_value=recomputed):
        ros_cache.invalidate_ros_cache()
        loaded = ros_cache.load_ros_prediction("qb", season=season, week=week)

    assert loaded.iloc[0]["Player"] == "B"



def test_legacy_ros_recovers_receiver_identity_without_rebuilding_or_rewriting(monkeypatch, tmp_path):
    from src.integrations import roster_identity as identity

    monkeypatch.setattr(ros_cache, "ROS_PREDICTIONS_DIR", tmp_path / "ros")
    monkeypatch.setattr(ros_cache, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(ros_cache, "MODEL_DIR", tmp_path)
    monkeypatch.setattr(identity, "_OVERLAY_CACHE", {})
    sample = pd.DataFrame({
        "Player": ["Known receiver", "Known tight end", "Unknown rookie"],
        "player_id": ["00-0001001", "00-0001002", "rookie_unknown"],
        "Team": ["ATL", "ATL", "ATL"], "Season": [2026] * 3,
        "From Week": [6] * 3, "Weeks Remaining": [10] * 3,
        "Season P50": [250.0, 200.0, 0.0], "ROS P50": [190.0, 153.0, 0.0],
    })
    roster = pd.DataFrame({
        "player_id": ["00-0001001", "00-0001002"],
        "player_name": ["Known receiver", "Known tight end"],
        "team": ["ATL", "ATL"], "position": ["WR", "TE"], "status": ["ACT", "ACT"],
    })
    real_overlay = identity.apply_roster_identity_overlay

    def fixture_overlay(frame, position, **kwargs):
        return real_overlay(frame, position, nflverse_df=roster, sleeper_df=pd.DataFrame(),
                            load_defaults=False, **kwargs)

    monkeypatch.setattr(identity, "apply_roster_identity_overlay", fixture_overlay)
    ros_cache.save_ros_artifact("wr", 2026, 6, True, sample)
    path, _ = ros_cache._artifact_paths("wr", 2026, 6, True)
    original_bytes = path.read_bytes()
    with patch.object(ros_cache, "predict_rest_of_season") as compute:
        cold = ros_cache.load_ros_prediction("wr", season=2026, week=6, allow_compute=False)
        warm = ros_cache.load_ros_prediction("wr", season=2026, week=6, allow_compute=False)
        compute.assert_not_called()
    for loaded in [cold, warm]:
        assert loaded["Position"].tolist()[:2] == ["WR", "TE"]
        assert pd.isna(loaded["Position"].iloc[2])
        pd.testing.assert_frame_equal(loaded[sample.columns], sample)
        assert loaded.attrs.get("built_at")
    assert path.read_bytes() == original_bytes
    assert "Position" not in sample
