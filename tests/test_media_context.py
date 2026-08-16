"""SCORE-28 media_context states — no silent historical fallback."""

from __future__ import annotations

import pandas as pd

from src.sentiment.media_context import (
    MEDIA_STATE_CURRENT,
    MEDIA_STATE_HISTORICAL_AVAILABLE,
    MEDIA_STATE_NONE,
    apply_historical_opt_in,
    resolve_media_week,
    strip_historical_content,
)


def _features() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "player_id": "p1",
                "season": 2025,
                "week": 18,
                "position": "WR",
                "yt_mention_count": 4.0,
            },
            {
                "player_id": "p2",
                "season": 2026,
                "week": 1,
                "position": "WR",
                "yt_mention_count": 2.0,
            },
        ]
    )


def test_resolve_media_week_current():
    resolved = resolve_media_week(
        _features(),
        season=2026,
        week=1,
        has_coverage=lambda df: df["yt_mention_count"].fillna(0) > 0,
    )
    assert resolved.state == MEDIA_STATE_CURRENT
    assert resolved.serve_season == 2026
    assert resolved.serve_week == 1
    assert resolved.context_fallback is False


def test_resolve_media_week_historical_available_default_empty():
    resolved = resolve_media_week(
        _features(),
        season=2026,
        week=2,
        has_coverage=lambda df: df["yt_mention_count"].fillna(0) > 0,
    )
    assert resolved.state == MEDIA_STATE_HISTORICAL_AVAILABLE
    assert resolved.serve_season == 2026
    assert resolved.serve_week == 2
    assert resolved.historical_season == 2026
    assert resolved.historical_week == 1
    assert resolved.serving_historical is False
    assert resolved.context_fallback is False


def test_resolve_media_week_include_historical():
    resolved = resolve_media_week(
        _features(),
        season=2026,
        week=2,
        has_coverage=lambda df: df["yt_mention_count"].fillna(0) > 0,
        include_historical=True,
    )
    assert resolved.state == MEDIA_STATE_HISTORICAL_AVAILABLE
    assert resolved.serve_season == 2026
    assert resolved.serve_week == 1
    assert resolved.serving_historical is True
    assert resolved.context_fallback is True


def test_resolve_media_week_none_for_far_future():
    resolved = resolve_media_week(
        _features(),
        season=2099,
        week=1,
        has_coverage=lambda df: df["yt_mention_count"].fillna(0) > 0,
    )
    assert resolved.state == MEDIA_STATE_NONE
    assert resolved.historical_season is None


def test_strip_and_apply_historical_opt_in():
    stored = {
        "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
        "signal": None,
        "source_count": 0,
        "summary": None,
        "excerpt": None,
        "sources": [],
        "updated_at": None,
        "historical": {
            "season": 2025,
            "week": 18,
            "signal": "mentioned",
            "source_count": 3,
            "summary": "Older commentary",
            "excerpt": "Older excerpt",
            "sources": [{"label": "Old Show"}],
            "updated_at": "2025-01-01T00:00:00+00:00",
        },
        "affects_projection": False,
    }
    stripped = strip_historical_content(stored)
    assert stripped["state"] == MEDIA_STATE_HISTORICAL_AVAILABLE
    assert stripped["summary"] is None
    assert stripped["excerpt"] is None
    assert stripped["sources"] == []
    assert stripped["signal"] is None
    assert stripped["historical"] == {"season": 2025, "week": 18}

    opted = apply_historical_opt_in(stored)
    assert opted["state"] == MEDIA_STATE_HISTORICAL_AVAILABLE
    assert opted["summary"] == "Older commentary"
    assert opted["excerpt"] == "Older excerpt"
    assert opted["sources"] == [{"label": "Old Show"}]
    assert opted["signal"] == "mentioned"
    assert opted["source_count"] == 3
    assert opted["historical"] == {"season": 2025, "week": 18}
