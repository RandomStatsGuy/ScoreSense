#!/usr/bin/env python3
"""Generate data/sentiment/channels.yaml from team franchise + SB Nation blog seeds."""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.sentiment.channels import SB_NATION_BLOG_NAMES, TEAM_FRANCHISE_NAMES  # noqa: E402

LOCKED_ON_SHORT: dict[str, str] = {
    "ARI": "Cardinals",
    "ATL": "Falcons",
    "BAL": "Ravens",
    "BUF": "Bills",
    "CAR": "Panthers",
    "CHI": "Bears",
    "CIN": "Bengals",
    "CLE": "Browns",
    "DAL": "Cowboys",
    "DEN": "Broncos",
    "DET": "Lions",
    "GB": "Packers",
    "HOU": "Texans",
    "IND": "Colts",
    "JAX": "Jaguars",
    "KC": "Chiefs",
    "LAC": "Chargers",
    "LAR": "Rams",
    "LV": "Raiders",
    "MIA": "Dolphins",
    "MIN": "Vikings",
    "NE": "Patriots",
    "NO": "Saints",
    "NYG": "Giants",
    "NYJ": "Jets",
    "PHI": "Eagles",
    "PIT": "Steelers",
    "SEA": "Seahawks",
    "SF": "49ers",
    "TB": "Buccaneers",
    "TEN": "Titans",
    "WAS": "Commanders",
}


def build_channels() -> list[dict]:
    channels: list[dict] = []
    for team in sorted(TEAM_FRANCHISE_NAMES):
        short = LOCKED_ON_SHORT[team]
        locked_query = f"Locked On {short}"
        channels.append(
            {
                "channel_id": f"UC_PLACEHOLDER_{team}",
                "team": team,
                "network": "locked_on",
                "tier": "reporting",
                "weight": 1.0,
                "label": f"Locked On {short}",
                "search_query": locked_query,
                "active": True,
            }
        )
        blog = SB_NATION_BLOG_NAMES.get(team)
        if blog:
            channels.append(
                {
                    "channel_id": f"UC_PLACEHOLDER_{team}_SBN",
                    "team": team,
                    "network": "sb_nation",
                    "tier": "fan_analysis",
                    "weight": 0.55,
                    "label": blog,
                    "search_query": f"{blog} YouTube",
                    "active": True,
                }
            )
    return channels


def main() -> int:
    out_path = ROOT / "data" / "sentiment" / "channels.yaml"
    existing_ids: dict[tuple[str, str], str] = {}
    if out_path.exists():
        prior = yaml.safe_load(out_path.read_text(encoding="utf-8")) or {}
        for row in prior.get("channels") or []:
            if not isinstance(row, dict):
                continue
            cid = str(row.get("channel_id") or "")
            if cid and not cid.startswith("UC_PLACEHOLDER"):
                key = (str(row.get("team") or "").upper(), str(row.get("network") or ""))
                existing_ids[key] = cid

    channels = build_channels()
    for row in channels:
        key = (str(row["team"]).upper(), str(row["network"]))
        if key in existing_ids:
            row["channel_id"] = existing_ids[key]

    payload = {
        "schema_version": 2,
        "channels": channels,
    }
    out_path.write_text(
        yaml.safe_dump(payload, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    print(f"Wrote {len(payload['channels'])} channel entries to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
