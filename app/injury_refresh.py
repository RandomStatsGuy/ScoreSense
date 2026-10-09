"""Coalesce injury work before submitting it to the existing inference worker."""
from threading import Lock
import asyncio

from app.process_pool import submit_cpu_job
from src.integrations.injury_poll import run_injury_poll

_LOCK = Lock()
_PENDING = False


def _finished(_future=None):
    global _PENDING
    with _LOCK:
        _PENDING = False


async def _refresh(force, trigger):
    try:
        future = asyncio.ensure_future(submit_cpu_job(run_injury_poll, force, True, trigger))
    except Exception:
        _finished()
        raise
    future.add_done_callback(_finished)
    await asyncio.shield(future)


def queue_injury_refresh(background_tasks, *, force=False, trigger="scheduled"):
    global _PENDING
    if background_tasks is None:
        return {"status": "idle"}
    with _LOCK:
        if _PENDING:
            return {"status": "running"}
        _PENDING = True
    background_tasks.add_task(_refresh, force, trigger)
    return {"status": "queued"}
