"""Tests for bulk sentiment source indexing."""

import pandas as pd

from src.sentiment.aggregate import build_sentiment_sources_index


def test_build_sentiment_sources_index_team_and_fantasy():
    roster = pd.DataFrame(
        [
            {
                "player_id": "p1",
                "team": "BUF",
                "position": "QB",
                "name_key": "josh allen",
                "display_name": "Josh Allen",
            }
        ]
    )
    videos = pd.DataFrame(
        [
            {
                "content_id": "v1",
                "team": "BUF",
                "network": "locked_on",
                "channel_label": "Locked On Bills",
                "published_at": "2025-09-10T12:00:00Z",
                "title": "Josh Allen looked sharp in practice",
                "description": "",
            },
            {
                "content_id": "v2",
                "team": "NFL",
                "network": "fantasy_footballers",
                "channel_label": "The Fantasy Footballers",
                "published_at": "2025-09-11T12:00:00Z",
                "title": "Josh Allen is a smash this week",
                "description": "",
            },
        ]
    )
    index = build_sentiment_sources_index(2025, 2, videos=videos, roster=roster)
    assert "p1" in index
    labels = {s["label"] for s in index["p1"]}
    assert "Locked On Bills" in labels
    assert "The Fantasy Footballers" in labels
