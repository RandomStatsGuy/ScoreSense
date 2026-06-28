#!/usr/bin/env python3
"""Apply locked_on_channel_ids.json (and optional sb_nation ids) to channels.yaml."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CHANNELS_PATH = ROOT / "data" / "sentiment" / "channels.yaml"
LOCKED_ON_IDS = ROOT / "data" / "sentiment" / "locked_on_channel_ids.json"


def main() -> int:
    if not LOCKED_ON_IDS.exists():
        print(f"Missing {LOCKED_ON_IDS}; run fetch_locked_on_ids.py first")
        return 1

    locked_on = json.loads(LOCKED_ON_IDS.read_text(encoding="utf-8"))
    raw = yaml.safe_load(CHANNELS_PATH.read_text(encoding="utf-8")) or {}
    updated = 0
    for row in raw.get("channels") or []:
        if not isinstance(row, dict):
            continue
        team = str(row.get("team") or "").upper()
        network = str(row.get("network") or "")
        if network == "locked_on" and team in locked_on:
            row["channel_id"] = locked_on[team]
            updated += 1

    CHANNELS_PATH.write_text(yaml.safe_dump(raw, sort_keys=False, allow_unicode=True), encoding="utf-8")
    print(f"Applied {updated} Locked On channel IDs to {CHANNELS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
