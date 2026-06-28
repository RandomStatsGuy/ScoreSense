#!/usr/bin/env python3
"""Import commissioner dynasty cap sheets into Draft Hub contract history."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from src.config import OLD_LEAGUE_FILES_DIR
from src.draft_hub import storage
from src.draft_hub.legacy_contract_history import (
    import_legacy_files,
    reconcile_league_with_sleeper,
)
from src.draft_hub.legacy_contract_import import process_league_history
from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id


def _resolve_league(identifier: str) -> dict:
    league = storage.get_league(identifier)
    if league:
        return league
    league = storage.get_league_by_room_code(identifier.upper())
    if league:
        return league
    raise SystemExit(f"League not found: {identifier}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import dynasty contract history from old_league_files")
    parser.add_argument("--league", help="League UUID or room code (e.g. 0BBESQ)")
    parser.add_argument("--data-dir", type=Path, default=OLD_LEAGUE_FILES_DIR)
    parser.add_argument("--csv-only", action="store_true", help="Parse files and write CSV only (no DB)")
    parser.add_argument("--csv-out", type=Path, default=Path("ScoreSense_Contract_History.csv"))
    parser.add_argument("--reconcile-sleeper", action="store_true", help="Cross-check trades/waivers with Sleeper")
    parser.add_argument("--imported-by", default="cli")
    args = parser.parse_args(argv)

    if args.csv_only:
        df = process_league_history(args.data_dir)
        df.to_csv(args.csv_out, index=False)
        print(f"Wrote {len(df)} rows to {args.csv_out}")
        return 0

    if not args.league:
        parser.error("--league is required unless --csv-only is set")

    league = _resolve_league(args.league)
    league_id = str(league["id"])
    result = import_legacy_files(
        league_id,
        data_dir=args.data_dir,
        imported_by_sub=args.imported_by,
    )
    print(f"Imported {result['imported']} rows across seasons {result.get('seasons')}")
    if result.get("parquet_path"):
        print(f"Parquet: {result['parquet_path']}")

    if args.reconcile_sleeper:
        sleeper_lid = resolve_sleeper_league_id(league_id) or league.get("sleeper_league_id")
        if not sleeper_lid:
            print("No Sleeper league linked — skip reconcile", file=sys.stderr)
        else:
            rec = reconcile_league_with_sleeper(league_id, str(sleeper_lid))
            print(f"Sleeper reconcile: {rec}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
