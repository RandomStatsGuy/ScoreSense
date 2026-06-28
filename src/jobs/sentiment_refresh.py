"""Ingest team YouTube channels and rebuild sentiment_features.parquet."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from src.config import SENTIMENT_CACHE_DIR
from src.integrations.youtube import ingest_channels, youtube_api_key_configured
from src.sentiment.aggregate import rebuild_sentiment_features
from src.sentiment.channels import load_channels

REFRESH_STATUS_PATH = SENTIMENT_CACHE_DIR / "last_refresh.json"


def run_sentiment_refresh(
    season: int | None = None,
    week: int | None = None,
    *,
    lookback_days: int | None = None,
    skip_ingest: bool = False,
    fetch_transcripts: bool = False,
    transcript_seasons: list[int] | None = None,
    transcript_limit: int = 600,
) -> dict:
    started = datetime.now(timezone.utc).isoformat()
    channels = load_channels()
    active_teams = len({c.team for c in channels})

    transcript_status: dict | None = None
    if fetch_transcripts:
        from src.sentiment.transcript_backfill import fetch_transcripts_for_seasons

        seasons = transcript_seasons or ([int(season)] if season else [2024, 2025])
        transcript_status = fetch_transcripts_for_seasons(seasons, limit=transcript_limit)

    ingest_status: dict = {"status": "skipped", "reason": "skip_ingest"}
    if not skip_ingest:
        if youtube_api_key_configured():
            ingest_status = ingest_channels(channels, lookback_days=lookback_days)
        else:
            ingest_status = {"status": "skipped", "reason": "YOUTUBE_API_KEY not set", "videos_added": 0}

    target_season = season
    if target_season is None:
        from src.integrations.sleeper import get_nfl_state

        try:
            state = get_nfl_state()
            target_season = int(state.get("season") or state.get("league_season") or 2025)
        except Exception:
            target_season = 2025

    features = rebuild_sentiment_features(int(target_season))
    row_count = len(features)
    week_rows = int(len(features[features["week"] == week])) if week is not None and not features.empty else None

    status = {
        "started_at": started,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "season": int(target_season),
        "week": week,
        "channels_configured": len(channels),
        "channels_active_teams": active_teams,
        "ingest": ingest_status,
        "transcript_backfill": transcript_status,
        "feature_rows": row_count,
        "feature_rows_week": week_rows,
    }
    REFRESH_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    REFRESH_STATUS_PATH.write_text(json.dumps(status, indent=2), encoding="utf-8")
    return status


def get_sentiment_refresh_status() -> dict:
    if not REFRESH_STATUS_PATH.exists():
        return {"status": "never_run"}
    return json.loads(REFRESH_STATUS_PATH.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh YouTube beat narrative sentiment features")
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--week", type=int, default=None)
    parser.add_argument("--lookback-days", type=int, default=None)
    parser.add_argument("--skip-ingest", action="store_true", help="Rebuild features from cached raw videos only")
    parser.add_argument(
        "--fetch-transcripts",
        action="store_true",
        help="Fetch YouTube transcripts for cached videos before ingest/rebuild",
    )
    parser.add_argument("--transcript-limit", type=int, default=600)
    args = parser.parse_args()
    status = run_sentiment_refresh(
        season=args.season,
        week=args.week,
        lookback_days=args.lookback_days,
        skip_ingest=args.skip_ingest,
        fetch_transcripts=args.fetch_transcripts,
        transcript_limit=args.transcript_limit,
    )
    print(json.dumps(status, indent=2))


if __name__ == "__main__":
    main()
