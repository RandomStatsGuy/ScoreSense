#!/usr/bin/env python3
"""Resolve, ingest, and screen league-wide fantasy YouTube channels."""

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

from src.analytics.fantasy_channel_eval import run_screen  # noqa: E402
from src.integrations.youtube import (  # noqa: E402
    fetch_channel_uploads,
    fetch_transcript,
    merge_raw_content,
    youtube_api_key_configured,
)
from src.sentiment.fantasy_aggregate import merge_fantasy_into_sentiment_features  # noqa: E402
from src.sentiment.fantasy_channels import FANTASY_CHANNELS_PATH, FantasyChannelEntry, load_fantasy_channels  # noqa: E402
from src.integrations.youtube import _api_get  # noqa: E402


def _score_fantasy_match(title: str, entry: FantasyChannelEntry) -> int:
    title_l = title.lower()
    label_l = entry.label.lower()
    score = 0
    if label_l in title_l:
        score += 10
    for token in label_l.split():
        if len(token) > 3 and token in title_l:
            score += 2
    if entry.search_query:
        for token in entry.search_query.lower().split()[:3]:
            if len(token) > 3 and token in title_l:
                score += 1
    return score


def resolve_fantasy_channels(*, apply: bool = False) -> dict:
    if not youtube_api_key_configured():
        return {"status": "skipped", "reason": "YOUTUBE_API_KEY not set"}

    raw = yaml.safe_load(FANTASY_CHANNELS_PATH.read_text(encoding="utf-8")) or {}
    rows = raw.get("channels") or []
    resolved = 0
    errors: list[str] = []

    for row in rows:
        if not isinstance(row, dict):
            continue
        entry = FantasyChannelEntry(
            channel_id=str(row.get("channel_id") or ""),
            network=str(row.get("network") or ""),
            tier=str(row.get("tier") or "analysis"),
            weight=float(row.get("weight") or 0.9),
            label=str(row.get("label") or ""),
            search_query=str(row.get("search_query") or "") or None,
        )
        if not entry.needs_resolution():
            continue
        query = entry.search_query or entry.label
        try:
            payload = _api_get(
                "search",
                {"part": "snippet", "q": query, "type": "channel", "maxResults": 5},
            )
            best_id = None
            best_score = 0
            for item in payload.get("items") or []:
                snippet = item.get("snippet") or {}
                channel_id = (item.get("id") or {}).get("channelId")
                title = str(snippet.get("title") or "")
                if not channel_id or not channel_id.startswith("UC"):
                    continue
                score = _score_fantasy_match(title, entry)
                if score > best_score:
                    best_score = score
                    best_id = channel_id
            if best_id and best_score >= 5:
                row["channel_id"] = best_id
                resolved += 1
            else:
                errors.append(f"{entry.label}: no confident match")
        except Exception as exc:
            errors.append(f"{entry.label}: {exc}")

    out_path = FANTASY_CHANNELS_PATH if apply else FANTASY_CHANNELS_PATH.with_suffix(".resolved.yaml")
    out_path.write_text(yaml.safe_dump(raw, sort_keys=False, allow_unicode=True), encoding="utf-8")
    return {"status": "ok", "resolved": resolved, "output": str(out_path), "errors": errors}


def ingest_fantasy_channels(
    *,
    published_after: str,
    max_pages: int,
    transcript_limit: int | None,
    networks: list[str] | None = None,
) -> dict:
    if not youtube_api_key_configured():
        return {"status": "skipped", "reason": "YOUTUBE_API_KEY not set"}

    cutoff = datetime.fromisoformat(published_after).replace(tzinfo=timezone.utc)
    channels = [c for c in load_fantasy_channels() if not c.needs_resolution()]
    if networks:
        network_set = {n.lower() for n in networks}
        channels = [c for c in channels if c.network.lower() in network_set]
    all_rows: list[dict] = []
    per_channel: dict[str, int] = {}

    for channel in channels:
        rows = fetch_channel_uploads(
            channel,
            published_after=cutoff,
            max_results=50,
            max_pages=max_pages,
            continue_past_cutoff=True,
        )
        all_rows.extend(rows)
        per_channel[channel.label] = len(rows)

    merged = merge_raw_content(all_rows)
    transcripts = 0
    limit = transcript_limit if transcript_limit is not None else len(all_rows)
    seen: set[str] = set()
    for row in all_rows[:limit]:
        cid = str(row["content_id"])
        if cid in seen:
            continue
        seen.add(cid)
        fetch_transcript(cid)
        transcripts += 1

    return {
        "status": "ok",
        "videos_added": len(all_rows),
        "cache_rows": len(merged),
        "transcripts_fetched": transcripts,
        "per_channel": per_channel,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resolve", action="store_true", help="Resolve YouTube channel IDs")
    parser.add_argument("--apply-resolve", action="store_true", help="Write resolved IDs to fantasy_channels.yaml")
    parser.add_argument("--ingest", action="store_true", help="Backfill uploads + transcripts")
    parser.add_argument("--screen", action="store_true", help="Run correlation / projection screen")
    parser.add_argument("--incorporate", action="store_true", help="Merge approved channels into sentiment_features")
    parser.add_argument("--published-after", default="2024-01-01")
    parser.add_argument("--max-pages", type=int, default=10, help="Pages per channel (~500 videos each)")
    parser.add_argument("--transcript-limit", type=int, default=400, help="Max transcripts per channel run")
    parser.add_argument(
        "--networks",
        nargs="*",
        default=None,
        help="Optional network keys to ingest (default: all active channels)",
    )
    parser.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025])
    args = parser.parse_args()

    if not any([args.resolve, args.apply_resolve, args.ingest, args.screen, args.incorporate]):
        args.resolve = args.ingest = args.screen = True

    report: dict = {"steps": []}

    if args.resolve or args.apply_resolve:
        step = resolve_fantasy_channels(apply=args.apply_resolve)
        report["steps"].append({"resolve": step})
        print(yaml.safe_dump(step, sort_keys=False))

    if args.ingest:
        ingest_channels = [
            c for c in load_fantasy_channels() if not c.needs_resolution()
        ]
        if args.networks:
            network_set = {n.lower() for n in args.networks}
            ingest_channels = [c for c in ingest_channels if c.network.lower() in network_set]
        per_channel_limit = args.transcript_limit
        step = ingest_fantasy_channels(
            published_after=args.published_after,
            max_pages=args.max_pages,
            transcript_limit=per_channel_limit * len(ingest_channels) if per_channel_limit else None,
            networks=args.networks,
        )
        report["steps"].append({"ingest": step})
        print(yaml.safe_dump(step, sort_keys=False))

    if args.screen:
        channels = [
            {"channel_id": c.channel_id, "network": c.network, "label": c.label}
            for c in load_fantasy_channels()
            if not c.needs_resolution()
        ]
        screen = run_screen(channels, args.seasons)
        report["screen"] = {
            "approved_networks": screen["approved_networks"],
            "results": [
                {
                    "label": r["label"],
                    "recommend": r["recommend_incorporate"],
                    "mention_rows": r["total_mention_rows"],
                    "sig_positions": r["sig_positions"],
                    "helpful_positions": r["helpful_positions"],
                }
                for r in screen["results"]
            ],
        }
        print(json.dumps(report["screen"], indent=2))

    if args.incorporate and report.get("screen"):
        for season in args.seasons:
            merge_fantasy_into_sentiment_features(season)
        report["incorporated_seasons"] = args.seasons

    out_path = ROOT / "artifacts" / "analytics" / "fantasy_channel_screen_run.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
