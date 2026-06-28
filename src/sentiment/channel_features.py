"""Build player-week sentiment features for a single YouTube channel."""

from __future__ import annotations

import pandas as pd

from src.integrations.youtube import load_raw_content_cache
from src.sentiment.aggregate import FEATURE_COLUMNS, _process_videos
from src.sentiment.fantasy_aggregate import build_fantasy_channel_features
from src.sentiment.fantasy_channels import LEAGUE_TEAM_CODE
from src.sentiment.player_link import load_season_roster

SINGLE_CHANNEL_COLUMNS = (
    "player_id",
    "season",
    "week",
    "team",
    "position",
    "yt_mention_count",
    "yt_mention_delta",
    "yt_sentiment_score",
    "yt_injury_flag",
    "yt_role_hype_flag",
)


def build_single_channel_features(
    season: int,
    channel_id: str,
    *,
    videos: pd.DataFrame | None = None,
    roster: pd.DataFrame | None = None,
) -> pd.DataFrame:
    videos = videos if videos is not None else load_raw_content_cache()
    if videos.empty:
        return _empty()

    videos = videos.copy()
    if "video_id" not in videos.columns and "content_id" in videos.columns:
        videos["video_id"] = videos["content_id"]
    scoped = videos[videos["channel_id"].astype(str) == str(channel_id)].copy()
    if scoped.empty:
        return _empty()

    scoped["published_at"] = pd.to_datetime(scoped["published_at"], utc=True)
    scoped = scoped[scoped["published_at"].dt.year >= season - 1]
    roster = roster if roster is not None else load_season_roster(season)

    team = str(scoped["team"].iloc[0]).upper()
    if team == LEAGUE_TEAM_CODE:
        features = build_fantasy_channel_features(season, channel_id, videos=scoped, roster=roster)
    else:
        features = _process_videos(scoped, season, roster)

    keep = [c for c in SINGLE_CHANNEL_COLUMNS if c in features.columns]
    return features[keep] if not features.empty else _empty()


def _empty() -> pd.DataFrame:
    return pd.DataFrame(columns=list(SINGLE_CHANNEL_COLUMNS))


def list_ingested_channels(videos: pd.DataFrame | None = None) -> pd.DataFrame:
    videos = videos if videos is not None else load_raw_content_cache()
    if videos.empty:
        return pd.DataFrame(columns=["channel_id", "channel_label", "network", "team", "video_count"])
    grouped = (
        videos.groupby(["channel_id", "channel_label", "network", "team"], dropna=False)
        .size()
        .reset_index(name="video_count")
        .sort_values("video_count", ascending=False)
    )
    grouped["team"] = grouped["team"].astype(str).str.upper()
    return grouped.reset_index(drop=True)
