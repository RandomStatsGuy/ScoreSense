"""Tests for readout source reconstruction from feature rows."""

import pandas as pd

from src.sentiment.readout import _sources_from_feature_row


def test_sources_from_feature_row_includes_fantasy_and_team():
    lookup = {
        ("BUF", "locked_on"): "Locked On Bills",
        ("NFL", "fantasy_footballers"): "The Fantasy Footballers",
    }
    row = pd.Series(
        {
            "yt_mention_count": 3.0,
            "yt_locked_on_mentions": 1.0,
            "yt_sb_nation_mentions": 0.0,
            "yt_fantasy_footballers_mentions": 2.0,
        }
    )
    sources = _sources_from_feature_row(row, "BUF", lookup)
    labels = {s["label"] for s in sources}
    assert "Locked On Bills" in labels
    assert "The Fantasy Footballers" in labels
