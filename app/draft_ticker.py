"""Server-side auction clock — SCORE-58.

Bid and nomination deadlines must expire even when no browser is polling.
"""

from __future__ import annotations

from src.ops.job_diagnostics import submit_thread_job

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

_TICK_SEC = 1.0
# With no unpaused draft running, only scheduled starts need checking.
_IDLE_TICK_SEC = 5.0
# Practice rooms nobody has open for this long pause until someone returns.
PRACTICE_IDLE_PAUSE_SEC = 300.0


def _ticker_disabled() -> bool:
    return os.environ.get("TESTING") == "1" or os.environ.get("SCORESENSE_DISABLE_DRAFT_TICKER") == "1"


async def draft_ticker_loop() -> None:
    from app.hub_routes import broadcast_room
    from src.draft_hub import storage
    from src.draft_hub.draft_state import tick_expired_drafts
    from src.draft_hub.ws_manager import draft_room_manager

    if _ticker_disabled():
        return

    delay = _TICK_SEC
    while True:
        await asyncio.sleep(delay)
        try:
            # Clock work uses SQLite and may run bot/player selection. Keep it
            # off the event loop that accepts and completes HTTP requests.
            watched = draft_room_manager.watched_league_ids(PRACTICE_IDLE_PAUSE_SEC)
            changed = await submit_thread_job(tick_expired_drafts, watched)
            for league_id in changed:
                try:
                    await broadcast_room(league_id)
                except Exception:
                    logger.exception("Draft ticker broadcast failed for %s", league_id)
            running = changed or await asyncio.to_thread(storage.list_in_progress_draft_league_ids)
            delay = _TICK_SEC if running else _IDLE_TICK_SEC
        except asyncio.CancelledError:
            raise
        except Exception:
            delay = _TICK_SEC
            logger.exception("Draft ticker tick failed")
