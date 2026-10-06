"""Check forecast maintenance deadlines off the HTTP path; serialize all inference."""
import asyncio
import logging
from src.config import PROJECTION_AUTO_REFRESH_ENABLED
from src.jobs.season_refresh import run_season_refresh
from app.process_pool import submit_cpu_job


async def season_refresh_ticker_loop():
    if not PROJECTION_AUTO_REFRESH_ENABLED:
        return
    await asyncio.sleep(60)
    while True:
        try:
            await submit_cpu_job(run_season_refresh)
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.getLogger(__name__).exception("Automatic season refresh worker failed")
        await asyncio.sleep(300)
