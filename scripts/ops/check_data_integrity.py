"""Inspect local saved data; exit nonzero for errors (or warnings with --strict)."""
import argparse
import json

from src.projections.data_integrity import audit_projection_integrity


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--player-id", action="append", default=[])
    parser.add_argument("--no-injury-adjustments", action="store_true")
    parser.add_argument("--strict", action="store_true", help="also fail on incomplete/unverified coverage")
    args = parser.parse_args()
    report = audit_projection_integrity(season=args.season, week=args.week, player_ids=args.player_id,
        apply_injury_adjustments=not args.no_injury_adjustments)
    print(json.dumps(report, indent=2, default=str, allow_nan=False))
    return int(report["status"] == "failed" or (args.strict and report["status"] != "passed"))


if __name__ == "__main__":
    raise SystemExit(main())
