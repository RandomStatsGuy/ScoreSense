"""Coalesce missing league valuations on the shared inference worker."""
from __future__ import annotations

import asyncio
import time
from threading import Lock

from app.process_pool import submit_cpu_job
from src.draft_hub.insights_cache import prepare_league_fair_values

_LOCK = Lock()
_ACTIVE: set[tuple] = set()
_RESULTS: dict[tuple, tuple[float, dict]] = {}
RETRY_SECONDS = 60


def _finished(key, future):
    try:
        result = future.result()
    except (Exception, asyncio.CancelledError):
        result = {"status": "error"}
    with _LOCK:
        _ACTIVE.discard(key)
        _RESULTS[key] = (time.monotonic(), result)
        while len(_RESULTS) > 256:
            del _RESULTS[min(_RESULTS, key=lambda key: _RESULTS[key][0])]


async def _prepare(key):
    try:
        future = asyncio.ensure_future(submit_cpu_job(prepare_league_fair_values, key[0], key[1]))
    except Exception as exc:
        future = asyncio.get_running_loop().create_future()
        future.set_exception(exc)
    future.add_done_callback(lambda done: _finished(key, done))
    await asyncio.shield(future)


def queue_fair_value_recovery(background_tasks, league_id, season, source_version):
    if background_tasks is None or not season:
        return {"status": "idle"}
    key = (str(league_id), int(season), str(source_version))
    with _LOCK:
        if key in _ACTIVE:
            return {"status": "running"}
        previous = _RESULTS.get(key)
        if previous and time.monotonic() - previous[0] < RETRY_SECONDS:
            return previous[1]
        _ACTIVE.add(key)
    background_tasks.add_task(_prepare, key)
    return {"status": "queued"}
