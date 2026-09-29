#!/usr/bin/env python3
"""Undo the 2026-09-23 hourly-sync waiver bug.

The waiver pass compared hub player ids to Sleeper snapshot ids by exact
string, so rows stored with a bare Sleeper id ("6904") were waived even though
the snapshot listed the same player as GSIS or ``sleeper-6904``. This restores
waived rows whose player is still on the same team's Sleeper roster.

Run with --dry-run first:
    python scripts/ops/restore_wrongly_waived.py --dry-run
    python scripts/ops/restore_wrongly_waived.py --replace-sync-duplicates --dry-run
    python scripts/ops/restore_wrongly_waived.py
    python scripts/ops/restore_wrongly_waived.py --league <league_id>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.draft_hub import storage
from src.draft_hub.cap_sheet_import import restore_wrongly_waived_players


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--league", help="Only this league id (default: every live Sleeper league)")
    parser.add_argument("--dry-run", action="store_true", help="Report without writing")
    parser.add_argument(
        "--replace-sync-duplicates",
        action="store_true",
        help="Also delete the $1 Sleeper pickup rows the buggy sync created and restore the real contract",
    )
    args = parser.parse_args()

    league_ids = [args.league] if args.league else storage.list_live_sleeper_league_ids()
    total = 0
    for league_id in league_ids:
        try:
            result = restore_wrongly_waived_players(
                league_id,
                dry_run=args.dry_run,
                replace_sync_duplicates=args.replace_sync_duplicates,
            )
        except Exception as exc:  # keep going across leagues
            print(json.dumps({"league_id": league_id, "error": str(exc)}))
            continue
        total += int(result.get("restored") or 0)
        print(json.dumps({"league_id": league_id, **result}, default=str))
    verb = "Would restore" if args.dry_run else "Restored"
    print(f"{verb} {total} roster rows across {len(league_ids)} leagues.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
