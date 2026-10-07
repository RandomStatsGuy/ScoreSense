"""Admin job registry: run now, in-app schedules, one automatic retry, and status.

Runs go through the shared executors (``submit_cpu_job`` / ``submit_thread_job``)
so they show up in job diagnostics like every other background job. Schedules
are Pacific wall-clock times stored in the admin ops DB.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import partial
from typing import Any, Callable
from zoneinfo import ZoneInfo

from src import config
from src.ops import admin_store
from src.ops.job_diagnostics import job_name

LOG = logging.getLogger(__name__)
SCHEDULE_TZ = ZoneInfo("America/Los_Angeles")
TICK_SECONDS = 30
MISSED_SLOT_GRACE_S = 2 * 3600
_FAILED = frozenset({"error", "failed", "partial", "lost", "busy", "missing_source", "unavailable", "no_stats"})
_SKIPPED = frozenset({"current", "skipped", "not_due", "offseason", "already_running", "upcoming",
                      "rate_limited", "debounced", "unchanged", "sources_changing"})
REPEATS = ("daily", "weekly")


@dataclass(frozen=True)
class JobDef:
    id: str
    label: str
    description: str
    automatic: bool = False
    schedulable: bool = True
    group: str | None = None


JOBS: tuple[JobDef, ...] = (
    JobDef("weekly_refresh", "Weekly refresh", "Stats, retrain, projections, and caches", group="projections"),
    JobDef("accuracy_rebuild", "Accuracy rebuild", "Model accuracy and upside reports", group="projections"),
    JobDef("sentiment_refresh", "Sentiment refresh", "Beat-writer and video sentiment"),
    JobDef("media_digests", "Media digests", "Fantasy media summaries for player cards"),
    JobDef("preseason_refresh", "Preseason refresh", "Datasets and draft projections", group="projections"),
    JobDef("injury_poll", "Injury poll", "Sleeper injury status", automatic=True, schedulable=False),
    JobDef("season_refresh", "Season projections", "Weekly board, draft pool, rest of season", automatic=True, schedulable=False),
    JobDef("dfs_refresh", "DFS projections", "Slate projections and salaries", automatic=True, schedulable=False),
    JobDef("sleeper_rosters", "Sleeper roster sync", "Linked leagues' rosters and trades", automatic=True, schedulable=False),
)
JOBS_BY_ID = {job.id: job for job in JOBS}
DEFAULT_SCHEDULES = {"weekly_refresh": {"repeat": "weekly", "weekday": 1, "at_time": "03:00"}}

_inflight: dict[str, asyncio.Future] = {}


class JobBusy(Exception):
    pass


# --- what each job runs -------------------------------------------------------


def _diag_name(job_id: str) -> str:
    if job_id == "accuracy_rebuild":
        from src.jobs.accuracy_rebuild import run_full_accuracy_rebuild
        return job_name(run_full_accuracy_rebuild)
    if job_id == "sentiment_refresh":
        from src.jobs.sentiment_refresh import run_sentiment_refresh
        return job_name(run_sentiment_refresh)
    if job_id == "media_digests":
        from src.jobs.prewarm_fantasy_media_digests import prewarm_fantasy_media_digests
        return job_name(prewarm_fantasy_media_digests)
    if job_id == "preseason_refresh":
        from src.jobs.preseason_refresh import run_preseason_refresh
        return job_name(run_preseason_refresh)
    return job_id


def _start_weekly_refresh() -> asyncio.Future:
    from app.process_pool import submit_cpu_job
    from src.jobs.refresh_lock import RefreshBusy, refresh_lock
    from src.jobs.weekly_refresh import (
        REFRESH_STATUS, get_refresh_status, mark_refresh_started, record_refresh_job_result, run_weekly_refresh,
    )
    try:
        with refresh_lock(REFRESH_STATUS.with_suffix(".lock")):
            if get_refresh_status().get("status") == "running":
                raise JobBusy("Weekly refresh is already running")
            started = mark_refresh_started(retrain=True, draft_only=False)
    except RefreshBusy as exc:
        raise JobBusy("Another projection job is running") from exc
    future = submit_cpu_job(run_weekly_refresh, True, None, False, started["started_at"])
    future.add_done_callback(partial(record_refresh_job_result, started_at=started["started_at"]))
    return future


def _start_accuracy_rebuild() -> asyncio.Future:
    from app.process_pool import submit_cpu_job
    from src.jobs.accuracy_rebuild import run_full_accuracy_rebuild, start_full_accuracy_rebuild
    if start_full_accuracy_rebuild(include_espn=True).get("status") == "already_running":
        raise JobBusy("Accuracy rebuild is already running")
    return submit_cpu_job(run_full_accuracy_rebuild, True)


def _start(job_id: str) -> asyncio.Future:
    from app.process_pool import submit_cpu_job
    from src.ops.job_diagnostics import submit_thread_job
    if job_id == "weekly_refresh":
        return _start_weekly_refresh()
    if job_id == "accuracy_rebuild":
        return _start_accuracy_rebuild()
    if job_id == "sentiment_refresh":
        from src.jobs.sentiment_refresh import run_sentiment_refresh
        return submit_cpu_job(run_sentiment_refresh)
    if job_id == "media_digests":
        from src.jobs.prewarm_fantasy_media_digests import prewarm_fantasy_media_digests
        return submit_cpu_job(prewarm_fantasy_media_digests)
    if job_id == "preseason_refresh":
        from src.jobs.preseason_refresh import run_preseason_refresh
        return submit_cpu_job(run_preseason_refresh)
    if job_id == "injury_poll":
        from src.integrations.injury_poll import run_injury_poll
        return submit_cpu_job(run_injury_poll, True, True, "manual")
    if job_id == "season_refresh":
        from src.jobs.season_refresh import run_season_refresh
        return submit_cpu_job(run_season_refresh)
    if job_id == "dfs_refresh":
        from src.jobs.dfs_refresh import run_dfs_refresh
        return submit_cpu_job(run_dfs_refresh)
    if job_id == "sleeper_rosters":
        from app.sleeper_sync_ticker import sync_all_live_sleeper_leagues
        return asyncio.ensure_future(submit_thread_job(sync_all_live_sleeper_leagues))
    raise KeyError(job_id)


def _outcome(job_id: str, future: asyncio.Future) -> tuple[bool, str | None]:
    """(failed, short reason). Reasons are our own status strings, never exception text."""
    if future.cancelled():
        return True, "Cancelled"
    error = future.exception()
    if error is not None:
        return True, type(error).__name__
    result = future.result()
    if job_id == "accuracy_rebuild":
        from src.jobs.accuracy_rebuild import get_accuracy_rebuild_status
        message = get_accuracy_rebuild_status().get("error")
        return (True, str(message)[:200]) if message else (False, None)
    if isinstance(result, dict):
        status = str(result.get("status") or "")
        if status in _FAILED:
            return True, str(result.get("error") or status)[:200]
    return False, None


# --- starting runs ------------------------------------------------------------


def is_running(job_id: str) -> bool:
    future = _inflight.get(job_id)
    return bool(future and not future.done())


def run_job(job_id: str, *, actor: str, trigger: str = "manual") -> dict[str, Any]:
    """Start a job on the shared executors. Must be called on the event loop."""
    job = JOBS_BY_ID.get(job_id)
    if job is None:
        raise KeyError(job_id)
    if is_running(job_id):
        raise JobBusy(f"{job.label} is already running")
    if job.group:
        for other in JOBS:
            if other.id != job_id and other.group == job.group and is_running(other.id):
                raise JobBusy(f"{other.label} is running. Try again after it finishes.")
    future = _start(job_id)
    started = time.time()
    _inflight[job_id] = future
    verb = {"schedule": "Scheduled run started", "retry": "Automatic retry started"}.get(trigger, "Started")
    admin_store.record_activity(actor, "job", f"{verb}: {job.label}")
    future.add_done_callback(partial(_finished, job_id, trigger, started))
    return {"job_id": job_id, "status": "started", "started_at": datetime.fromtimestamp(started, timezone.utc).isoformat()}


def _finished(job_id: str, trigger: str, started: float, future: asyncio.Future) -> None:
    job = JOBS_BY_ID[job_id]
    try:
        failed, reason = _outcome(job_id, future)
    except Exception:
        failed, reason = True, "Unknown"
    minutes = max(1, round((time.time() - started) / 60))
    actor = "Schedule" if trigger in {"schedule", "retry"} else "Job"
    if failed:
        admin_store.record_activity(actor, "job_failed", f"{job.label} failed after {minutes} min", reason)
        retry = int(admin_store.settings_safe("job_retry_minutes", 0) or 0)
        if trigger == "schedule" and retry > 0 and job.schedulable:
            admin_store.set_retry_due(job_id, time.time() + retry * 60)
    else:
        admin_store.record_activity(actor, "job_ok", f"{job.label} finished in {minutes} min")


def run_cache_rebuild(kind: str, season: int, week: int, *, actor: str) -> dict[str, Any]:
    from app.process_pool import submit_cpu_job
    from src.jobs.season_refresh import rebuild_target, target_key
    key = f"cache:{target_key(kind, season, week)}"
    if is_running(key) or is_running("season_refresh"):
        raise JobBusy("That cache is already rebuilding")
    future = submit_cpu_job(rebuild_target, kind, int(season), int(week))
    _inflight[key] = future
    admin_store.record_activity(actor, "cache", f"Rebuild started: {kind} {season}" + (f" week {week}" if kind != "draft" else ""))
    return {"status": "started", "key": key}


# --- schedules ----------------------------------------------------------------


def _parse_time(at_time: str) -> tuple[int, int]:
    try:
        hour, minute = (int(part) for part in str(at_time).split(":", 1))
    except (TypeError, ValueError):
        raise ValueError("Time must look like 03:00") from None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("Time must look like 03:00")
    return hour, minute


def latest_slot(schedule: dict[str, Any], now: datetime) -> datetime:
    """Most recent scheduled moment at or before ``now``, in Pacific wall-clock."""
    hour, minute = _parse_time(schedule.get("at_time") or "03:00")
    local = now.astimezone(SCHEDULE_TZ)
    candidate = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if schedule.get("repeat") == "weekly":
        weekday = int(schedule.get("weekday") if schedule.get("weekday") is not None else 1)
        candidate -= timedelta(days=(local.weekday() - weekday) % 7)
        if candidate > local:
            candidate -= timedelta(days=7)
    elif candidate > local:
        candidate -= timedelta(days=1)
    return candidate


def next_slot(schedule: dict[str, Any], now: datetime) -> datetime:
    step = timedelta(days=7 if schedule.get("repeat") == "weekly" else 1)
    upcoming = latest_slot(schedule, now) + step
    # Re-anchor across DST so 3:00 stays 3:00.
    return latest_slot(schedule, upcoming + timedelta(minutes=1))


def save_schedule(job_id: str, *, enabled: bool, repeat: str, weekday: int | None, at_time: str, actor: str) -> dict[str, Any]:
    job = JOBS_BY_ID.get(job_id)
    if job is None or not job.schedulable:
        raise ValueError("This job runs automatically and cannot be scheduled")
    if repeat not in REPEATS:
        raise ValueError("Repeat must be daily or weekly")
    hour, minute = _parse_time(at_time)
    at_time = f"{hour:02d}:{minute:02d}"
    if repeat == "weekly":
        if weekday is None or not 0 <= int(weekday) <= 6:
            raise ValueError("Pick a day of the week")
        weekday = int(weekday)
    else:
        weekday = None
    schedule = {"repeat": repeat, "weekday": weekday, "at_time": at_time}
    # A slot that already passed today must not fire the moment the schedule is saved.
    last_slot = latest_slot(schedule, datetime.now(timezone.utc)).timestamp()
    saved = admin_store.save_schedule(job_id, enabled=enabled, repeat=repeat, weekday=weekday,
                                      at_time=at_time, actor=actor, last_slot=last_slot)
    admin_store.record_activity(actor, "schedule", f"{job.label} schedule {'on' if enabled else 'off'}",
                                _schedule_text(saved))
    return saved


_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _schedule_text(schedule: dict[str, Any]) -> str:
    hour, minute = _parse_time(schedule.get("at_time") or "03:00")
    clock = f"{(hour % 12) or 12}:{minute:02d} {'AM' if hour < 12 else 'PM'} PT"
    if schedule.get("repeat") == "weekly":
        return f"{_DAYS[int(schedule.get('weekday') or 0)]} {clock}"
    return f"Daily {clock}"


def seed_default_schedules() -> None:
    for job_id, spec in DEFAULT_SCHEDULES.items():
        admin_store.seed_schedule(job_id, **spec)


async def scheduler_tick(now: datetime | None = None) -> list[str]:
    """Start whatever is due. Returns the job ids started (for tests and logs)."""
    now = now or datetime.now(timezone.utc)
    now_ts = now.timestamp()
    started: list[str] = []
    for job_id, schedule in admin_store.list_schedules().items():
        job = JOBS_BY_ID.get(job_id)
        if job is None or not job.schedulable or not schedule.get("enabled"):
            continue
        try:
            slot = latest_slot(schedule, now).timestamp()
        except ValueError:
            continue
        trigger = None
        if schedule.get("last_slot") is None or float(schedule["last_slot"]) < slot:
            admin_store.mark_slot(job_id, slot)
            if now_ts - slot <= MISSED_SLOT_GRACE_S:
                trigger = "schedule"
        elif schedule.get("retry_due") and now_ts >= float(schedule["retry_due"]):
            admin_store.set_retry_due(job_id, None)
            trigger = "retry"
        if trigger is None:
            continue
        try:
            run_job(job_id, actor="Schedule", trigger=trigger)
            started.append(job_id)
        except JobBusy as exc:
            admin_store.record_activity("Schedule", "job_failed", f"{job.label} skipped: {exc}")
        except Exception:
            LOG.exception("Scheduled job could not start: %s", job_id)
            admin_store.record_activity("Schedule", "job_failed", f"{job.label} could not start")
    return started


async def admin_scheduler_loop() -> None:
    try:
        seed_default_schedules()
    except Exception:
        LOG.exception("Could not seed default job schedules")
    while True:
        try:
            await scheduler_tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            LOG.exception("Admin scheduler tick failed")
        await asyncio.sleep(TICK_SECONDS)


# --- status -------------------------------------------------------------------


def _diagnostic_runs(names: list[str], per_job: int = 6) -> dict[str, list[dict[str, Any]]]:
    path = config.JOB_DIAGNOSTICS_PATH
    out: dict[str, list[dict[str, Any]]] = {name: [] for name in names}
    if not names or not path.exists():
        return out
    marks = ",".join("?" for _ in names)
    try:
        with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)) as conn:
            rows = conn.execute(
                f"""SELECT job, state, status, reason, error_type, wall_s, submitted, started, finished
                    FROM runs WHERE parent IS NULL AND job IN ({marks})
                    ORDER BY submitted DESC LIMIT ?""",
                (*names, per_job * len(names) * 4),
            ).fetchall()
    except sqlite3.Error:
        return out
    for job, state, status, reason, error_type, wall_s, submitted, started, finished in rows:
        bucket = out.setdefault(job, [])
        if len(bucket) >= per_job:
            continue
        bucket.append({
            "outcome": run_outcome(state, status),
            "status": status,
            "reason": reason,
            "error_type": error_type,
            "seconds": round(wall_s, 1) if wall_s is not None else None,
            "started_at": _iso(started or submitted),
            "finished_at": _iso(finished),
        })
    return out


def run_outcome(state: str | None, status: str | None) -> str:
    if state in {"queued", "pending", "running"}:
        return "running"
    if state == "lost" or (status or "") in _FAILED:
        return "failed"
    if (status or "") in _SKIPPED:
        return "skipped"
    return "ok"


def _iso(epoch: float | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(float(epoch), timezone.utc).isoformat()


def _job_detail(job_id: str) -> dict[str, Any] | None:
    """Plain status written by the job itself. Includes the job's own error text, never a traceback."""
    try:
        if job_id == "weekly_refresh":
            from src.jobs.weekly_refresh import get_refresh_status
            status = get_refresh_status()
            return {key: status.get(key) for key in ("status", "stage", "started_at", "completed_at", "error", "retrain")}
        if job_id == "accuracy_rebuild":
            from src.jobs.accuracy_rebuild import get_accuracy_rebuild_status
            status = get_accuracy_rebuild_status()
            return {"status": "running" if status.get("is_building") else ("error" if status.get("error") else "completed"),
                    "started_at": status.get("started_at"), "completed_at": status.get("finished_at"),
                    "error": status.get("error")}
        if job_id == "sentiment_refresh":
            path = config.SENTIMENT_CACHE_DIR / "last_refresh.json"
            status = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            return {"status": status.get("status"), "started_at": status.get("started_at"),
                    "completed_at": status.get("completed_at") or status.get("finished_at"), "error": status.get("error")}
        if job_id == "injury_poll":
            from src.integrations.injury_poll import get_injury_poll_status
            status = get_injury_poll_status()
            return {"status": "running" if status.get("is_refreshing") else ("error" if status.get("last_error") else "completed"),
                    "completed_at": status.get("last_success_at"), "error": status.get("last_error"),
                    "phase": status.get("phase"), "cadence_seconds": status.get("cadence_seconds"),
                    "next_run_at": status.get("next_poll_at")}
    except Exception:
        return None
    return None


