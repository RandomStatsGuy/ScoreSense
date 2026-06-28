#!/usr/bin/env python3
"""Raiders Report (Chat Sports) channel experiment — before/after LV eval."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analytics.sentiment_projection_eval import run_eval  # noqa: E402
from src.config import ANALYTICS_DIR, SENTIMENT_FEATURES_PATH  # noqa: E402
from src.integrations.youtube import (  # noqa: E402
    fetch_channel_uploads,
    fetch_transcript,
    load_raw_content_cache,
    merge_raw_content,
)
from src.sentiment.aggregate import rebuild_sentiment_features  # noqa: E402
from src.sentiment.channels import load_channels  # noqa: E402

RAIDERS_REPORT_CHANNEL_ID = "UC2zTXqHLEz56OG0EvS9SiFA"
SNAPSHOT_PATH = ANALYTICS_DIR / "sentiment_features_locked_on_baseline.parquet"
REPORT_PATH = ANALYTICS_DIR / "raiders_report_experiment.json"


def _raiders_report_channel():
    for entry in load_channels():
        if entry.channel_id == RAIDERS_REPORT_CHANNEL_ID and entry.team == "LV":
            return entry
    raise RuntimeError("Raiders Report channel not found in channels.yaml")


def ingest_raiders_report(*, published_after: str, max_pages: int) -> dict:
    channel = _raiders_report_channel()
    cutoff = datetime.fromisoformat(published_after).replace(tzinfo=timezone.utc)
    rows = fetch_channel_uploads(
        channel,
        published_after=cutoff,
        max_results=50,
        max_pages=max_pages,
        continue_past_cutoff=True,
    )
    merged = merge_raw_content(rows)
    return {"videos_added": len(rows), "cache_rows": len(merged)}


def fetch_transcripts_for_channel(limit: int = 800) -> dict:
    df = load_raw_content_cache()
    scoped = df[df["channel_id"] == RAIDERS_REPORT_CHANNEL_ID]
    fetched = 0
    for cid in scoped["content_id"].astype(str).head(limit):
        fetch_transcript(cid)
        fetched += 1
    return {"candidates": len(scoped), "fetched": fetched}


def lv_mention_stats(seasons: list[int]) -> dict:
    import pandas as pd

    path = SENTIMENT_FEATURES_PATH
    if not path.exists():
        return {}
    df = pd.read_parquet(path)
    df = df[(df["team"] == "LV") & (df["season"].isin(seasons))]
    if df.empty:
        return {"lv_rows": 0}
    return {
        "lv_rows": int(len(df)),
        "lv_rows_with_mentions": int((df["yt_mention_count"].fillna(0) > 0).sum()),
        "avg_mention_weight": float(df["yt_mention_count"].mean()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--published-after", default="2024-01-01")
    parser.add_argument("--max-pages", type=int, default=15)
    parser.add_argument("--transcript-limit", type=int, default=600)
    parser.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025])
    args = parser.parse_args()

    if SENTIMENT_FEATURES_PATH.exists():
        shutil.copy2(SENTIMENT_FEATURES_PATH, SNAPSHOT_PATH)

    before = run_eval(
        ["qb", "rb", "wr"],
        args.seasons,
        team="LV",
        sentiment_path=SNAPSHOT_PATH if SNAPSHOT_PATH.exists() else SENTIMENT_FEATURES_PATH,
        report_path=ANALYTICS_DIR / "raiders_report_before.json",
    )

    ingest_stats = ingest_raiders_report(
        published_after=args.published_after,
        max_pages=args.max_pages,
    )
    transcript_stats = fetch_transcripts_for_channel(limit=args.transcript_limit)

    for season in args.seasons:
        rebuild_sentiment_features(season)

    mention_stats = lv_mention_stats(args.seasons)

    after = run_eval(
        ["qb", "rb", "wr"],
        args.seasons,
        team="LV",
        report_path=ANALYTICS_DIR / "raiders_report_after.json",
    )

    delta = {}
    for pos in ("qb", "rb", "wr"):
        b = before["positions"][pos]["season_detail"]
        a = after["positions"][pos]["season_detail"]
        by_season = {row["season"]: row for row in b}
        rows = []
        for row in a:
            season = row["season"]
            base_row = by_season.get(season, {})
            rows.append(
                {
                    "season": season,
                    "composite_delta_vs_before": round(
                        row.get("composite_delta", 0)
                        - base_row.get("composite_delta", 0),
                        4,
                    ),
                    "mae_delta_vs_before": round(
                        (row.get("sentiment_mae") or 0) - (base_row.get("sentiment_mae") or 0),
                        4,
                    ),
                    "before_composite_delta": base_row.get("composite_delta"),
                    "after_composite_delta": row.get("composite_delta"),
                }
            )
        delta[pos] = rows

    report = {
        "channel": {
            "label": "Raiders Report by Chat Sports",
            "channel_id": RAIDERS_REPORT_CHANNEL_ID,
            "host": "Mitchell Renz",
            "network": "chat_sports",
        },
        "seasons": args.seasons,
        "ingest": ingest_stats,
        "transcripts": transcript_stats,
        "lv_mention_stats": mention_stats,
        "before": before["summary"],
        "after": after["summary"],
        "delta_vs_before": delta,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"\nWrote {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
