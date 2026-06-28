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
