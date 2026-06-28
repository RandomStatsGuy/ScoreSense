#!/usr/bin/env python3
"""Backfill historical YouTube uploads for sentiment feature generation."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.integrations.youtube import (  # noqa: E402
    fetch_channel_uploads,
    fetch_transcript,
    merge_raw_content,
    youtube_api_key_configured,
)
from src.sentiment.aggregate import rebuild_sentiment_features
from src.sentiment.channels import load_channels


def backfill(
    *,
    published_after: datetime,
    max_pages: int = 8,
    network: str | None = "locked_on",
    fetch_transcripts: bool = True,
    rebuild_seasons: list[int] | None = None,
) -> dict:
    if not youtube_api_key_configured():
        return {"status": "skipped", "reason": "YOUTUBE_API_KEY not set"}

    channels = load_channels(network=network) if network else load_channels()
    channels = [c for c in channels if not c.needs_resolution()]

    all_rows: list[dict] = []
    errors: list[str] = []
    for channel in channels:
        try:
            rows = fetch_channel_uploads(
                channel,
                published_after=published_after,
                max_results=50,
                max_pages=max_pages,
                continue_past_cutoff=True,
            )
            all_rows.extend(rows)
        except Exception as exc:
            errors.append(f"{channel.team}/{channel.network}: {exc}")

    merged = merge_raw_content(all_rows)
    transcripts = 0
    if fetch_transcripts and all_rows:
        seen: set[str] = set()
        for row in all_rows:
            cid = str(row["content_id"])
            if cid in seen:
                continue
            seen.add(cid)
            fetch_transcript(cid)
            transcripts += 1

    feature_rows: dict[int, int] = {}
    for season in rebuild_seasons or []:
        features = rebuild_sentiment_features(season)
        feature_rows[season] = int(len(features[features["season"] == season]))

    return {
        "status": "ok" if not errors else "partial",
        "channels_scanned": len(channels),
        "videos_added": len(all_rows),
        "cache_rows": len(merged),
        "transcripts_fetched": transcripts,
        "feature_rows_by_season": feature_rows,
        "errors": errors[:15],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--after", default="2024-08-01", help="ISO date — fetch videos published after")
    parser.add_argument("--max-pages", type=int, default=12, help="Playlist pages per channel (50 items each)")
    parser.add_argument("--network", default="locked_on", help="Channel network filter (locked_on, sb_nation, or omit)")
    parser.add_argument("--no-transcripts", action="store_true")
    parser.add_argument(
        "--rebuild-seasons",
        type=int,
        nargs="+",
        default=[2024, 2025],
        help="Seasons to rebuild sentiment_features for",
    )
    args = parser.parse_args()

    published_after = datetime.fromisoformat(args.after).replace(tzinfo=timezone.utc)
    network = args.network if args.network.lower() not in ("all", "none") else None
    result = backfill(
        published_after=published_after,
        max_pages=args.max_pages,
        network=network,
        fetch_transcripts=not args.no_transcripts,
        rebuild_seasons=args.rebuild_seasons,
    )
    import json

    print(json.dumps(result, indent=2))
    return 0 if result.get("status") != "skipped" else 1


if __name__ == "__main__":
    raise SystemExit(main())
