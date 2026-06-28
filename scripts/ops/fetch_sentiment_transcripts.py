#!/usr/bin/env python3
"""Fetch transcripts for cached videos mapped to target NFL seasons."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.sentiment.transcript_backfill import fetch_transcripts_for_seasons  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025])
    parser.add_argument("--limit", type=int, default=600, help="Max transcripts to fetch")
    args = parser.parse_args()
    result = fetch_transcripts_for_seasons(args.seasons, limit=args.limit)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
