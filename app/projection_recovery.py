"""Coalesce automatic recovery requests onto the existing shared CPU executor."""
from __future__ import annotations

import asyncio
import math
import time
from threading import Lock

from app.process_pool import submit_cpu_job
from src.jobs.projection_recovery import rebuild_projection_context

_LOCK = Lock()
_ACTIVE: set[tuple] = set()
_RESULTS: dict[tuple, tuple[float, dict]] = {}
RETRY_SECONDS = 900


def _keys(season, week, kinds):
    return [(int(season), int(week), (kind,)) for kind in sorted(set(kinds))]


def projection_recovery_status(season, week, kinds):
    """Observe the shared worker without enqueueing work or changing its state."""
    if not kinds or not season or not week:
        return {"status": "idle"}
    keys = _keys(season, week, kinds)
    with _LOCK:
        if any(key in _ACTIVE for key in keys):
            return {"status": "running"}
        previous = [item for key in keys if (item := _RESULTS.get(key))]
        if previous:
            previous = next((item for item in previous if item[1].get("status") == "error"), previous[0])
            retry = max(0, math.ceil(RETRY_SECONDS - (time.monotonic() - previous[0])))
            return {**previous[1], "retry_after_seconds": retry}
    from src.jobs.season_refresh import target_due
    if all(kind in {"draft", "ros"} for kind in kinds) and not any(
        target_due(kind, int(season), int(week)) for kind in kinds
    ):
        return {"status": "scheduled"}
    return {"status": "idle"}


def _finished(key, future):
    try:
        result = future.result()
    except (Exception, asyncio.CancelledError):
        result = {"status": "error"}
    with _LOCK:
        for item in _keys(*key):
            _ACTIVE.discard(item)
            kind = item[2][0]
            failed = [error for error in result.get("failed", [])
                      if error == kind or error.startswith(kind + ":")]
            status = result.get("status")
            if status == "error" and result.get("failed"):
                status = "error" if failed else "ok"
            _RESULTS[item] = (time.monotonic(), {**result, "status": status, "failed": failed})
        while len(_RESULTS) > 256:
            del _RESULTS[min(_RESULTS, key=lambda key: _RESULTS[key][0])]


async def _rebuild(key):
    try:
        future = asyncio.ensure_future(submit_cpu_job(rebuild_projection_context, key[0], key[1], key[2]))
    except Exception as exc:
        future = asyncio.get_running_loop().create_future()
        future.set_exception(exc)
    future.add_done_callback(lambda completed: _finished(key, completed))
    # A disconnected request must not release ownership of a running repair.
    await asyncio.shield(future)


def queue_projection_recovery(background_tasks, season, week, kinds):
    if not kinds or not season or not week or background_tasks is None:
        return {"status": "idle"}
    keys = _keys(season, week, kinds)
    with _LOCK:
        pending, held = [], []
        from src.jobs.season_refresh import target_due
        for key in keys:
            if key in _ACTIVE:
                held.append({"status": "running"})
                continue
            previous = _RESULTS.get(key)
            if previous and time.monotonic() - previous[0] < RETRY_SECONDS:
                held.append({**previous[1], "retry_after_seconds": RETRY_SECONDS})
                continue
            if key[2][0] in {"draft", "ros"} and not target_due(key[2][0], key[0], key[1]):
                held.append({"status": "scheduled"})
                continue
            pending.append(key)
        if not pending:
            return next((item for item in held if item["status"] == "running"), held[0])
        _ACTIVE.update(pending)
        key = (int(season), int(week), tuple(item[2][0] for item in pending))
    background_tasks.add_task(_rebuild, key)
    return {"status": "queued"}