def list_jobs(*, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    schedules = admin_store.list_schedules()
    names = {job.id: _diag_name(job.id) for job in JOBS}
    runs = _diagnostic_runs(list(names.values()))
    rows = []
    for job in JOBS:
        recent = runs.get(names[job.id], [])
        schedule = schedules.get(job.id)
        detail = _job_detail(job.id)
        running = is_running(job.id) or bool(recent and recent[0]["outcome"] == "running") or bool(
            detail and detail.get("status") == "running")
        last = next((run for run in recent if run["outcome"] != "running"), None)
        if last is None and detail and detail.get("completed_at"):
            last = {"outcome": "failed" if detail.get("error") else "ok", "status": detail.get("status"),
                    "started_at": detail.get("started_at"), "finished_at": detail.get("completed_at"), "seconds": None}
        schedule_out = None
        if schedule:
            schedule_out = {
                "enabled": bool(schedule.get("enabled")),
                "repeat": schedule.get("repeat"),
                "weekday": schedule.get("weekday"),
                "at_time": schedule.get("at_time"),
                "next_run_at": next_slot(schedule, now).isoformat() if schedule.get("enabled") else None,
                "retry_due_at": _iso(schedule.get("retry_due")),
            }
        rows.append({
            "id": job.id,
            "label": job.label,
            "description": job.description,
            "automatic": job.automatic,
            "schedulable": job.schedulable,
            "running": running,
            "schedule": schedule_out,
            "last_run": last,
            "recent_runs": recent,
            "detail": detail,
        })
    return rows


_cache_rows: tuple[float, list[dict[str, Any]]] | None = None


def cache_rows(*, max_age_s: float = 30) -> list[dict[str, Any]]:
    global _cache_rows
    now = time.monotonic()
    if _cache_rows and now - _cache_rows[0] < max_age_s:
        rows = _cache_rows[1]
    else:
        from src.jobs.season_refresh import current_targets, read_status, target_due, target_key, target_metadata
        from src.projections.refresh_policy import timestamp
        try:
            targets = current_targets()
        except Exception:
            targets = []
        health = read_status()
        rows = []
        for kind, season, week in targets:
            key = target_key(kind, season, week)
            metas = target_metadata(kind, season, week)
            built = [timestamp(meta.get("built_at")) for meta in metas]
            missing = not metas or any(stamp is None for stamp in built)
            oldest = min((stamp for stamp in built if stamp is not None), default=None)
            state = (health.get(key) or {}).get("status")
            if state not in {"running", "error"}:
                state = "missing" if missing else ("due" if target_due(kind, season, week) else "ok")
            rows.append({
                "key": key, "kind": kind, "season": season, "week": week if kind != "draft" else None,
                "built_at": oldest.isoformat() if oldest else None, "status": state,
                "last_success_at": (health.get(key) or {}).get("last_success_at"),
            })
        _cache_rows = (now, rows)
    out = []
    for row in rows:
        rebuilding = is_running(f"cache:{row['key']}")
        out.append({**row, "status": "running" if rebuilding else row["status"]})
    return out


def clear_status_caches() -> None:
    global _cache_rows
    _cache_rows = None
