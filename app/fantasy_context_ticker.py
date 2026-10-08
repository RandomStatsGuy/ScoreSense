"""The live worker maintains prepared Fantasy snapshots as source files change."""
import asyncio
import logging

from app.process_pool import submit_live_job
from src.draft_hub.prepared_week_context import CADENCE_SECONDS, refresh_week_contexts


async def fantasy_context_ticker_loop():
    while True:
        started = asyncio.get_running_loop().time()
        try:
            await submit_live_job(refresh_week_contexts)
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.getLogger(__name__).exception("Fantasy context worker tick failed")
        await asyncio.sleep(max(1, CADENCE_SECONDS - (asyncio.get_running_loop().time() - started)))
