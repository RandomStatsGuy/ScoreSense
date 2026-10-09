"""Server-owned inference refresh using the shared CPU executor."""
import asyncio
import logging
from src.config import DFS_CHECK_SECONDS, DFS_REFRESH_ENABLED
from src.jobs.dfs_refresh import run_dfs_refresh, dfs_refresh_needed
from app.process_pool import submit_cpu_job, cpu_jobs_busy

async def dfs_refresh_ticker_loop():
    if not DFS_REFRESH_ENABLED:
        return
    await asyncio.sleep(30)
    while True:
        try:
            if not cpu_jobs_busy() and await asyncio.to_thread(dfs_refresh_needed) and not cpu_jobs_busy():
                await asyncio.shield(submit_cpu_job(run_dfs_refresh))
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.getLogger(__name__).exception("DFS refresh worker failed")
        # Checks are cheap; the job itself decides whether a pass is due.
        await asyncio.sleep(30 if cpu_jobs_busy() else DFS_CHECK_SECONDS)
