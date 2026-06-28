"""Tests for offseason / upcoming-season projection context."""

from src.core.schedule_utils import week_matchups
from src.projections.projection_meta import get_projection_meta
from src.projections.predict import predict_upcoming_week


def test_projection_meta_includes_upcoming_season():
    meta = get_projection_meta("qb")
    seasons = meta["seasons"]
    assert max(seasons) >= 2026 or meta.get("upcoming_season", 0) >= 2026
    if meta.get("is_offseason"):
        assert "2026" in meta["weeks_by_season"] or 2026 in seasons


def test_preseason_weekly_uses_schedule_opponent():
    preds = predict_upcoming_week("qb", season=2026, week=1, apply_injury_adjustments=False)
    if preds.empty:
        return
    matchups = week_matchups(2026, 1)
    sample = preds[preds["Player"] == "Lamar Jackson"]
    if sample.empty:
        return
    assert sample.iloc[0]["Opponent"] == matchups.get("BAL", sample.iloc[0]["Opponent"])
