"""YouTube Data API v3 integration for team channel uploads."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from src.config import SENTIMENT_CACHE_DIR, write_parquet
from src.sentiment.channels import ChannelEntry

YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"
RAW_CONTENT_PATH = SENTIMENT_CACHE_DIR / "raw_content.parquet"
RAW_VIDEOS_PATH = SENTIMENT_CACHE_DIR / "raw_videos.parquet"  # legacy alias
TRANSCRIPTS_DIR = SENTIMENT_CACHE_DIR / "transcripts"
WATERMARK_PATH = SENTIMENT_CACHE_DIR / "ingest_watermark.json"

RAW_CONTENT_COLUMNS = [
    "content_id",
    "content_type",
    "channel_id",
    "team",
    "network",
    "tier",
    "channel_weight",
    "channel_label",
    "published_at",
    "title",
    "description",
    "duration_sec",
    "fetched_at",
]


def youtube_api_key_configured() -> bool:
    return bool(os.getenv("YOUTUBE_API_KEY", "").strip())


def get_youtube_api_key() -> str:
    key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("YOUTUBE_API_KEY is not set")
    return key


def _api_get(endpoint: str, params: dict[str, Any]) -> dict:
    params = dict(params)
    params["key"] = get_youtube_api_key()
    url = f"{YOUTUBE_API_BASE}/{endpoint.lstrip('/')}"
    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    return response.json()


def _parse_duration_iso8601(duration: str) -> int | None:
    if not duration or not duration.startswith("PT"):
        return None
    hours = minutes = seconds = 0
    num = ""
    for ch in duration[2:]:
        if ch.isdigit():
            num += ch
        elif ch == "H":
            hours = int(num or 0)
            num = ""
        elif ch == "M":
            minutes = int(num or 0)
            num = ""
        elif ch == "S":
            seconds = int(num or 0)
            num = ""
    return hours * 3600 + minutes * 60 + seconds


def _normalize_raw_frame(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=RAW_CONTENT_COLUMNS)

    out = df.copy()
    if "content_id" not in out.columns and "video_id" in out.columns:
        out["content_id"] = out["video_id"]
    if "content_type" not in out.columns:
        out["content_type"] = "youtube_video"
    if "network" not in out.columns:
        out["network"] = "locked_on"
    for col in RAW_CONTENT_COLUMNS:
        if col not in out.columns:
            out[col] = None
    return out[RAW_CONTENT_COLUMNS]


def _migrate_legacy_raw_videos() -> None:
    """One-time copy raw_videos.parquet → raw_content.parquet with new columns."""
    if RAW_CONTENT_PATH.exists() or not RAW_VIDEOS_PATH.exists():
        return
    legacy = pd.read_parquet(RAW_VIDEOS_PATH)
    if "content_id" not in legacy.columns and "video_id" in legacy.columns:
        legacy["content_id"] = legacy["video_id"]
    legacy = _normalize_raw_frame(legacy)
    save_raw_content_cache(legacy)


def fetch_channel_uploads(
    channel: ChannelEntry,
    *,
    published_after: datetime | None = None,
    max_results: int = 25,
    max_pages: int = 1,
    continue_past_cutoff: bool = False,
) -> list[dict]:
    """List recent uploads for a channel via its uploads playlist."""
    if channel.channel_id.startswith("UC_PLACEHOLDER"):
        return []

    all_rows: list[dict] = []
    page_token: str | None = None
    pages = 0
    now = datetime.now(timezone.utc)
    effective_weight = channel.effective_weight

    while pages < max_pages:
        params: dict[str, Any] = {
            "part": "snippet,contentDetails",
            "playlistId": channel.uploads_playlist_id,
            "maxResults": min(max_results, 50),
        }
        if page_token:
            params["pageToken"] = page_token
        payload = _api_get("playlistItems", params)
        items = payload.get("items") or []
        if not items:
            break

        stop_paging = False
        for item in items:
            snippet = item.get("snippet") or {}
            content = item.get("contentDetails") or {}
            video_id = content.get("videoId") or snippet.get("resourceId", {}).get("videoId")
            if not video_id:
                continue
            published_raw = snippet.get("publishedAt")
            if not published_raw:
                continue
            published_at = pd.Timestamp(published_raw)
            if published_at.tzinfo is None:
                published_at = published_at.tz_localize("UTC")
            if published_after is not None:
                cutoff = published_after
                if cutoff.tzinfo is None:
                    cutoff = cutoff.replace(tzinfo=timezone.utc)
                if published_at.to_pydatetime() < cutoff:
                    if not continue_past_cutoff:
                        stop_paging = True
                    continue
            all_rows.append(
                {
                    "content_id": str(video_id),
                    "content_type": "youtube_video",
                    "channel_id": channel.channel_id,
                    "team": channel.team,
                    "network": channel.network,
                    "tier": channel.tier,
                    "channel_weight": effective_weight,
                    "channel_label": channel.label,
                    "published_at": published_at,
                    "title": str(snippet.get("title") or "")[:500],
                    "description": str(snippet.get("description") or "")[:2000],
                    "duration_sec": _parse_duration_iso8601(content.get("duration") or ""),
                    "fetched_at": now,
                }
            )

        pages += 1
        page_token = payload.get("nextPageToken")
        if not page_token or stop_paging:
            break

    return all_rows


def fetch_transcript(video_id: str) -> dict:
    """Fetch captions via youtube-transcript-api; cache JSON on disk."""
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = TRANSCRIPTS_DIR / f"{video_id}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))

    result = {
        "video_id": video_id,
        "transcript_missing": True,
        "text": "",
        "segments": [],
    }
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        segments = YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "en-US"])
        text = " ".join(str(s.get("text") or "") for s in segments).strip()
        result = {
            "video_id": video_id,
            "transcript_missing": not bool(text),
            "text": text,
            "segments": segments,
        }
    except Exception:
        pass

    cache_path.write_text(json.dumps(result), encoding="utf-8")
    return result


def load_raw_content_cache() -> pd.DataFrame:
    _migrate_legacy_raw_videos()
    if RAW_CONTENT_PATH.exists():
        return _normalize_raw_frame(pd.read_parquet(RAW_CONTENT_PATH))
    if RAW_VIDEOS_PATH.exists():
        return _normalize_raw_frame(pd.read_parquet(RAW_VIDEOS_PATH))
    return pd.DataFrame(columns=RAW_CONTENT_COLUMNS)


def load_raw_videos_cache() -> pd.DataFrame:
    """Backward-compatible alias; adds video_id column for legacy callers."""
    df = load_raw_content_cache()
    if df.empty:
        return pd.DataFrame(
            columns=[
                "video_id",
                "channel_id",
                "team",
                "tier",
                "channel_weight",
                "channel_label",
                "published_at",
                "title",
                "description",
                "duration_sec",
                "fetched_at",
            ]
        )
    out = df.copy()
    out["video_id"] = out["content_id"]
    return out


def save_raw_content_cache(df: pd.DataFrame) -> Path:
    SENTIMENT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    normalized = _normalize_raw_frame(df)
    write_parquet(normalized, RAW_CONTENT_PATH)
    return RAW_CONTENT_PATH


def save_raw_videos_cache(df: pd.DataFrame) -> Path:
    return save_raw_content_cache(df)


def merge_raw_content(new_rows: list[dict]) -> pd.DataFrame:
    existing = load_raw_content_cache()
    if not new_rows:
        return existing
    incoming = _normalize_raw_frame(pd.DataFrame(new_rows))
    if existing.empty:
        merged = incoming
    else:
        merged = pd.concat([existing, incoming], ignore_index=True)
    merged = merged.drop_duplicates(subset=["content_id"], keep="last")
    merged["published_at"] = pd.to_datetime(merged["published_at"], utc=True)
    save_raw_content_cache(merged)
    return merged


def merge_raw_videos(new_rows: list[dict]) -> pd.DataFrame:
    # legacy rows may use video_id key
    normalized = []
    for row in new_rows:
        r = dict(row)
        if "content_id" not in r and "video_id" in r:
            r["content_id"] = r["video_id"]
        if "content_type" not in r:
            r["content_type"] = "youtube_video"
        if "network" not in r:
            r["network"] = "locked_on"
        normalized.append(r)
    return merge_raw_content(normalized)


def load_watermark() -> dict[str, str]:
    if not WATERMARK_PATH.exists():
        return {}
    try:
        return json.loads(WATERMARK_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_watermark(channel_id: str, published_at: datetime) -> None:
    SENTIMENT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    data = load_watermark()
    data[channel_id] = published_at.isoformat()
    WATERMARK_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def ingest_channels(
    channels: list[ChannelEntry],
    *,
    lookback_days: int | None = None,
    fetch_transcripts: bool = True,
) -> dict:
    if not youtube_api_key_configured():
        return {"status": "skipped", "reason": "YOUTUBE_API_KEY not set", "videos_added": 0}

    lookback_days = lookback_days or int(os.getenv("SENTIMENT_LOOKBACK_DAYS", "7"))
    published_after = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    watermark = load_watermark()

    all_rows: list[dict] = []
    errors: list[str] = []
    for channel in channels:
        ch_after = published_after
        if channel.channel_id in watermark:
            try:
                ch_after = max(ch_after, datetime.fromisoformat(watermark[channel.channel_id]))
            except ValueError:
                pass
        try:
            rows = fetch_channel_uploads(channel, published_after=ch_after)
            all_rows.extend(rows)
            if rows:
                latest = max(pd.Timestamp(r["published_at"]) for r in rows)
                save_watermark(channel.channel_id, latest.to_pydatetime())
        except Exception as exc:
            errors.append(f"{channel.team}:{exc}")

    merged = merge_raw_content(all_rows)
    transcripts_fetched = 0
    if fetch_transcripts and not merged.empty and all_rows:
        new_ids = {r["content_id"] for r in all_rows}
        for content_id in new_ids:
            fetch_transcript(content_id)
            transcripts_fetched += 1

    return {
        "status": "ok" if not errors else "partial",
        "videos_added": len(all_rows),
        "cache_rows": len(merged),
        "transcripts_fetched": transcripts_fetched,
        "errors": errors[:10],
    }
