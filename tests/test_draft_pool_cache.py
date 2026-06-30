"""Tests for materialized draft pool cache."""

from __future__ import annotations

import json
from unittest.mock import patch

import pandas as pd
import pytest

from src.draft_hub import draft_pool_cache


@pytest.fixture(autouse=True)
def _clear_pool_cache():
    draft_pool_cache.invalidate_pool_cache()
    yield
    draft_pool_cache.invalidate_pool_cache()


def test_pool_fingerprint_stable(monkeypatch, tmp_path):
    feat = tmp_path / "qb_mlready.parquet"
    feat.write_bytes(b"x")
    monkeypatch.setattr(draft_pool_cache, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(draft_pool_cache, "MODEL_DIR", tmp_path)
    fp1 = draft_pool_cache.pool_fingerprint()
    fp2 = draft_pool_cache.pool_fingerprint()
    assert fp1 == fp2
    assert len(fp1) == 16


def test_load_draft_pool_uses_artifact(monkeypatch, tmp_path):
    season = 2026
    pool_dir = tmp_path / "pool"
    monkeypatch.setattr(draft_pool_cache, "DRAFT_POOL_DIR", pool_dir)
    monkeypatch.setattr(draft_pool_cache, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(draft_pool_cache, "MODEL_DIR", tmp_path)

    sample = pd.DataFrame(
        {
            "player_id": ["p1"],
            "Player": ["Test Player"],
            "Team": ["KC"],
            "Position": ["QB"],
            "Season Proj": [300.0],
        }
    )
    draft_pool_cache.save_pool_artifact(season, sample)

    with patch.object(draft_pool_cache, "_compute_pool") as compute:
        loaded = draft_pool_cache.load_draft_pool(season)
        compute.assert_not_called()

    assert len(loaded) == 1
    assert loaded.iloc[0]["Player"] == "Test Player"


def test_artifact_invalidates_on_fingerprint_change(monkeypatch, tmp_path):
    season = 2026
    pool_dir = tmp_path / "pool"
    monkeypatch.setattr(draft_pool_cache, "DRAFT_POOL_DIR", pool_dir)
    monkeypatch.setattr(draft_pool_cache, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(draft_pool_cache, "MODEL_DIR", tmp_path)

    sample = pd.DataFrame({"player_id": ["p1"], "Player": ["A"], "Position": ["QB"]})
    draft_pool_cache.save_pool_artifact(season, sample)

    _, meta_path = draft_pool_cache._artifact_paths(season)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["fingerprint"] = "stale-fingerprint"
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    recomputed = pd.DataFrame({"player_id": ["p2"], "Player": ["B"], "Position": ["RB"]})
    with patch.object(draft_pool_cache, "_compute_pool", return_value=(recomputed, {})):
        draft_pool_cache.invalidate_pool_cache(season)
        loaded = draft_pool_cache.load_draft_pool(season)

    assert loaded.iloc[0]["Player"] == "B"


def test_compute_pool_preserves_te_position(monkeypatch):
    season = 2026

    def fake_predict(pos, season=season):
        if pos == "qb":
            return pd.DataFrame({"player_id": ["q1"], "Player": ["QB1"], "Season Proj": [400.0]})
        if pos == "rb":
            return pd.DataFrame({"player_id": ["r1"], "Player": ["RB1"], "Season Proj": [250.0]})
        if pos == "wr":
            return pd.DataFrame(
                {
                    "player_id": ["00-0036970", "w1"],
                    "Player": ["Kyle Pitts", "Alpha WR"],
                    "position": ["TE", "WR"],
                    "Season Proj": [180.0, 300.0],
                }
            )
        return pd.DataFrame()

    with patch("src.draft_hub.draft_pool_cache.predict_draft_season", side_effect=fake_predict):
        pool, _ = draft_pool_cache._compute_pool(season)

    wr_te = pool[pool["player_id"].isin(["00-0036970", "w1"])]
    assert set(wr_te["Position"].tolist()) == {"TE", "WR"}
