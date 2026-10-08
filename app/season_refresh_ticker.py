"""Check forecast maintenance deadlines off the HTTP path; serialize all inference."""
import asyncio
import logging
import time
from src.config import PROJECTION_AUTO_REFRESH_ENABLED, WEEKLY_AUTO_REFRESH_SECONDS
from src.jobs.season_refresh import run_season_refresh
from app.process_pool import submit_cpu_job

CHECK_SECONDS = 300


def next_check_seconds(now=None):
    """Wake every five minutes, and just after each weekly build boundary."""
    clock = time.time() if now is None else now
    return min(CHECK_SECONDS, WEEKLY_AUTO_REFRESH_SECONDS - clock % WEEKLY_AUTO_REFRESH_SECONDS + 5)


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
        await asyncio.sleep(next_check_seconds())
