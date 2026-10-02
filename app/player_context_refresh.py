"""Coalesced background note refreshes on the application's shared CPU worker."""
from datetime import datetime, timezone
from uuid import uuid4

from src.jobs.refresh_lock import RefreshBusy
from src.projections.player_context import refresh_player_context

_JOBS: dict = {}
MAX_JOBS = 32


def _snapshot(job_id: str, job: dict) -> dict:
    future = job["future"]
    payload = {
        "job_id": job_id, "started_at": job["started_at"], "status": "running",
        "status_url": f"/api/players/context/refresh/{job_id}",
    }
    if future.done():
        if future.cancelled():
            return {**payload, "status": "error", "error": "Refresh was interrupted. Try Refresh again."}
        try:
            payload.update(future.result())
        except RefreshBusy:
            payload.update(status="error", error="Another projection job is running. Try again after it finishes.")
        except Exception:
            payload.update(status="error", error="Weekly projections and notes did not refresh. Try Refresh again.")
        payload["completed_at"] = job.setdefault("completed_at", datetime.now(timezone.utc).isoformat())
    return payload


def start_context_refresh(season, week, submit) -> dict:
    for job_id, job in _JOBS.items():
        if job["context"] == (season, week) and not job["future"].done():
            return _snapshot(job_id, job)
    for job_id in list(_JOBS):
        if len(_JOBS) < MAX_JOBS:
            break
        if _JOBS[job_id]["future"].done():
            del _JOBS[job_id]
    if len(_JOBS) >= MAX_JOBS:
        return {"status": "error", "error": "Projection refreshes are busy. Try again shortly."}
    job_id = uuid4().hex
    job = {
        "context": (season, week), "started_at": datetime.now(timezone.utc).isoformat(),
        "future": submit(refresh_player_context, season=season, week=week),
    }
    _JOBS[job_id] = job
    return _snapshot(job_id, job)


def context_refresh_status(job_id: str) -> dict | None:
    job = _JOBS.get(job_id)
    return _snapshot(job_id, job) if job is not None else None
