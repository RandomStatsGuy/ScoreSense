"""Tests for raw_content cache migration."""

import pandas as pd

from src.integrations.youtube import (
    RAW_CONTENT_PATH,
    RAW_VIDEOS_PATH,
    load_raw_content_cache,
    merge_raw_content,
    save_raw_content_cache,
)


def test_load_raw_content_includes_network(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    monkeypatch.setattr("src.integrations.youtube.SENTIMENT_CACHE_DIR", cache_dir)
    monkeypatch.setattr("src.integrations.youtube.RAW_CONTENT_PATH", cache_dir / "raw_content.parquet")
    monkeypatch.setattr("src.integrations.youtube.RAW_VIDEOS_PATH", cache_dir / "raw_videos.parquet")

    merge_raw_content(
        [
            {
                "content_id": "abc123",
                "content_type": "youtube_video",
                "channel_id": "UC_TEST",
                "team": "KC",
                "network": "locked_on",
                "tier": "reporting",
                "channel_weight": 1.0,
                "channel_label": "Locked On Chiefs",
                "published_at": pd.Timestamp("2025-09-10T18:00:00Z"),
                "title": "Test",
                "description": "",
                "duration_sec": 100,
                "fetched_at": pd.Timestamp("2025-09-10T19:00:00Z"),
            }
        ]
    )
    df = load_raw_content_cache()
    assert not df.empty
    assert df.iloc[0]["network"] == "locked_on"
    assert df.iloc[0]["content_type"] == "youtube_video"


def test_legacy_raw_videos_migrates(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    legacy_path = cache_dir / "raw_videos.parquet"
    content_path = cache_dir / "raw_content.parquet"
    monkeypatch.setattr("src.integrations.youtube.SENTIMENT_CACHE_DIR", cache_dir)
    monkeypatch.setattr("src.integrations.youtube.RAW_CONTENT_PATH", content_path)
    monkeypatch.setattr("src.integrations.youtube.RAW_VIDEOS_PATH", legacy_path)

    legacy = pd.DataFrame(
        [
            {
                "video_id": "legacy1",
                "channel_id": "UC_LEGACY",
                "team": "PHI",
                "tier": "reporting",
                "channel_weight": 1.0,
                "channel_label": "Locked On Eagles",
                "published_at": pd.Timestamp("2025-09-10T18:00:00Z"),
                "title": "Eagles",
                "description": "",
                "duration_sec": 60,
                "fetched_at": pd.Timestamp("2025-09-10T19:00:00Z"),
            }
        ]
    )
    legacy.to_parquet(legacy_path, index=False)

    df = load_raw_content_cache()
    assert not df.empty
    assert df.iloc[0]["content_id"] == "legacy1"
    assert content_path.exists()
