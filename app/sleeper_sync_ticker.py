"""Server-side roster reconciliation for Sleeper-linked leagues.

Every minute, one Sleeper request per league fingerprints who is on which roster;
a changed fingerprint runs the full reconciliation right away. Every league is
still reconciled hourly regardless.
"""

from __future__ import annotations

from src.ops.job_diagnostics import observe_job, annotate_job, submit_thread_job

import asyncio
import hashlib
import json
import logging
import os
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 60 * 60
DEFAULT_CHECK_INTERVAL_SECONDS = 60
DEFAULT_INITIAL_DELAY_SECONDS = 60
FAILED_SYNC_RETRY_SECONDS = 10 * 60
_run_lock = threading.Lock()
# Process-local: a restart starts with the full reconciliation, which refills these.
_fingerprints: dict[str, str] = {}
_retry_after: dict[str, float] = {}


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


def sleeper_roster_fingerprint(sleeper_league_id: str) -> str:
    """Hash of each roster's owner and players (including taxi and reserve)."""
    from src.integrations.sleeper_league import _roster_player_ids, fetch_league_rosters

    rosters = fetch_league_rosters(sleeper_league_id)
    if not isinstance(rosters, list):
        raise ValueError("Sleeper returned no rosters")
    shape = sorted(
        [str(r.get("roster_id")), str(r.get("owner_id") or ""), sorted(_roster_player_ids(r))]
        for r in rosters
    )
    return hashlib.sha256(json.dumps(shape).encode()).hexdigest()


def _league_fingerprint(league_id: str) -> str | None:
    from src.draft_hub import storage

    try:
        sleeper_id = str((storage.get_league(league_id) or {}).get("sleeper_league_id") or "").strip()
        return sleeper_roster_fingerprint(sleeper_id) if sleeper_id else None
    except Exception:
        logger.info("Sleeper roster fingerprint unavailable for %s", league_id, exc_info=True)
        return None


@observe_job("sleeper_rosters")
def sync_all_live_sleeper_leagues(
    league_ids: list[str] | None = None,
    fingerprints: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Reconcile each linked league independently so one failure cannot stop the rest."""
    from app.hub_routes import _clear_insights_response_cache, _clear_league_rosters_cache
    from src.draft_hub import storage
    from src.draft_hub.cap_sheet_import import sync_league_rosters_and_contracts

    annotate_job(cadence_s=_seconds("SLEEPER_ROSTER_SYNC_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS))

    if not _run_lock.acquire(blocking=False):
        return {"status": "already_running", "synced": 0, "failed": 0, "leagues": []}

    results: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    try:
        if league_ids is None:
            league_ids = storage.list_live_sleeper_league_ids()
        annotate_job(checked=len(league_ids))
        for league_id in league_ids:
            fingerprint = (fingerprints or {}).get(league_id) or _league_fingerprint(league_id)
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
                if fingerprint:
                    _fingerprints[league_id] = fingerprint
                _retry_after.pop(league_id, None)
                _clear_league_rosters_cache(league_id)
                _clear_insights_response_cache(league_id)
                logger.info("Sleeper roster sync complete: %s", summary)
            except Exception as exc:
                _retry_after[league_id] = time.monotonic() + FAILED_SYNC_RETRY_SECONDS
                failures.append({"league_id": league_id, "error": str(exc)})
                logger.exception("Sleeper roster sync failed for %s", league_id)
        annotate_job(added=sum(r["added"] for r in results), updated=sum(r["updated"] for r in results),
                     waived=sum(r["waived"] for r in results), trades_applied=sum(r["trades_applied"] for r in results))
        return {
            "status": "complete",
            "synced": len(results),
            "failed": len(failures),
            "leagues": results,
            "failures": failures,
        }
    finally:
        _run_lock.release()


@observe_job("sleeper_rosters.check")
def sync_changed_sleeper_leagues() -> dict[str, Any]:
    """Reconcile only leagues whose Sleeper rosters changed since their last sync."""
    from src.draft_hub import storage

    annotate_job(cadence_s=_seconds("SLEEPER_ROSTER_CHECK_INTERVAL_SECONDS", DEFAULT_CHECK_INTERVAL_SECONDS))
    if _run_lock.locked():
        return {"status": "already_running", "checked": 0}
    now = time.monotonic()
    league_ids = storage.list_live_sleeper_league_ids()
    changed: dict[str, str] = {}
    for league_id in league_ids:
        if _retry_after.get(league_id, 0) > now:
            continue
        fingerprint = _league_fingerprint(league_id)
        if fingerprint and fingerprint != _fingerprints.get(league_id):
            changed[league_id] = fingerprint
    if not changed:
        return {"status": "unchanged", "checked": len(league_ids)}
    result = sync_all_live_sleeper_leagues(list(changed), changed)
    return {**result, "checked": len(league_ids), "changed": len(changed)}


async def sleeper_sync_ticker_loop() -> None:
    """Full reconciliation shortly after boot and hourly; change checks in between."""
    if _disabled():
        return

    initial_delay = _seconds(
        "SLEEPER_ROSTER_SYNC_INITIAL_DELAY_SECONDS", DEFAULT_INITIAL_DELAY_SECONDS
    )
    interval = _seconds("SLEEPER_ROSTER_SYNC_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS)
    check_interval = min(interval, _seconds(
        "SLEEPER_ROSTER_CHECK_INTERVAL_SECONDS", DEFAULT_CHECK_INTERVAL_SECONDS
    ))
    await asyncio.sleep(initial_delay)
    next_full = 0.0
    while True:
        try:
            if time.monotonic() >= next_full:
                next_full = time.monotonic() + interval
                await submit_thread_job(sync_all_live_sleeper_leagues)
            else:
                await submit_thread_job(sync_changed_sleeper_leagues)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Sleeper roster sync tick failed")
        await asyncio.sleep(check_interval)
