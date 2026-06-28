#!/usr/bin/env python3
"""Phase B: deep Chat Sports team channel experiment — before/after team eval."""

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
from src.sentiment.chat_sports_channels import chat_sports_channel_for_team  # noqa: E402

SNAPSHOT_PATH = ANALYTICS_DIR / "sentiment_features_locked_on_baseline.parquet"


def ingest_team_channel(
    team: str,
    *,
    published_after: str,
    max_pages: int,
) -> dict:
    channel = chat_sports_channel_for_team(team)
    if channel is None or channel.needs_resolution():
        raise RuntimeError(f"No resolved Chat Sports channel for team {team}")

    cutoff = datetime.fromisoformat(published_after).replace(tzinfo=timezone.utc)
    rows = fetch_channel_uploads(
        channel,
        published_after=cutoff,
        max_results=50,
        max_pages=max_pages,
        continue_past_cutoff=True,
    )
    merged = merge_raw_content(rows)
    return {
        "team": team,
        "channel_id": channel.channel_id,
        "channel_label": channel.label,
        "videos_added": len(rows),
        "cache_rows": len(merged),
    }


def fetch_transcripts_for_team(team: str, limit: int) -> dict:
    channel = chat_sports_channel_for_team(team)
    if channel is None:
        return {"candidates": 0, "fetched": 0}
    df = load_raw_content_cache()
    scoped = df[df["channel_id"] == channel.channel_id]
    fetched = 0
    for cid in scoped["content_id"].astype(str).head(limit):
        fetch_transcript(cid)
        fetched += 1
    return {"candidates": len(scoped), "fetched": fetched}


def team_mention_stats(team: str, seasons: list[int]) -> dict:
    import pandas as pd

    path = SENTIMENT_FEATURES_PATH
    if not path.exists():
        return {"team_rows": 0}
    df = pd.read_parquet(path)
    df = df[(df["team"] == team.upper()) & (df["season"].isin(seasons))]
    if df.empty:
        return {"team_rows": 0}
    return {
        "team_rows": int(len(df)),
        "rows_with_mentions": int((df["yt_mention_count"].fillna(0) > 0).sum()),
        "avg_mention_weight": float(df["yt_mention_count"].mean()),
    }


def run_experiment(
    team: str,
    seasons: list[int],
    *,
    published_after: str = "2024-01-01",
    max_pages: int = 80,
    transcript_limit: int = 2000,
    report_path: Path | None = None,
) -> dict:
    team = team.upper()
    channel = chat_sports_channel_for_team(team)
    if channel is None:
        raise RuntimeError(f"Chat Sports channel not registered for {team}")

    out = report_path or ANALYTICS_DIR / f"chat_sports_experiment_{team.lower()}.json"

    if SENTIMENT_FEATURES_PATH.exists():
        shutil.copy2(SENTIMENT_FEATURES_PATH, SNAPSHOT_PATH)

    before = run_eval(
        ["qb", "rb", "wr"],
        seasons,
        team=team,
        sentiment_path=SNAPSHOT_PATH if SNAPSHOT_PATH.exists() else SENTIMENT_FEATURES_PATH,
        report_path=ANALYTICS_DIR / f"chat_sports_{team.lower()}_before.json",
    )

    ingest_stats = ingest_team_channel(
        team,
        published_after=published_after,
        max_pages=max_pages,
    )
    transcript_stats = fetch_transcripts_for_team(team, limit=transcript_limit)

    for season in seasons:
        rebuild_sentiment_features(season)

    mention_stats = team_mention_stats(team, seasons)

    after = run_eval(
        ["qb", "rb", "wr"],
        seasons,
        team=team,
        report_path=ANALYTICS_DIR / f"chat_sports_{team.lower()}_after.json",
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
            b_comp = base_row.get("composite_delta")
            a_comp = row.get("composite_delta")
            comp_delta = None
            if b_comp is not None and a_comp is not None:
                try:
                    comp_delta = round(float(a_comp) - float(b_comp), 4)
                except (TypeError, ValueError):
                    comp_delta = None
            rows.append(
                {
                    "season": season,
                    "composite_delta_vs_before": comp_delta,
                    "mae_delta_vs_before": round(
                        (row.get("sentiment_mae") or 0) - (base_row.get("sentiment_mae") or 0),
                        4,
                    ),
                    "before_composite_delta": b_comp,
                    "after_composite_delta": a_comp,
                }
            )
        delta[pos] = rows

    report = {
        "team": team,
        "channel": {
            "label": channel.label,
            "channel_id": channel.channel_id,
            "network": channel.network,
            "confidence": channel.confidence,
        },
        "seasons": seasons,
        "ingest": ingest_stats,
        "transcripts": transcript_stats,
        "mention_stats": mention_stats,
        "before": before["summary"],
        "after": after["summary"],
        "delta_vs_before": delta,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--team", required=True, help="Team code, e.g. MIN or LV")
    parser.add_argument("--published-after", default="2024-01-01")
    parser.add_argument("--max-pages", type=int, default=80)
    parser.add_argument("--transcript-limit", type=int, default=2000)
    parser.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025])
    parser.add_argument("--report-path", default=None)
    args = parser.parse_args()

    report = run_experiment(
        args.team,
        args.seasons,
        published_after=args.published_after,
        max_pages=args.max_pages,
        transcript_limit=args.transcript_limit,
        report_path=Path(args.report_path) if args.report_path else None,
    )
    print(json.dumps(report, indent=2, default=str))
    out = Path(args.report_path) if args.report_path else ANALYTICS_DIR / f"chat_sports_experiment_{args.team.lower()}.json"
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
