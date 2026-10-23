"""Weekly prediction artifact cache — fingerprint hits vs forced rebuild."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest

from src.projections import weekly_cache as wc


@pytest.fixture(autouse=True)
def isolate_movement_artifacts(monkeypatch, tmp_path):
    monkeypatch.setattr("src.projections.projection_movement.WEEKLY_PROJECTION_CHANGES_DIR", tmp_path / "movement")


def _sample_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "player_id": ["00-0000001"],
            "Player": ["Test QB"],
            "Team": ["KC"],
            "Projected Points": [18.0],
            "Season": [2026],
            "Week": [1],
        }
    )


def test_force_reload_updates_built_at(monkeypatch, tmp_path):
    weekly_dir = tmp_path / "weekly"
    weekly_dir.mkdir()
    monkeypatch.setattr(wc, "WEEKLY_PREDICTIONS_DIR", weekly_dir)
    monkeypatch.setattr(wc, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(wc, "MODEL_DIR", tmp_path)
    wc.invalidate_weekly_cache()

    calls = {"n": 0}

    def fake_predict(*_args, **_kwargs):
        calls["n"] += 1
        return _sample_frame()

    with patch.object(wc, "predict_upcoming_week", side_effect=fake_predict):
        first = wc.load_weekly_prediction("qb", 2026, 1, apply_injury_adjustments=True)
        first_built = first.attrs.get("built_at")
        assert first_built
        assert calls["n"] == 1

        cached = wc.load_weekly_prediction("qb", 2026, 1, apply_injury_adjustments=True)
        assert calls["n"] == 1
        assert cached.attrs.get("built_at") == first_built

        forced = wc.load_weekly_prediction(
            "qb", 2026, 1, apply_injury_adjustments=True, force=True
        )
        assert calls["n"] == 2
        assert forced.attrs.get("built_at")
        assert forced.attrs.get("built_at") != first_built



def test_weekly_fingerprint_includes_pool_policy(monkeypatch, tmp_path):
    monkeypatch.setattr(wc, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(wc, "MODEL_DIR", tmp_path)
    fp = wc.weekly_fingerprint()
    assert len(fp) == 16
    assert wc.WEEKLY_POOL_POLICY == "v5-opportunity-identity"


def test_empty_refresh_preserves_previous_artifact(monkeypatch, tmp_path):
    monkeypatch.setattr(wc, "WEEKLY_PREDICTIONS_DIR", tmp_path)
    monkeypatch.setattr(wc, "weekly_fingerprint", lambda: "test")
    frame = _sample_frame().assign(Week=4)
    wc.save_weekly_artifact("qb", 2026, 4, True, frame)
    path, meta = wc._artifact_paths("qb", 2026, 4, True)
    before = (path.read_bytes(), meta.read_bytes())
    monkeypatch.setattr(wc, "predict_upcoming_week", lambda *a, **k: pd.DataFrame())
    with pytest.raises(ValueError, match="artifact_empty"):
        wc.load_weekly_prediction("qb", 2026, 4, force=True)
    assert (path.read_bytes(), meta.read_bytes()) == before
