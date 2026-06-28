#!/usr/bin/env python3
"""Resolve YouTube channel IDs for registry rows missing real UC... ids."""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.integrations.youtube import _api_get, youtube_api_key_configured  # noqa: E402
from src.sentiment.channels import CHANNELS_PATH, ChannelEntry, load_channels  # noqa: E402

RESOLVED_PATH = CHANNELS_PATH.parent / "channels.resolved.yaml"


def _score_match(title: str, entry: ChannelEntry) -> int:
    title_l = title.lower()
    score = 0
    if entry.network == "locked_on":
        if "locked on" in title_l:
            score += 10
        short = entry.search_query or ""
        if short and short.lower().replace("locked on ", "") in title_l:
            score += 5
    elif entry.network == "sb_nation":
        label = entry.label.lower()
        if label and label in title_l:
            score += 8
        if "sb nation" in title_l or any(w in title_l for w in label.split()[:2] if len(w) > 3):
            score += 2
    elif entry.network == "chat_sports":
        from src.sentiment.chat_sports_channels import score_chat_sports_match

        return score_chat_sports_match(title, entry.team)
    if entry.team.lower() in title_l:
        score += 1
    return score


def search_channel_id(entry: ChannelEntry) -> str | None:
    query = entry.search_query or entry.label
    if not query:
        return None
    payload = _api_get(
        "search",
        {
            "part": "snippet",
            "q": query,
            "type": "channel",
            "maxResults": 5,
        },
    )
    best_id: str | None = None
    best_score = 0
    for item in payload.get("items") or []:
        snippet = item.get("snippet") or {}
        channel_id = (item.get("id") or {}).get("channelId")
        title = str(snippet.get("title") or "")
        if not channel_id or not channel_id.startswith("UC"):
            continue
        score = _score_match(title, entry)
        if score > best_score:
            best_score = score
            best_id = channel_id
    return best_id if best_score >= 5 else None


def resolve_channels(
    *,
    network: str | None = None,
    team: str | None = None,
    dry_run: bool = True,
) -> dict:
    if not youtube_api_key_configured():
        return {"status": "skipped", "reason": "YOUTUBE_API_KEY not set", "resolved": 0}

    raw = yaml.safe_load(CHANNELS_PATH.read_text(encoding="utf-8")) or {}
    rows = raw.get("channels") or []
    resolved_count = 0
    errors: list[str] = []

    for row in rows:
        if not isinstance(row, dict):
            continue
        entry = ChannelEntry(
            channel_id=str(row.get("channel_id") or ""),
            team=str(row.get("team") or "").upper(),
            tier=str(row.get("tier") or "reporting"),
            weight=float(row.get("weight") or 1.0),
            label=str(row.get("label") or ""),
            network=str(row.get("network") or "locked_on"),
            search_query=str(row.get("search_query") or "") or None,
            active=bool(row.get("active", True)),
        )
        if team and entry.team != team.upper():
            continue
        if network and entry.network != network:
            continue
        if not entry.needs_resolution():
            continue
        try:
            channel_id = search_channel_id(entry)
            if channel_id:
                row["channel_id"] = channel_id
                resolved_count += 1
            else:
                errors.append(f"{entry.team}/{entry.network}: no confident match for {entry.search_query!r}")
        except Exception as exc:
            errors.append(f"{entry.team}/{entry.network}: {exc}")

    out_path = RESOLVED_PATH if dry_run else CHANNELS_PATH
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(yaml.safe_dump(raw, sort_keys=False, allow_unicode=True), encoding="utf-8")

    return {
        "status": "ok",
        "resolved": resolved_count,
        "output": str(out_path),
        "errors": errors[:20],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Overwrite channels.yaml (default: channels.resolved.yaml)")
    parser.add_argument("--network", choices=["locked_on", "sb_nation", "chat_sports"], default=None)
    parser.add_argument("--team", default=None, help="Single team code, e.g. KC")
    args = parser.parse_args()

    result = resolve_channels(network=args.network, team=args.team, dry_run=not args.apply)
    print(yaml.safe_dump(result, sort_keys=False))
    return 0 if result.get("status") != "skipped" else 1


if __name__ == "__main__":
    raise SystemExit(main())
