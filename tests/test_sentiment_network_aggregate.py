"""Tests for multi-network sentiment aggregation."""

from datetime import datetime, timezone

import pandas as pd

from src.sentiment.aggregate import build_sentiment_features


def test_build_sentiment_features_multi_network():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0031234",
                "team": "KC",
                "position": "QB",
                "name_key": "patrick mahomes",
                "display_name": "Patrick Mahomes",
            }
        ]
    )
    videos = pd.DataFrame(
        [
            {
                "content_id": "vid1",
                "content_type": "youtube_video",
                "channel_id": "UC_LO",
                "team": "KC",
                "network": "locked_on",
                "tier": "reporting",
                "channel_weight": 1.0,
                "channel_label": "Locked On Chiefs",
                "published_at": pd.Timestamp("2025-09-10T18:00:00Z"),
                "title": "Chiefs practice",
                "description": "Patrick Mahomes looked sharp.",
            },
            {
                "content_id": "vid2",
                "content_type": "youtube_video",
                "channel_id": "UC_SBN",
                "team": "KC",
                "network": "sb_nation",
                "tier": "fan_analysis",
                "channel_weight": 0.3025,
                "channel_label": "Arrowhead Pride",
                "published_at": pd.Timestamp("2025-09-11T18:00:00Z"),
                "title": "Chiefs fan take",
                "description": "Patrick Mahomes is the MVP favorite.",
            },
        ]
    )
    features = build_sentiment_features(2025, videos=videos, roster=roster)
    assert not features.empty
    row = features.iloc[0]
    assert row["player_id"] == "00-0031234"
    assert row["yt_locked_on_mentions"] >= 1.0
    assert row["yt_sb_nation_mentions"] >= 0.3
    assert row["narrative_source_count"] == 2.0
