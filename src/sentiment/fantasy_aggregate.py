"""Aggregate league-wide fantasy channel mentions into player-week features."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from src.core.schedule_utils import map_publish_time_to_league_week
from src.integrations.youtube import TRANSCRIPTS_DIR, load_raw_content_cache
from src.sentiment.aggregate import FEATURE_COLUMNS, SNIPPET_MAX, load_sentiment_features, save_sentiment_features
from src.sentiment.extract import extract_mentions
from src.sentiment.fantasy_channels import FANTASY_NETWORK_COLUMNS, LEAGUE_TEAM_CODE, load_fantasy_channels, promoted_fantasy_channel_ids
from src.sentiment.media_context import resolve_publish_week_for_features
from src.sentiment.player_link import link_mention_league, load_season_roster, roster_display_names_all


def _content_id(row: pd.Series) -> str:
    return str(row.get("content_id") or row.get("video_id") or "")


def _video_text(row: pd.Series, transcripts_dir: Path | None = None) -> str:
    transcripts_dir = transcripts_dir or TRANSCRIPTS_DIR
    parts = [str(row.get("title") or ""), str(row.get("description") or "")]
    video_id = _content_id(row)
    transcript_path = transcripts_dir / f"{video_id}.json"
    if video_id and transcript_path.exists():
        try:
            payload = json.loads(transcript_path.read_text(encoding="utf-8"))
            if not payload.get("transcript_missing") and payload.get("text"):
                parts.append(str(payload["text"])[:8000])
        except json.JSONDecodeError:
            pass
    return "\n".join(p for p in parts if p)


def _process_league_videos(
    videos: pd.DataFrame,
    season: int,
    roster: pd.DataFrame,
    *,
    channel_id: str | None = None,
) -> pd.DataFrame:
    rows: list[dict] = []
    if channel_id:
        videos = videos[videos["channel_id"].astype(str) == channel_id]
    names = roster_display_names_all(roster)

    for _, video in videos.iterrows():
        published_at = pd.Timestamp(video.get("published_at"))
        mapped = map_publish_time_to_league_week(published_at, season)
        # SCORE-34: unmapped recent preseason videos land in outlook week=0.
        week = resolve_publish_week_for_features(
            published_at,
            season,
            mapped_week=mapped,
        )
        if week is None:
            continue

        text = _video_text(video)
        weight = float(video.get("channel_weight") or 1.0)
        channel_label = str(video.get("channel_label") or "")
        network = str(video.get("network") or "")

        for mention in extract_mentions(text, names):
            linked = link_mention_league(mention.player_name, roster)
            if linked is None:
                continue
            rows.append(
                {
                    "player_id": linked["player_id"],
                    "season": season,
                    "week": week,
                    "team": linked["team"],
                    "position": linked["position"],
                    "weight": weight,
                    "network": network,
                    "sentiment_score": mention.sentiment_score,
                    "injury_flag": float(mention.injury_flag),
                    "role_hype_flag": float(mention.role_hype_flag),
                    "snippet": mention.sentence,
                    "channel_label": channel_label,
                }
            )

    base_cols = ["player_id", "season", "week", "team", "position", *FEATURE_COLUMNS]
    if not rows:
        return pd.DataFrame(columns=base_cols)

    detail = pd.DataFrame(rows)
    grouped_rows: list[dict] = []
    for (player_id, season_val, week_val), group in detail.groupby(["player_id", "season", "week"]):
        weights = group["weight"].clip(lower=0.01)
        total_w = float(weights.sum()) or 1.0
        best_idx = (group["sentiment_score"].abs() * weights).idxmax()
        network_weights = {
            net: float(weights[group["network"] == net].sum())
            for net in group["network"].unique()
        }
        row = {
            "player_id": player_id,
            "season": int(season_val),
            "week": int(week_val),
            "team": group["team"].iloc[0],
            "position": group["position"].iloc[0],
            "yt_mention_count": float(weights.sum()),
            "yt_sentiment_score": float((group["sentiment_score"] * weights).sum() / total_w),
            "yt_injury_flag": float(group["injury_flag"].max()),
            "yt_role_hype_flag": float(group["role_hype_flag"].max()),
            "yt_channel_count": float(group["channel_label"].nunique()),
            "yt_top_snippet": str(group.loc[best_idx, "snippet"])[:SNIPPET_MAX],
            "yt_locked_on_mentions": 0.0,
            "yt_sb_nation_mentions": 0.0,
            "narrative_source_count": float(group["network"].nunique()),
            "yt_data_coverage": 1.0,
        }
        for net, col in FANTASY_NETWORK_COLUMNS.items():
            promoted = {c.network for c in load_fantasy_channels() if c.promote_to_features}
            if net in promoted:
                row[col] = network_weights.get(net, 0.0)
            else:
                row[col] = 0.0
        grouped_rows.append(row)

    agg = pd.DataFrame(grouped_rows)
    agg = agg.sort_values(["player_id", "season", "week"])
    agg["yt_mention_delta"] = agg.groupby("player_id")["yt_mention_count"].diff().fillna(agg["yt_mention_count"])
    return agg


def build_fantasy_channel_features(
    season: int,
    channel_id: str,
    *,
    videos: pd.DataFrame | None = None,
    roster: pd.DataFrame | None = None,
) -> pd.DataFrame:
    videos = videos if videos is not None else load_raw_content_cache()
    if videos.empty:
        return pd.DataFrame(columns=["player_id", "season", "week", "team", "position", *FEATURE_COLUMNS])

    videos = videos.copy()
    if "video_id" not in videos.columns and "content_id" in videos.columns:
        videos["video_id"] = videos["content_id"]
    videos["published_at"] = pd.to_datetime(videos["published_at"], utc=True)
    videos = videos[
        (videos["team"].astype(str).str.upper() == LEAGUE_TEAM_CODE)
        & (videos["channel_id"].astype(str) == channel_id)
    ]
    videos = videos[videos["published_at"].dt.year >= season - 1]

    roster = roster if roster is not None else load_season_roster(season)
    return _process_league_videos(videos, season, roster, channel_id=channel_id)


def promoted_fantasy_channel_ids() -> set[str]:
    return {c.channel_id for c in load_fantasy_channels() if c.promote_to_features and not c.needs_resolution()}


def build_all_fantasy_features(
    season: int,
    *,
    videos: pd.DataFrame | None = None,
    roster: pd.DataFrame | None = None,
    promoted_only: bool = True,
) -> pd.DataFrame:
    videos = videos if videos is not None else load_raw_content_cache()
    if videos.empty:
        return pd.DataFrame(columns=["player_id", "season", "week", "team", "position", *FEATURE_COLUMNS])

    videos = videos.copy()
    if "video_id" not in videos.columns and "content_id" in videos.columns:
        videos["video_id"] = videos["content_id"]
    videos["published_at"] = pd.to_datetime(videos["published_at"], utc=True)
    videos = videos[videos["team"].astype(str).str.upper() == LEAGUE_TEAM_CODE]
    if promoted_only:
        promoted = promoted_fantasy_channel_ids()
        if promoted:
            videos = videos[videos["channel_id"].astype(str).isin(promoted)]
    videos = videos[videos["published_at"].dt.year >= season - 1]

    roster = roster if roster is not None else load_season_roster(season)
    return _process_league_videos(videos, season, roster)


def merge_fantasy_into_sentiment_features(season: int) -> pd.DataFrame:
    """Merge promoted fantasy channel columns into the main sentiment parquet for a season."""
    fantasy = build_all_fantasy_features(season)
    existing = load_sentiment_features()
    if fantasy.empty:
        return existing

    merge_keys = ["player_id", "season", "week"]
    fantasy_cols = [c for c in FANTASY_NETWORK_COLUMNS.values() if c in fantasy.columns]
    payload = fantasy[merge_keys + fantasy_cols].drop_duplicates(subset=merge_keys)

    if existing.empty:
        save_sentiment_features(fantasy)
        return fantasy

    other = existing[existing["season"] != season]
    season_rows = existing[existing["season"] == season].copy()
    for col in fantasy_cols:
        if col in season_rows.columns:
            season_rows = season_rows.drop(columns=[col])
    season_rows = season_rows.merge(payload, on=merge_keys, how="left")
    promoted_networks = {c.network for c in load_fantasy_channels() if c.promote_to_features}
    for net, col in FANTASY_NETWORK_COLUMNS.items():
        if col not in season_rows.columns:
            season_rows[col] = 0.0
        elif net not in promoted_networks:
            season_rows[col] = 0.0
        else:
            season_rows[col] = season_rows[col].fillna(0.0)

    known = season_rows[merge_keys].drop_duplicates()
    extra = fantasy.merge(known, on=merge_keys, how="left", indicator=True)
    extra = extra[extra["_merge"] == "left_only"].drop(columns=["_merge"])

    out = pd.concat([other, season_rows, extra], ignore_index=True)
    save_sentiment_features(out)
    return out
