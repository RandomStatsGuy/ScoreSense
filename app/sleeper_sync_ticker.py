"""Hourly server-side roster reconciliation for Sleeper-linked leagues."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 60 * 60
DEFAULT_INITIAL_DELAY_SECONDS = 60
_run_lock = threading.Lock()


def _disabled() -> bool:
    return (
        os.environ.get("TESTING") == "1"
        or os.environ.get("SCORESENSE_DISABLE_SLEEPER_SYNC_TICKER") == "1"
    )


def _seconds(name: str, default: int) -> float:
    try:
        return max(1.0, float(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return float(default)


def sync_all_live_sleeper_leagues() -> dict[str, Any]:
    """Reconcile each linked league independently so one failure cannot stop the rest."""
    from app.hub_routes import _clear_insights_response_cache, _clear_league_rosters_cache
    from src.draft_hub import storage
    from src.draft_hub.cap_sheet_import import sync_league_rosters_and_contracts

    if not _run_lock.acquire(blocking=False):
        return {"status": "already_running", "synced": 0, "failed": 0, "leagues": []}

    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    try:
        league_ids = storage.list_live_sleeper_league_ids()
        for league_id in league_ids:
            try:
                result = sync_league_rosters_and_contracts(league_id, None, None)
                sleeper = result.get("sleeper") or {}
                merge = sleeper.get("merge") or {}
                waived = result.get("waived") or {}
                summary = {
                    "league_id": league_id,
                    "teams_synced": int(sleeper.get("teams_synced") or 0),
                    "trades_applied": int(sleeper.get("trade_count") or 0),
                    "added": int(merge.get("added") or 0),
                    "updated": int(merge.get("updated") or 0),
                    "waived": int(waived.get("waived") or 0),
                }
                results.append(summary)
                _clear_league_rosters_cache(league_id)
                _clear_insights_response_cache(league_id)
                logger.info("Hourly Sleeper roster sync complete: %s", summary)
            except Exception as exc:
                failures.append({"league_id": league_id, "error": str(exc)})
                logger.exception("Hourly Sleeper roster sync failed for %s", league_id)
        return {
            "status": "complete",
            "synced": len(results),
            "failed": len(failures),
            "leagues": results,
            "failures": failures,
        }
    finally:
        _run_lock.release()


async def sleeper_sync_ticker_loop() -> None:
    """Run shortly after boot, then once per configured hour while the API is alive."""
    if _disabled():
        return

    initial_delay = _seconds(
        "SLEEPER_ROSTER_SYNC_INITIAL_DELAY_SECONDS", DEFAULT_INITIAL_DELAY_SECONDS
    )
    interval = _seconds("SLEEPER_ROSTER_SYNC_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS)
    await asyncio.sleep(initial_delay)
    while True:
        try:
            await asyncio.to_thread(sync_all_live_sleeper_leagues)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Hourly Sleeper roster sync tick failed")
        await asyncio.sleep(interval)
