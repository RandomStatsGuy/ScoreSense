"""Weekly prediction artifact cache — fingerprint hits vs forced rebuild."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd

from src.projections import weekly_cache as wc


def _sample_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
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
    assert wc.WEEKLY_POOL_POLICY == "v3-unlisted-backup"
