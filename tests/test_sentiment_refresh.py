"""Tests for sentiment refresh job."""

from unittest.mock import patch

import pandas as pd

from src.jobs.sentiment_refresh import run_sentiment_refresh


@patch("src.jobs.sentiment_refresh.rebuild_sentiment_features")
@patch("src.jobs.sentiment_refresh.load_channels")
def test_sentiment_refresh_skips_ingest_without_api_key(mock_channels, mock_rebuild, monkeypatch):
    mock_channels.return_value = []
    mock_rebuild.return_value = pd.DataFrame()
    monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)
    status = run_sentiment_refresh(season=2025, week=1, skip_ingest=True)
    assert status["season"] == 2025
    assert status["ingest"]["status"] == "skipped"
    mock_rebuild.assert_called_once_with(2025)
