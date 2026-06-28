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
            "Player": ["Test Player"],
            "Season": [season],
            "From Week": [week],
            "Weeks Remaining": [8],
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

    sample = pd.DataFrame({"Player": ["A"], "Season": [season]})
    ros_cache.save_ros_artifact("qb", season, week, True, sample)

    _, meta_path = ros_cache._artifact_paths("qb", season, week, True)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["fingerprint"] = "stale-fingerprint"
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    recomputed = pd.DataFrame({"Player": ["B"], "Season": [season]})
    with patch.object(ros_cache, "predict_rest_of_season", return_value=recomputed):
        ros_cache.invalidate_ros_cache()
        loaded = ros_cache.load_ros_prediction("qb", season=season, week=week)

    assert loaded.iloc[0]["Player"] == "B"
