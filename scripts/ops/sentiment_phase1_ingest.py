#!/usr/bin/env python3
"""Phase 1 sentiment ingest: SB Nation ID resolve + transcript backfill + refresh."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.integrations.youtube import youtube_api_key_configured  # noqa: E402
from src.jobs.sentiment_refresh import run_sentiment_refresh  # noqa: E402


def _run_resolve_sb_nation(apply: bool) -> dict:
    if not youtube_api_key_configured():
        return {"status": "skipped", "reason": "YOUTUBE_API_KEY not set"}
    cmd = [
        sys.executable,
        str(ROOT / "scripts" / "ops" / "resolve_youtube_channels.py"),
        "--network",
        "sb_nation",
    ]
    if apply:
        cmd.append("--apply")
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT))
    return {
        "status": "ok" if proc.returncode == 0 else "error",
        "returncode": proc.returncode,
        "stdout": proc.stdout[-2000:] if proc.stdout else "",
        "stderr": proc.stderr[-1000:] if proc.stderr else "",
        "apply": apply,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--week", type=int, default=None)
    parser.add_argument("--lookback-days", type=int, default=int(os.getenv("SENTIMENT_LOOKBACK_DAYS", "14")))
    parser.add_argument("--transcript-limit", type=int, default=2000)
    parser.add_argument("--resolve-sb-nation", action="store_true", help="Resolve SB Nation channel IDs via YouTube API")
    parser.add_argument("--apply-sb-nation", action="store_true", help="Write resolved SB Nation IDs to channels.yaml")
    parser.add_argument("--skip-ingest", action="store_true")
    parser.add_argument("--skip-transcripts", action="store_true")
    args = parser.parse_args()

    report: dict = {"phase": "sentiment_phase1_ingest"}

    if args.resolve_sb_nation or args.apply_sb_nation:
        report["sb_nation_resolve"] = _run_resolve_sb_nation(apply=args.apply_sb_nation)

    report["sentiment_refresh"] = run_sentiment_refresh(
        season=args.season,
        week=args.week,
        lookback_days=args.lookback_days,
        skip_ingest=args.skip_ingest,
        fetch_transcripts=not args.skip_transcripts,
        transcript_limit=args.transcript_limit,
    )

    out_path = ROOT / "artifacts" / "analytics" / "sentiment_phase1_ingest.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
