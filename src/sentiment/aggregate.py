"""Aggregate video-level mentions into player-week sentiment features."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

from src.config import SENTIMENT_FEATURES_PATH, write_parquet
from src.core.schedule_utils import map_publish_time_to_league_week, map_publish_time_to_week
from src.integrations.youtube import TRANSCRIPTS_DIR, load_raw_content_cache
from src.sentiment.channels import load_channels
from src.sentiment.beat_digest import is_usable_snippet, parse_chapter_titles
from src.sentiment.extract import extract_mentions
from src.sentiment.fantasy_channels import FANTASY_NETWORK_COLUMNS, LEAGUE_TEAM_CODE
from src.sentiment.player_link import (
    link_mention,
    link_mention_league,
    load_season_roster,
    roster_display_names,
    roster_display_names_all,
)

FEATURE_COLUMNS = (
    "yt_mention_count",
    "yt_mention_delta",
    "yt_sentiment_score",
    "yt_injury_flag",
    "yt_role_hype_flag",
    "yt_channel_count",
    "yt_top_snippet",
    "yt_top_sentence",
    "yt_chapter_notes",
    "yt_data_coverage",
    "yt_locked_on_mentions",
    "yt_sb_nation_mentions",
    *FANTASY_NETWORK_COLUMNS.values(),
    "narrative_source_count",
)

SNIPPET_MAX = 200
CHAPTER_NOTES_MAX = 500
_TIMESTAMP_RE = re.compile(r"(?:\d{1,2}:){1,2}\d{2}")


def _pick_top_sentence(group: pd.DataFrame, weights: pd.Series) -> str:
    ranked = group.copy()
    ranked["_rank"] = ranked["sentiment_score"].abs() * weights
    for idx in ranked.sort_values("_rank", ascending=False).index:
        snippet = str(ranked.loc[idx, "snippet"])[:SNIPPET_MAX]
        if is_usable_snippet(snippet):
            return snippet
    best_idx = ranked["_rank"].idxmax()
    return str(ranked.loc[best_idx, "snippet"])[:SNIPPET_MAX]


def _chapter_notes_from_description(description: str) -> str:
    text = str(description or "")
    if not _TIMESTAMP_RE.search(text):
        return ""
    topics = parse_chapter_titles(text)
    if not topics:
        return ""
    return " | ".join(topics[:5])[:CHAPTER_NOTES_MAX]


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


def _process_videos(
    videos: pd.DataFrame,
    season: int,
    roster: pd.DataFrame,
) -> pd.DataFrame:
    rows: list[dict] = []
    active_channels = {c.team for c in load_channels(active_only=True)}

    for _, video in videos.iterrows():
        team = str(video.get("team") or "").upper()
        published_at = pd.Timestamp(video.get("published_at"))
        week = map_publish_time_to_week(team, published_at, season)
        if week is None:
            continue

        text = _video_text(video)
        description = str(video.get("description") or "")
        chapter_notes = _chapter_notes_from_description(description)
        names = roster_display_names(roster, team)
        weight = float(video.get("channel_weight") or 1.0)
        channel_label = str(video.get("channel_label") or "")
        network = str(video.get("network") or "locked_on")

        for mention in extract_mentions(text, names):
            linked = link_mention(mention.player_name, team, roster)
            if linked is None:
                continue
            rows.append(
                {
                    "player_id": linked["player_id"],
                    "season": season,
                    "week": week,
                    "team": team,
                    "position": linked["position"],
                    "weight": weight,
                    "network": network,
                    "sentiment_score": mention.sentiment_score,
                    "injury_flag": float(mention.injury_flag),
                    "role_hype_flag": float(mention.role_hype_flag),
                    "snippet": mention.sentence,
                    "chapter_notes": chapter_notes,
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
        locked_on_w = float(weights[group["network"] == "locked_on"].sum())
        sb_nation_w = float(weights[group["network"] == "sb_nation"].sum())
        chapter_parts: list[str] = []
        for notes in group["chapter_notes"].astype(str):
            if not notes or notes == "nan":
                continue
            chapter_parts.extend(n.strip() for n in notes.split(" | ") if n.strip())
        chapter_deduped: list[str] = []
        seen_ch: set[str] = set()
        for part in chapter_parts:
            key = part.lower()
            if key in seen_ch:
                continue
            seen_ch.add(key)
            chapter_deduped.append(part)
        top_sentence = _pick_top_sentence(group, weights)
        grouped_rows.append(
            {
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
                "yt_top_sentence": top_sentence,
                "yt_top_snippet": top_sentence,
                "yt_chapter_notes": " | ".join(chapter_deduped[:5])[:CHAPTER_NOTES_MAX],
                "yt_locked_on_mentions": locked_on_w,
                "yt_sb_nation_mentions": sb_nation_w,
                "narrative_source_count": float(group["network"].nunique()),
            }
        )

    agg = pd.DataFrame(grouped_rows)
    agg = agg.sort_values(["player_id", "season", "week"])
    agg["yt_mention_delta"] = agg.groupby("player_id")["yt_mention_count"].diff().fillna(agg["yt_mention_count"])

    teams_with_video = set(videos["team"].astype(str).str.upper()) if not videos.empty else set()
    coverage = len(teams_with_video & active_channels) / max(len(active_channels), 1)
    agg["yt_data_coverage"] = coverage
    return agg


def build_sentiment_features(
    season: int,
    *,
    videos: pd.DataFrame | None = None,
    roster: pd.DataFrame | None = None,
) -> pd.DataFrame:
    videos = videos if videos is not None else load_raw_content_cache()
    if videos.empty:
        return pd.DataFrame(
            columns=["player_id", "season", "week", "team", "position", *FEATURE_COLUMNS]
        )

    videos = videos.copy()
    if "video_id" not in videos.columns and "content_id" in videos.columns:
        videos["video_id"] = videos["content_id"]
    videos["published_at"] = pd.to_datetime(videos["published_at"], utc=True)
    videos = videos[videos["published_at"].dt.year >= season - 1]

    roster = roster if roster is not None else load_season_roster(season)
    features = _process_videos(videos, season, roster)
    return features


def save_sentiment_features(df: pd.DataFrame, path: Path | None = None) -> Path:
    path = path or SENTIMENT_FEATURES_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    write_parquet(df, path)
    return path


def load_sentiment_features(path: Path | None = None) -> pd.DataFrame:
    path = path or SENTIMENT_FEATURES_PATH
    if not path.exists():
        return pd.DataFrame(
            columns=["player_id", "season", "week", "team", "position", *FEATURE_COLUMNS]
        )
    return pd.read_parquet(path)


def rebuild_sentiment_features(season: int) -> pd.DataFrame:
    features = build_sentiment_features(season)
    if SENTIMENT_FEATURES_PATH.exists():
        existing = load_sentiment_features()
        if not existing.empty:
            keep = existing[existing["season"] != season]
            features = pd.concat([keep, features], ignore_index=True)
    save_sentiment_features(features)
    try:
        from src.sentiment.fantasy_aggregate import merge_fantasy_into_sentiment_features

        features = merge_fantasy_into_sentiment_features(season)
    except Exception:
        pass
    return features


def build_sentiment_sources_index(
    season: int,
    week: int,
    *,
    videos: pd.DataFrame | None = None,
    roster: pd.DataFrame | None = None,
) -> dict[str, list[dict]]:
    """Single-pass index of channel sources per player for one NFL week."""
    videos = videos if videos is not None else load_raw_content_cache()
    if videos.empty:
        return {}

    roster = roster if roster is not None else load_season_roster(season)
    fantasy_networks = set(FANTASY_NETWORK_COLUMNS)
    sources_by_player: dict[str, dict[tuple[str, str], dict]] = {}

    scoped = videos.copy()
    if "video_id" not in scoped.columns and "content_id" in scoped.columns:
        scoped["video_id"] = scoped["content_id"]
    scoped["published_at"] = pd.to_datetime(scoped["published_at"], utc=True)

    for _, video in scoped.iterrows():
        team = str(video.get("team") or "").upper()
        network = str(video.get("network") or "locked_on")
        published_at = pd.Timestamp(video.get("published_at"))
        label = str(video.get("channel_label") or "")
        source_key = (label, network)

        if team == LEAGUE_TEAM_CODE or network in fantasy_networks:
            if map_publish_time_to_league_week(published_at, season) != week:
                continue
            text = _video_text(video)
            for mention in extract_mentions(text, roster_display_names_all(roster)):
                linked = link_mention_league(mention.player_name, roster)
                if linked is None:
                    continue
                pid = str(linked["player_id"])
                bucket = sources_by_player.setdefault(pid, {})
                if source_key not in bucket:
                    bucket[source_key] = {"label": label, "network": network}
            continue

        if map_publish_time_to_week(team, published_at, season) != week:
            continue
        text = _video_text(video)
        for mention in extract_mentions(text, roster_display_names(roster, team)):
            linked = link_mention(mention.player_name, team, roster)
            if linked is None:
                continue
            pid = str(linked["player_id"])
            bucket = sources_by_player.setdefault(pid, {})
            if source_key not in bucket:
                bucket[source_key] = {"label": label, "network": network}

    return {
        pid: sorted(sources.values(), key=lambda x: x["label"])
        for pid, sources in sources_by_player.items()
    }


def sentiment_sources_for_player(
    player_id: str,
    season: int,
    week: int,
    videos: pd.DataFrame | None = None,
    *,
    sources_index: dict[str, list[dict]] | None = None,
) -> list[dict]:
    """Distinct channel sources (with network) that mentioned this player in the target week."""
    if sources_index is not None:
        return sources_index.get(str(player_id), [])

    index = build_sentiment_sources_index(season, week, videos=videos)
    return index.get(str(player_id), [])


def sentiment_channel_labels_for_player(
    player_id: str,
    season: int,
    week: int,
    videos: pd.DataFrame | None = None,
) -> list[str]:
    """Distinct channel labels that mentioned this player in the target week."""
    return [s["label"] for s in sentiment_sources_for_player(player_id, season, week, videos=videos)]
