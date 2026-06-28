"""Tests for sentiment aggregation."""

from datetime import datetime, timezone

import pandas as pd

from src.sentiment.aggregate import build_sentiment_features


def test_build_sentiment_features_from_videos():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0031234",
                "team": "LV",
                "position": "QB",
                "name_key": "aidan oconnell",
                "display_name": "Aidan O'Connell",
            }
        ]
    )
    videos = pd.DataFrame(
        [
            {
                "video_id": "vid1",
                "channel_id": "UC_TEST",
                "team": "LV",
                "tier": "reporting",
                "channel_weight": 1.0,
                "channel_label": "Raiders Test Channel",
                "published_at": pd.Timestamp("2025-09-10T18:00:00Z"),
                "title": "Raiders practice report",
                "description": "Aidan O'Connell was limited in practice.",
            }
        ]
    )
    features = build_sentiment_features(2025, videos=videos, roster=roster)
    assert not features.empty
    row = features.iloc[0]
    assert row["player_id"] == "00-0031234"
    assert row["yt_mention_count"] >= 1.0
    assert row["yt_injury_flag"] == 1.0
    assert "yt_top_sentence" in features.columns
    assert "yt_chapter_notes" in features.columns


def test_chapter_notes_require_timestamps():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0031234",
                "team": "LV",
                "position": "QB",
                "name_key": "aidan oconnell",
                "display_name": "Aidan O'Connell",
            }
        ]
    )
    videos = pd.DataFrame(
        [
            {
                "video_id": "vid2",
                "channel_id": "UC_TEST",
                "team": "LV",
                "tier": "reporting",
                "channel_weight": 1.0,
                "channel_label": "Raiders Test Channel",
                "published_at": pd.Timestamp("2025-09-10T18:00:00Z"),
                "title": "CLICKBAIT TITLE ONLY",
                "description": "Aidan O'Connell breakout hype with no timestamps in description.",
            },
            {
                "video_id": "vid3",
                "channel_id": "UC_TEST",
                "team": "LV",
                "tier": "reporting",
                "channel_weight": 1.0,
                "channel_label": "Raiders Test Channel",
                "published_at": pd.Timestamp("2025-09-11T18:00:00Z"),
                "title": "Practice report",
                "description": "00:00 Injury update 04:30 Aidan O'Connell usage",
            },
        ]
    )
    features = build_sentiment_features(2025, videos=videos, roster=roster)
    row = features.sort_values("week").iloc[-1]
    assert not str(row.get("yt_chapter_notes") or "").startswith("CLICKBAIT")
    assert "Injury update" in str(row.get("yt_chapter_notes") or "") or row["yt_chapter_notes"] == ""
