#!/usr/bin/env python3
"""Phase A: shallow ingest + per-team Chat Sports QB/RB/WR niche screen."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analytics.fantasy_channel_eval import MIN_MENTION_ROWS  # noqa: E402
from src.analytics.niche_channel_discovery import (  # noqa: E402
    POSITIONS,
    _merge_channel,
    _niche_tier,
    _position_mask,
)
from src.analytics.fantasy_channel_eval import correlation_stats, projection_lift  # noqa: E402
from src.config import ANALYTICS_DIR  # noqa: E402
from src.integrations.youtube import (  # noqa: E402
    fetch_channel_uploads,
    fetch_transcript,
    merge_raw_content,
    youtube_api_key_configured,
)
from src.sentiment.channel_features import build_single_channel_features  # noqa: E402
from src.sentiment.chat_sports_channels import load_chat_sports_channels  # noqa: E402
from src.sentiment.merge import sentiment_feature_columns  # noqa: E402

REPORT_PATH = ANALYTICS_DIR / "chat_sports_screen.json"


def ingest_channels(
    channels,
    *,
    published_after: str,
    max_pages: int,
    transcript_limit: int,
) -> dict:
    cutoff = datetime.fromisoformat(published_after).replace(tzinfo=timezone.utc)
    all_rows: list[dict] = []
    per_team: dict[str, int] = {}
    for channel in channels:
        if channel.needs_resolution():
            continue
        if channel.video_count is not None and channel.video_count == 0:
            per_team[channel.team] = 0
            continue
        try:
            rows = fetch_channel_uploads(
                channel,
                published_after=cutoff,
                max_results=50,
                max_pages=max_pages,
                continue_past_cutoff=True,
            )
        except Exception as exc:
            per_team[channel.team] = 0
            continue
        all_rows.extend(rows)
        per_team[channel.team] = len(rows)

    merged = merge_raw_content(all_rows)
    fetched = 0
    seen: set[str] = set()
    for row in all_rows:
        if fetched >= transcript_limit * len(channels):
            break
        cid = str(row["content_id"])
        if cid in seen:
            continue
        seen.add(cid)
        fetch_transcript(cid)
        fetched += 1

    return {
        "videos_added": len(all_rows),
        "cache_rows": len(merged),
        "transcripts_fetched": fetched,
        "per_team": per_team,
    }


def evaluate_team_channel(
    channel,
    seasons: list[int],
    feature_cache: dict,
) -> dict:
    channel_id = channel.channel_id
    parts = []
    for season in seasons:
        key = (channel_id, season)
        if key not in feature_cache:
            feature_cache[key] = build_single_channel_features(season, channel_id)
        if not feature_cache[key].empty:
            parts.append(feature_cache[key])

    niches = []
    if not parts:
        for position in POSITIONS:
            niches.append(
                {
                    "position": position,
                    "scope_team": channel.team,
                    "correlation": {"n": 0},
                    "projection": {"seasons_tested": 0},
                    "tier": "none",
                }
            )
        return {
            "team": channel.team,
            "channel_id": channel_id,
            "channel_label": channel.label,
            "confidence": channel.confidence,
            "niches": niches,
            "best_tier": "none",
        }

    feats = __import__("pandas").concat(parts, ignore_index=True)
    for position in POSITIONS:
        pos_feats = _position_mask(feats, position)
        if pos_feats.empty:
            niches.append(
                {
                    "position": position,
                    "scope_team": channel.team,
                    "correlation": {"n": 0},
                    "projection": {"seasons_tested": 0},
                    "tier": "none",
                }
            )
            continue

        merged = _merge_channel(position, pos_feats, channel.team)
        corr = correlation_stats(merged, seasons)
        proj = {"seasons_tested": 0, "seasons_improved": 0, "avg_composite_delta": None}
        n = int(corr.get("n") or 0)
        p = corr.get("p_value")
        if n >= MIN_MENTION_ROWS and p is not None and p < 0.10:
            proj = projection_lift(position, merged, seasons)
        tier = _niche_tier(corr, proj)
        niches.append(
            {
                "position": position,
                "scope_team": channel.team,
                "correlation": corr,
                "projection": proj,
                "tier": tier,
            }
        )

    tier_rank = {"strong": 0, "lift": 1, "correlation": 2, "watch": 3, "none": 9}
    best = min(niches, key=lambda n: tier_rank.get(n["tier"], 9))
    return {
        "team": channel.team,
        "channel_id": channel_id,
        "channel_label": channel.label,
        "confidence": channel.confidence,
        "niches": niches,
        "best_tier": best["tier"],
        "best_position": best["position"],
    }


def run_screen(
    seasons: list[int],
    *,
    ingest: bool = True,
    published_after: str = "2024-01-01",
    max_pages: int = 5,
    transcript_limit: int = 150,
) -> dict:
    channels = [c for c in load_chat_sports_channels() if not c.needs_resolution()]
    ingest_stats = {}
    if ingest and youtube_api_key_configured():
        ingest_stats = ingest_channels(
            channels,
            published_after=published_after,
            max_pages=max_pages,
            transcript_limit=transcript_limit,
        )

    feature_cache: dict = {}
    team_results = [
        evaluate_team_channel(ch, seasons, feature_cache) for ch in channels
    ]

    ranked_niches: list[dict] = []
    for tr in team_results:
        for niche in tr["niches"]:
            if niche["tier"] == "none":
                continue
            ranked_niches.append(
                {
                    "team": tr["team"],
                    "channel_label": tr["channel_label"],
                    "channel_id": tr["channel_id"],
                    "confidence": tr["confidence"],
                    **niche,
                }
            )

    tier_rank = {"strong": 0, "lift": 1, "correlation": 2, "watch": 3, "none": 9}
    ranked_niches.sort(
        key=lambda x: (
            tier_rank.get(x["tier"], 9),
            x.get("correlation", {}).get("p_value") or 1.0,
            x.get("projection", {}).get("avg_composite_delta") or 0.0,
        )
    )

    heatmap = {}
    for tr in team_results:
        heatmap[tr["team"]] = {
            n["position"]: {"tier": n["tier"], "p_value": (n.get("correlation") or {}).get("p_value")}
            for n in tr["niches"]
        }

    report = {
        "test_seasons": seasons,
        "channels_screened": len(team_results),
        "ingest": ingest_stats,
        "ranked_niches": ranked_niches,
        "team_results": team_results,
        "heatmap": heatmap,
        "phase_b_candidates": [
            {
                "team": tr["team"],
                "channel_label": tr["channel_label"],
                "best_tier": tr["best_tier"],
                "best_position": tr.get("best_position"),
            }
            for tr in team_results
            if tr["best_tier"] in ("strong", "lift", "correlation")
        ],
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025])
    parser.add_argument("--no-ingest", action="store_true")
    parser.add_argument("--published-after", default="2024-01-01")
    parser.add_argument("--max-pages", type=int, default=5)
    parser.add_argument("--transcript-limit", type=int, default=150)
    args = parser.parse_args()

    report = run_screen(
        args.seasons,
        ingest=not args.no_ingest,
        published_after=args.published_after,
        max_pages=args.max_pages,
        transcript_limit=args.transcript_limit,
    )
    print(
        yaml.safe_dump(
            {
                "ranked_niches_count": len(report["ranked_niches"]),
                "top_10": report["ranked_niches"][:10],
                "phase_b_candidates": report["phase_b_candidates"],
            },
            sort_keys=False,
        )
    )
    print(f"\nWrote {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
