"""Server-owned inference refresh using the shared CPU executor."""
import asyncio
import logging
from src.config import DFS_REFRESH_ENABLED, DFS_REFRESH_SECONDS
from src.jobs.dfs_refresh import run_dfs_refresh
from app.process_pool import submit_cpu_job

async def dfs_refresh_ticker_loop():
    if not DFS_REFRESH_ENABLED:
        return
    await asyncio.sleep(30)
    while True:
        try:
            await submit_cpu_job(run_dfs_refresh)
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.getLogger(__name__).exception("DFS refresh worker failed")
        # Leave a full quiet interval even when inference exceeds the interval.
        await asyncio.sleep(DFS_REFRESH_SECONDS)
