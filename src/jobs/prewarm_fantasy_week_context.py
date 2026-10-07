"""Prepare existing weekly artifacts for Fantasy reads without live inference."""
import argparse
import json

from src.draft_hub.prepared_week_context import prewarm_week_context, refresh_week_contexts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int)
    parser.add_argument("--week", type=int)
    args = parser.parse_args()
    if (args.season is None) != (args.week is None):
        parser.error("Specify both --season and --week, or neither for all existing contexts.")
    result = (prewarm_week_context(args.season, args.week) if args.season is not None
              else refresh_week_contexts(max_preparations=None, history=True))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
