"""Keep optional scoring/history preparation off explicit roster-sync responses."""
from __future__ import annotations

import asyncio
from threading import Lock

from app.process_pool import submit_cpu_job
from src.ops.job_diagnostics import observe_job

_LOCK = Lock()
_PENDING: set[str] = set()


@observe_job("league_scoring_cache")
def refresh_scoring_cache(league_id):
    from app.hub_routes import _refresh_scoring_cache_for_league
    _refresh_scoring_cache_for_league(league_id)


def _finished(league_id, _future=None):
    with _LOCK:
        _PENDING.discard(league_id)


async def _refresh(league_id):
    try:
        future = asyncio.ensure_future(submit_cpu_job(refresh_scoring_cache, league_id))
    except Exception:
        _finished(league_id)
        raise
    future.add_done_callback(lambda done: _finished(league_id, done))
    await asyncio.shield(future)


def queue_scoring_cache_refresh(background_tasks, league_id):
    if background_tasks is None:
        return {"status": "idle"}
    league_id = str(league_id)
    with _LOCK:
        if league_id in _PENDING:
            return {"status": "running"}
        _PENDING.add(league_id)
    background_tasks.add_task(_refresh, league_id)
    return {"status": "queued"}
