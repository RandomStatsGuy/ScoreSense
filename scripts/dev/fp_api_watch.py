"""Poll FantasyPros until rate limit clears, then backfill missing cache + enrich mlready."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config import CACHE_DIR, DEFAULT_FP_ARCHIVE_SEASONS, _load_dotenv
from src.integrations.fantasypros import (
    FP_CACHE_DIR,
    REGULAR_WEEKS,
    fantasypros_api_key_configured,
    load_fp_players_catalog,
    prefetch_missing_fp_weeks,
)
from src.integrations.fantasypros_enrich import enrich_all_mlready

STATUS_PATH = CACHE_DIR / "fantasypros_api_status.json"
PROBE_URL = "https://api.fantasypros.com/public/v2/json/nfl/2025/projections"
PROBE_PARAMS = {"week": 1, "scoring": "PPR", "positions": "QB"}
POST_READY_PAUSE_SEC = 30


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write_status(payload: dict) -> None:
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _probe_api(api_key: str) -> tuple[int, int | None, str | None]:
    response = requests.get(
        PROBE_URL,
        headers={"x-api-key": api_key},
        params=PROBE_PARAMS,
        timeout=30,
    )
    if response.status_code == 200:
        players = len(response.json().get("players") or [])
        return 200, players, None
    return response.status_code, None, response.text[:200]


def _seasons_needing_cache() -> list[int]:
    """2025 first, then other archive seasons with missing projection weeks."""
    ordered: list[int] = []
    if 2025 not in DEFAULT_FP_ARCHIVE_SEASONS:
        ordered.append(2025)
    for season in DEFAULT_FP_ARCHIVE_SEASONS:
        if season not in ordered:
            ordered.append(season)

    needs: list[int] = []
    for season in ordered:
        missing = sum(
            1
            for week in REGULAR_WEEKS
            if not (FP_CACHE_DIR / f"{season}_week{week:02d}_proj.parquet").exists()
        )
        if missing:
            needs.append(season)
    return needs


def _maybe_fetch_players_catalog() -> bool:
    if (FP_CACHE_DIR / "players_catalog.parquet").exists():
        return False
    print("Fetching FP players catalog (optional)...", flush=True)
    try:
        load_fp_players_catalog()
        return True
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 429:
            print("  players catalog rate-limited; skipping for now", flush=True)
            return False
        raise


def _run_backfill(seasons: list[int]) -> dict:
    stats: dict = {"seasons": [], "players_catalog": _maybe_fetch_players_catalog()}

    for season in seasons:
        print(f"Backfilling missing FP weeks for {season}...", flush=True)
        season_stats = prefetch_missing_fp_weeks(season, include_rankings=True)
        stats["seasons"].append(season_stats)
        if season_stats.get("errors", 0):
            print(f"  {season}: {season_stats}", flush=True)

    return stats


def watch_and_backfill(poll_sec: int = 300) -> None:
    _load_dotenv()
    if not fantasypros_api_key_configured():
        _write_status(
            {
                "checked_at": _utc_now(),
                "ready": False,
                "error": "FANTASYPROS_API_KEY not set",
                "phase": "stopped",
            }
        )
        raise SystemExit("FANTASYPROS_API_KEY not set")

    api_key = __import__("os").environ["FANTASYPROS_API_KEY"].strip()
    attempt = 0
    all_backfill_stats: list[dict] = []

    while True:
        seasons = _seasons_needing_cache()
        if not seasons:
            enrich_seasons = list(DEFAULT_FP_ARCHIVE_SEASONS)
            if 2025 not in enrich_seasons:
                enrich_seasons.append(2025)
            print("Enriching mlready with FP columns...", flush=True)
            enrich_stats = enrich_all_mlready(seasons=enrich_seasons)
            _write_status(
                {
                    "checked_at": _utc_now(),
                    "ready": True,
                    "phase": "complete",
                    "status_code": 200,
                    "backfill_rounds": all_backfill_stats,
                    "enrich_matched_rows": enrich_stats,
                }
            )
            print("FP_PREFETCH_COMPLETE", flush=True)
            return

        attempt += 1
        try:
            code, players, err = _probe_api(api_key)
        except Exception as exc:
            code, players, err = -1, None, str(exc)

        ready = code == 200
        _write_status(
            {
                "checked_at": _utc_now(),
                "attempt": attempt,
                "status_code": code,
                "ready": ready,
                "players": players,
                "error": err,
                "next_check_sec": poll_sec,
                "phase": "watching" if not ready else "backfilling",
                "seasons_planned": seasons,
            }
        )
        print(f"FP_API_CHECK attempt={attempt} status={code} ready={ready}", flush=True)

        if not ready:
            time.sleep(poll_sec)
            continue

        print(f"FP_API_READY — pausing {POST_READY_PAUSE_SEC}s then backfilling", flush=True)
        time.sleep(POST_READY_PAUSE_SEC)

        try:
            round_stats = _run_backfill(seasons)
            all_backfill_stats.append(round_stats)
            remaining = _seasons_needing_cache()
            if remaining:
                print(
                    f"FP_BACKFILL_PARTIAL — {len(remaining)} seasons still missing weeks; resuming watch",
                    flush=True,
                )
                _write_status(
                    {
                        "checked_at": _utc_now(),
                        "ready": False,
                        "phase": "watching",
                        "seasons_remaining": remaining,
                        "backfill_rounds": all_backfill_stats,
                    }
                )
                time.sleep(poll_sec)
                continue
        except Exception as exc:
            print(f"FP_BACKFILL_ERROR: {exc} — resuming watch", flush=True)
            _write_status(
                {
                    "checked_at": _utc_now(),
                    "ready": False,
                    "phase": "watching",
                    "last_backfill_error": str(exc),
                    "seasons_planned": seasons,
                    "backfill_rounds": all_backfill_stats,
                }
            )
            time.sleep(poll_sec)


def main() -> None:
    parser = argparse.ArgumentParser(description="Watch FP API and auto-backfill on unblock")
    parser.add_argument("--poll-sec", type=int, default=300)
    args = parser.parse_args()
    watch_and_backfill(poll_sec=args.poll_sec)


if __name__ == "__main__":
    main()
