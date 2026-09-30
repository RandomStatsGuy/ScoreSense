"""Native scoring refreshes use the application's shared CPU worker."""
import asyncio
import logging
from app.process_pool import submit_cpu_job
from src.config import NATIVE_SCORING_REFRESH_ENABLED
from src.draft_hub.native_score_refresh import CADENCE_SECONDS, queue_current_native_weeks, refresh_pending_scores


async def native_scoring_ticker_loop():
    if not NATIVE_SCORING_REFRESH_ENABLED:
        return
    while True:
        started = asyncio.get_running_loop().time()
        try:
            await asyncio.to_thread(queue_current_native_weeks)
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.getLogger(__name__).exception('Native scoring scheduler tick failed')
        try:
            await submit_cpu_job(refresh_pending_scores)
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.getLogger(__name__).exception('Native scoring worker tick failed')
        await asyncio.sleep(max(1, CADENCE_SECONDS - (asyncio.get_running_loop().time() - started)))
