#!/usr/bin/env python3
"""Import a commissioner cap sheet TSV into a Draft Hub league."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.draft_hub import storage
from src.draft_hub.cap_sheet_import import (
    import_cap_sheet_to_league,
    parse_cap_sheet_tsv,
    sync_league_rosters_and_contracts,
)
from src.draft_hub.schemas import LeagueRules


def _load_manager_map(path: Path) -> dict[str, str]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {str(k): str(v) for k, v in data.items()}


def _resolve_league(league_id: str | None, room_code: str | None) -> str:
    if league_id:
        return league_id
    if room_code:
        with storage.get_conn() as conn:
            row = conn.execute(
                "SELECT id FROM league WHERE room_code = ? ORDER BY created_at DESC LIMIT 1",
                (room_code.strip().upper(),),
            ).fetchone()
        if not row:
            raise SystemExit(f"No league found with room code {room_code}")
        return str(row["id"])
    with storage.get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM league ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    if not row:
        raise SystemExit("No league found in draft hub DB")
    return str(row["id"])


def main() -> None:
    ap = argparse.ArgumentParser(description="Import cap sheet TSV into Draft Hub league")
    ap.add_argument("tsv", type=Path, help="Tab-separated cap sheet file")
    ap.add_argument("--league-id", help="Draft Hub league UUID (default: latest league)")
    ap.add_argument("--room-code", help="Resolve league by room code (e.g. 0BBESQ)")
    ap.add_argument(
        "--map",
        type=Path,
        default=ROOT / "data" / "draft_hub" / "manager_team_map.yaml",
        help="Manager abbrev -> hub team name YAML",
    )
    ap.add_argument("--season", type=int, default=2025)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--sync-sleeper",
        action="store_true",
        help="Pull live Sleeper rosters, overlay contracts from sheet, waive dropped players",
    )
    ap.add_argument(
        "--contracts-only",
        action="store_true",
        help="Same as --sync-sleeper (do not wipe rosters)",
    )
    args = ap.parse_args()

    league_id = _resolve_league(args.league_id, args.room_code)
    league = storage.get_league(league_id)
    if not league:
        raise SystemExit(f"League not found: {league_id}")

    raw = args.tsv.read_bytes()
    rules = LeagueRules.model_validate(league["rules"])
    parsed = parse_cap_sheet_tsv(raw, season=args.season, rules=rules)
    manager_map = _load_manager_map(args.map)

    print(f"League: {league.get('name')} ({league_id})")
    print(f"Matched rows: {parsed['stats'].get('matched', 0)}")
    print(f"Teams in sheet: {', '.join(parsed.get('teams_found') or [])}")
    if parsed.get("unmatched"):
        print(f"Unmatched ({len(parsed['unmatched'])}):")
        for name in parsed["unmatched"][:25]:
            print(f"  - {name}")
        if len(parsed["unmatched"]) > 25:
            print(f"  ... and {len(parsed['unmatched']) - 25} more")

    if args.dry_run:
        return

    if args.sync_sleeper or args.contracts_only:
        result = sync_league_rosters_and_contracts(league_id, parsed, manager_map)
        print("Sleeper:", result["sleeper"].get("message"))
        c = result.get("contracts") or {}
        print(f"Contracts updated {c.get('updated', 0)}, added {c.get('added', 0)}, moved {c.get('moved', 0)}")
        print("Waived not on Sleeper:", result.get("waived"))
        return

    result = import_cap_sheet_to_league(
        league_id,
        parsed,
        manager_map,
        replace_existing=True,
        historic_season=args.season,
    )
    print(f"Imported {result['imported']} roster rows")
    for team, n in sorted(result.get("by_team", {}).items()):
        print(f"  {team}: {n}")
    if result.get("historic"):
        print(f"Historic {args.season} contract rows: {result['historic']}")
    if result.get("skipped_cut_elsewhere"):
        print("CUT skipped (player already on another team):")
        for item in result["skipped_cut_elsewhere"]:
            print(f"  - {item}")
    if result.get("skipped_managers"):
        print("Skipped (no team map):", ", ".join(result["skipped_managers"]))


if __name__ == "__main__":
    main()
