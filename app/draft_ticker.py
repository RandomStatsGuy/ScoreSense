"""Server-side auction clock — SCORE-58.

Bid and nomination deadlines must expire even when no browser is polling.
"""

from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

_TICK_SEC = 1.0


def _ticker_disabled() -> bool:
    return os.environ.get("TESTING") == "1" or os.environ.get("SCORESENSE_DISABLE_DRAFT_TICKER") == "1"


async def draft_ticker_loop() -> None:
    from app.hub_routes import broadcast_room
    from src.draft_hub.draft_state import tick_expired_drafts

    if _ticker_disabled():
        return

    while True:
        await asyncio.sleep(_TICK_SEC)
        try:
            changed = tick_expired_drafts()
            for league_id in changed:
                try:
                    await broadcast_room(league_id)
                except Exception:
                    logger.exception("Draft ticker broadcast failed for %s", league_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Draft ticker tick failed")
