"""Coalesce automatic recovery requests onto the existing shared CPU executor."""
from __future__ import annotations

import math
import time
from threading import Lock

from app.process_pool import submit_cpu_job
from src.jobs.projection_recovery import rebuild_projection_context

_LOCK = Lock()
_ACTIVE: set[tuple] = set()
_RESULTS: dict[tuple, tuple[float, dict]] = {}
RETRY_SECONDS = 900


def projection_recovery_status(season, week, kinds):
    """Observe the shared worker without enqueueing work or changing its state."""
    if not kinds or not season or not week:
        return {"status": "idle"}
    key = (int(season), int(week), tuple(sorted(set(kinds))))
    from src.jobs.season_refresh import target_due
    if all(kind in {"draft", "ros"} for kind in kinds) and not any(
        target_due(kind, int(season), int(week)) for kind in kinds
    ):
        return {"status": "scheduled"}
    with _LOCK:
        if key in _ACTIVE:
            return {"status": "running"}
        previous = _RESULTS.get(key)
        if previous:
            retry = max(0, math.ceil(RETRY_SECONDS - (time.monotonic() - previous[0])))
            return {**previous[1], "retry_after_seconds": retry}
    return {"status": "idle"}


async def _rebuild(key):
    result = {"status": "error"}
    try:
        result = await submit_cpu_job(rebuild_projection_context, key[0], key[1], key[2])
    except Exception:
        result = {"status": "error"}
    finally:
        with _LOCK:
            _ACTIVE.discard(key)
            _RESULTS[key] = (time.monotonic(), result)


def queue_projection_recovery(background_tasks, season, week, kinds):
    if not kinds or not season or not week or background_tasks is None:
        return {"status": "idle"}
    key = (int(season), int(week), tuple(sorted(set(kinds))))
    from src.jobs.season_refresh import target_due
    if all(kind in {"draft", "ros"} for kind in kinds) and not any(
        target_due(kind, int(season), int(week)) for kind in kinds
    ):
        return {"status": "scheduled"}
    with _LOCK:
        if key in _ACTIVE:
            return {"status": "running"}
        previous = _RESULTS.get(key)
        if previous and time.monotonic() - previous[0] < RETRY_SECONDS:
            return {**previous[1], "retry_after_seconds": RETRY_SECONDS}
        _ACTIVE.add(key)
    background_tasks.add_task(_rebuild, key)
    return {"status": "queued"}
