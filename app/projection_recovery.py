"""Coalesce automatic recovery requests onto the existing shared CPU executor."""
from __future__ import annotations

import asyncio
import math
import time
from threading import Lock

from app.process_pool import submit_cpu_job
from src.jobs.projection_recovery import rebuild_projection_context
from src.core.projection_read_scope import anonymous_projection_read, projection_read_scope

_LOCK = Lock()
_ACTIVE: set[tuple] = set()
_RESULTS: dict[tuple, tuple[float, dict]] = {}
RETRY_SECONDS = 900
MAX_ACTIVE_TARGETS = 8
PUBLICATION_GRACE_SECONDS = 5


def _keys(season, week, kinds, *, anonymous=False):
    keys = [(int(season), int(week), (kind,)) for kind in sorted(set(kinds))]
    return [(*key, "anonymous") for key in keys] if anonymous else keys


def projection_recovery_status(season, week, kinds):
    """Observe the shared worker without enqueueing work or changing its state."""
    if not kinds or not season or not week:
        return {"status": "idle"}
    keys = _keys(season, week, kinds, anonymous=anonymous_projection_read())
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


def _finished(key, future, *, anonymous=False):
    try:
        result = future.result()
    except (Exception, asyncio.CancelledError):
        result = {"status": "error"}
    with _LOCK:
        for item in _keys(*key, anonymous=anonymous):
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


def _rebuild_public_projection_context(season, week, kinds):
    """Prepare forecast artifacts using existing inputs, without provider or paid work."""
    from src.draft_hub.draft_pool_cache import load_draft_pool
    from src.projections.ros_cache import load_ros_prediction
    from src.projections.weekly_cache import load_weekly_prediction

    failed = []
    with projection_read_scope(anonymous=True):
        for kind in kinds:
            try:
                if kind == "draft":
                    frame = load_draft_pool(season, allow_compute=True, apply_identity=False, allow_stale=False)
                    if frame.empty or frame.attrs.get("projection_stale"):
                        failed.append(kind)
                elif kind in {"weekly", "ros"}:
                    loader = load_ros_prediction if kind == "ros" else load_weekly_prediction
                    for position in ("qb", "rb", "wr"):
                        try:
                            for injury in (True, False):
                                frame = loader(position, season, week, apply_injury_adjustments=injury,
                                               allow_compute=True, allow_stale=False)
                                if frame.empty or frame.attrs.get("projection_stale"):
                                    raise ValueError("Forecast is not ready")
                        except Exception:
                            failed.append(f"{kind}:{position}")
                else:
                    failed.append(kind)
            except Exception:
                failed.append(kind)
    return {"status": "error" if failed else "ok", "failed": failed}


async def _rebuild(key, *, anonymous=False):
    try:
        worker = _rebuild_public_projection_context if anonymous else rebuild_projection_context
        future = asyncio.ensure_future(submit_cpu_job(worker, key[0], key[1], key[2]))
    except Exception as exc:
        future = asyncio.get_running_loop().create_future()
        future.set_exception(exc)
    future.add_done_callback(lambda completed: _finished(key, completed, anonymous=anonymous))
    # A disconnected request must not release ownership of a running repair.
    await asyncio.shield(future)


def queue_projection_recovery(background_tasks, season, week, kinds):
    if not kinds or not season or not week or background_tasks is None:
        return {"status": "idle"}
    anonymous = anonymous_projection_read()
    if anonymous:
        kinds = tuple(kind for kind in kinds if kind in {"weekly", "ros", "draft"})
        if not kinds:
            return {"status": "idle"}
    keys = _keys(season, week, kinds, anonymous=anonymous)
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
        if len(_ACTIVE) + len(pending) > MAX_ACTIVE_TARGETS:
            return {"status": "error", "reason": "recovery_queue_full"}
        _ACTIVE.update(pending)
        key = (int(season), int(week), tuple(item[2][0] for item in pending))
    background_tasks.add_task(_rebuild, key, anonymous=anonymous_projection_read())
    return {"status": "queued"}


def card_projection_recovery(background_tasks, meta):
    """Use the shared recovery worker while reporting what the card can read.

    The existing worker owns full-context coalescing, scheduled cadence, anonymous
    restrictions and process ownership. A player miss is never an inference trigger.
    Completion alone cannot claim that an unreadable artifact has been repaired.
    """
    artifacts = meta.get("artifacts") or {}
    requested = meta.pop("rebuild_kinds", [])
    if not artifacts:
        return queue_projection_recovery(background_tasks, meta.get("season"), meta.get("week"), requested)
    if (meta.get("identity") or {}).get("status") != "resolved":
        return {"status": "unsupported", "reason": "unresolved_identity"}
    if not meta.get("model_position"):
        return {"status": "unsupported", "reason": "unsupported_position"}
    season, week = meta.get("season"), meta.get("week")
    if not season or not week or not 1 <= int(week) <= 18:
        return {"status": "unsupported", "reason": "unsupported_context"}
    kinds = [kind for kind in ("weekly", "ros")
             if artifacts.get(kind, {}).get("status") in {"missing", "stale", "invalid"}]
    if not kinds:
        return {"status": "idle"}
    result = queue_projection_recovery(background_tasks, season, week, kinds)
    status = result.get("status")
    if status == "ok":
        # The card snapshot may precede atomic publication by a few milliseconds.
        keys = _keys(season, week, kinds, anonymous=anonymous_projection_read())
        with _LOCK:
            finished = [item[0] for key in keys if (item := _RESULTS.get(key))]
        if finished and time.monotonic() - max(finished) < PUBLICATION_GRACE_SECONDS:
            return {"status": "running", "reason": "awaiting_artifact_reread", "retry_after_seconds": 2}
        return {"status": "failed", "reason": "artifact_unavailable_after_recovery"}
    if status == "error":
        return {"status": "failed", "reason": result.get("reason", "artifact_rebuild_failed")}
    if status in {"queued", "running", "busy"}:
        return {"status": "running" if status == "busy" else status, "retry_after_seconds": 2}
    return result


def projection_recovery_snapshot():
    """Bounded process-local diagnostic facts; never enqueue or inspect providers."""
    with _LOCK:
        active = [{"kind": key[2][0], "season": key[0], "week": key[1],
                   "status": "running", "anonymous": len(key) > 3} for key in _ACTIVE]
        finished = [{"kind": key[2][0], "season": key[0], "week": key[1],
                     "status": {"ok": "completed", "error": "failed"}.get(result.get("status"), result.get("status")),
                     "failed": list(result.get("failed", [])), "anonymous": len(key) > 3}
                    for key, (_, result) in _RESULTS.items()]
    return active + finished
