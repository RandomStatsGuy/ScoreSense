#!/usr/bin/env python3
"""Fetch Locked On YouTube channel IDs from public @handle pages (no API key)."""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

LOCKED_ON_SHORT = {
    "ARI": "Cardinals", "ATL": "Falcons", "BAL": "Ravens", "BUF": "Bills",
    "CAR": "Panthers", "CHI": "Bears", "CIN": "Bengals", "CLE": "Browns",
    "DAL": "Cowboys", "DEN": "Broncos", "DET": "Lions", "GB": "Packers",
    "HOU": "Texans", "IND": "Colts", "JAX": "Jaguars", "KC": "Chiefs",
    "LAC": "Chargers", "LAR": "Rams", "LV": "Raiders", "MIA": "Dolphins",
    "MIN": "Vikings", "NE": "Patriots", "NO": "Saints", "NYG": "Giants",
    "NYJ": "Jets", "PHI": "Eagles", "PIT": "Steelers", "SEA": "Seahawks",
    "SF": "49ers", "TB": "Buccaneers", "TEN": "Titans", "WAS": "Commanders",
}

HANDLE_OVERRIDES = {
    "GB": "LockedOnPackers",
    "LAR": "LockedOnRams",
    "LAC": "LockedOnChargers",
    "LV": "LockedOnRaiders",
    "NE": "LockedOnPatriots",
    "NO": "LockedOnSaints",
    "NYG": "LockedOnGiantsNFL",
    "NYJ": "LockedOnJetsNFL",
    "SF": "LockedOn49ers",
    "TB": "LockedOnBucs",
    "WAS": "LockedOnCommanders",
}


def locked_on_handle(team: str) -> str:
    if team in HANDLE_OVERRIDES:
        return HANDLE_OVERRIDES[team]
    short = LOCKED_ON_SHORT[team]
    compact = short.replace(" ", "")
    return f"LockedOn{compact}"


def fetch_channel_id(handle: str) -> str | None:
    url = f"https://www.youtube.com/@{handle}"
    resp = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    match = re.search(
        r'canonical" href="https://www\.youtube\.com/channel/(UC[^"]+)"',
        resp.text,
    )
    if match:
        return match.group(1)
    match = re.search(r'"externalId":"(UC[^"]+)"', resp.text)
    return match.group(1) if match else None


def main() -> int:
    mapping: dict[str, str] = {}
    errors: list[str] = []
    for team in sorted(LOCKED_ON_SHORT):
        handle = locked_on_handle(team)
        try:
            cid = fetch_channel_id(handle)
            if cid:
                mapping[team] = cid
                print(f"{team}: {cid} (@{handle})")
            else:
                errors.append(f"{team}: no channelId in page for @{handle}")
        except Exception as exc:
            errors.append(f"{team}: {exc}")
        time.sleep(0.3)

    out = ROOT / "data" / "sentiment" / "locked_on_channel_ids.json"
    out.write_text(json.dumps(mapping, indent=2), encoding="utf-8")
    print(f"\nWrote {len(mapping)} IDs to {out}")
    if errors:
        print("Errors:", errors)
    return 0 if len(mapping) >= 28 else 1


if __name__ == "__main__":
    raise SystemExit(main())
