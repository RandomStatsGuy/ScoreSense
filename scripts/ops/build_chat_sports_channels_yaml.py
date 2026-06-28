#!/usr/bin/env python3
"""Generate data/sentiment/chat_sports_channels.yaml with 32 team seeds."""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.sentiment.chat_sports_channels import (  # noqa: E402
    CHAT_SPORTS_CHANNELS_PATH,
    CHAT_SPORTS_SHORT,
    search_queries_for_team,
)
from src.sentiment.channels import TEAM_FRANCHISE_NAMES  # noqa: E402

LV_CHANNEL_ID = "UC2zTXqHLEz56OG0EvS9SiFA"
LV_LABEL = "Raiders Report by Chat Sports"


def build_rows() -> list[dict]:
    rows: list[dict] = []
    for team in sorted(TEAM_FRANCHISE_NAMES):
        short = CHAT_SPORTS_SHORT[team]
        queries = search_queries_for_team(team)
        row = {
            "channel_id": f"UC_PLACEHOLDER_{team}_CS",
            "team": team,
            "network": "chat_sports",
            "tier": "reporting",
            "weight": 1.0,
            "label": f"{short} Report by Chat Sports",
            "search_queries": queries,
            "naming_variant": "unknown",
            "confidence": "unresolved",
            "active": True,
            "promote_to_features": team == "LV",
        }
        if team == "LV":
            row["channel_id"] = LV_CHANNEL_ID
            row["label"] = LV_LABEL
            row["naming_variant"] = "report"
            row["confidence"] = "high"
        rows.append(row)
    return rows


def main() -> int:
    out_path = CHAT_SPORTS_CHANNELS_PATH
    existing: dict[str, dict] = {}
    if out_path.exists():
        prior = yaml.safe_load(out_path.read_text(encoding="utf-8")) or {}
        for row in prior.get("channels") or []:
            if isinstance(row, dict) and row.get("team"):
                existing[str(row["team"]).upper()] = row

    channels = build_rows()
    for row in channels:
        team = str(row["team"]).upper()
        prior = existing.get(team)
        if not prior:
            continue
        cid = str(prior.get("channel_id") or "")
        if cid and not cid.startswith("UC_PLACEHOLDER"):
            row["channel_id"] = cid
            row["label"] = prior.get("label") or row["label"]
            row["confidence"] = prior.get("confidence") or row["confidence"]
            row["naming_variant"] = prior.get("naming_variant") or row["naming_variant"]
            row["promote_to_features"] = bool(prior.get("promote_to_features", row["promote_to_features"]))
            if prior.get("custom_url"):
                row["custom_url"] = prior["custom_url"]
            if prior.get("subscriber_count") is not None:
                row["subscriber_count"] = prior["subscriber_count"]
            if prior.get("video_count") is not None:
                row["video_count"] = prior["video_count"]

    payload = {"schema_version": 1, "channels": channels}
    out_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")
    print(f"Wrote {len(channels)} Chat Sports channel seeds to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
