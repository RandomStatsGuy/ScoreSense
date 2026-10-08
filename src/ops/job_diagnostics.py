"""Best-effort, bounded background-job observations, separate from application state.

Never inspect callable arguments, exception messages or arbitrary result payloads.
CPU is process CPU in the dedicated worker and calling-thread CPU elsewhere.
"""
from __future__ import annotations

import asyncio
from contextlib import closing
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import wraps
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import re
import sqlite3
import time
from uuid import uuid4

_CURRENT: ContextVar = ContextVar("job_diagnostics_span", default=None)
_READY: set[str] = set()
_LAST_WARNING = 0.0
_DROPPED = 0
_LABEL = re.compile(r"^[a-zA-Z0-9_.:-]{1,120}$")
_STATUS = frozenset({"ok", "completed", "complete", "prepared", "current", "skipped",
    "not_due", "offseason", "already_running", "busy", "error", "failed", "partial",
    "sources_changing", "upcoming", "rate_limited", "debounced", "unchanged", "missing_source", "unavailable", "no_stats"})
_FAILURES = frozenset({"error", "failed", "partial", "missing_source", "unavailable", "no_stats"})
_SKIPS = frozenset({"current", "skipped", "not_due", "offseason", "already_running",
    "busy", "upcoming", "rate_limited", "debounced", "unchanged", "sources_changing"})
_REASONS = _STATUS | {"no_material_change", "settings_changed", "no_stats", "refresh_failed"}
# High-frequency no-op outcomes count in hourly buckets only, so they cannot
# push every other job's retained runs out of the bounded history.
_AGGREGATE_ONLY = frozenset({("draft_clock", "unchanged"), ("sleeper_rosters.check", "unchanged")})
_COUNTS = frozenset({"checked", "changed", "prepared", "current", "failed", "completed",
    "synced", "unavailable", "rows", "players", "recomputed_players", "skipped", "upcoming",
    "added", "updated", "waived", "trades_applied", "attempts", "recipients"})
_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, job TEXT NOT NULL, parent TEXT, submitted REAL NOT NULL,
 started REAL, finished REAL, pid INTEGER, scope TEXT, state TEXT NOT NULL,
 queue_s REAL, wall_s REAL, cpu_s REAL, status TEXT, reason TEXT, error_type TEXT,
 metadata TEXT NOT NULL DEFAULT '{}', observer_cancelled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS runs_time ON runs(submitted);
CREATE TABLE IF NOT EXISTS buckets (
 hour INTEGER NOT NULL, job TEXT NOT NULL, scope TEXT NOT NULL, nested INTEGER NOT NULL,
 runs INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
 skips INTEGER NOT NULL DEFAULT 0, same_input INTEGER NOT NULL DEFAULT 0,
 wall_sum REAL NOT NULL DEFAULT 0, wall_max REAL NOT NULL DEFAULT 0,
 queue_sum REAL NOT NULL DEFAULT 0, queue_max REAL NOT NULL DEFAULT 0,
 queue_samples INTEGER NOT NULL DEFAULT 0, cpu_sum REAL NOT NULL DEFAULT 0,
 cpu_samples INTEGER NOT NULL DEFAULT 0, cpu_max REAL NOT NULL DEFAULT 0,
 PRIMARY KEY(hour,job,scope,nested)
);
CREATE TABLE IF NOT EXISTS revisions (
 job TEXT NOT NULL, context TEXT NOT NULL, revision TEXT NOT NULL, at REAL NOT NULL,
 PRIMARY KEY(job,context)
);
"""


def _warning():
    """Fixed, rate-limited message; never include a failing path or payload."""
    global _LAST_WARNING, _DROPPED
    _DROPPED += 1
    now = time.monotonic()
    if now - _LAST_WARNING >= 60:
        _LAST_WARNING = now
        logging.getLogger(__name__).warning(
            "Background diagnostics dropped observations; jobs continue (process-local drops=%d)", _DROPPED)


def _safe(operation, *args, **kwargs):
    try:
        return operation(*args, **kwargs)
    except Exception:
        try:
            _warning()
        except Exception:
            pass
        return None


def _options():
    # Lazy import also lets the read-only report run without application secrets.
    from src import config
    if not config.JOB_DIAGNOSTICS_ENABLED:
        return None
    return (Path(config.JOB_DIAGNOSTICS_PATH), config.JOB_DIAGNOSTICS_MAX_RUNS,
            config.JOB_DIAGNOSTICS_RETENTION_DAYS, config.JOB_DIAGNOSTICS_MAX_BYTES)


def _write(operation):
    options = _options()
    if options is None:
        return
    path, max_runs, days, max_bytes = options
    path.parent.mkdir(parents=True, exist_ok=True)
    # A long-lived external reader can pin WAL pages despite row retention.
    # Stop adding evidence at the size guard; never delete/rotate application data.
    files = (path, Path(str(path) + "-wal"))
    if sum(file.stat().st_size for file in files if file.exists()) >= max_bytes:
        raise OSError("Diagnostics size guard")
    with closing(sqlite3.connect(path, timeout=0.005)) as conn:
        conn.execute("PRAGMA busy_timeout=5")
        conn.execute("PRAGMA journal_size_limit=1048576")
        conn.execute("PRAGMA wal_autocheckpoint=100")
        key = str(path.resolve())
        if key not in _READY:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)
            _READY.add(key)
        conn.execute("BEGIN IMMEDIATE")
        operation(conn)
        # Retention is enforced on every write, including queued/unfinished runs.
        cutoff = time.time() - days * 86400
        conn.execute("DELETE FROM runs WHERE submitted < ?", (cutoff,))
        conn.execute("DELETE FROM runs WHERE id IN (SELECT id FROM runs ORDER BY submitted DESC LIMIT -1 OFFSET ?)", (max_runs,))
        conn.execute("DELETE FROM buckets WHERE hour < ?", (int(cutoff // 3600),))
        conn.execute("DELETE FROM buckets WHERE rowid IN (SELECT rowid FROM buckets ORDER BY hour DESC LIMIT -1 OFFSET 4096)")
        conn.execute("DELETE FROM revisions WHERE at < ?", (cutoff,))
        conn.execute("DELETE FROM revisions WHERE rowid IN (SELECT rowid FROM revisions ORDER BY at DESC LIMIT -1 OFFSET 1024)")
        conn.commit()


def _label(value, default="unregistered"):
    return value if isinstance(value, str) and _LABEL.fullmatch(value) else default


def job_name(func):
    return _label(getattr(func, "__diagnostic_job__", None) or
                  f"{getattr(func, '__module__', 'callable')}.{getattr(func, '__name__', 'unknown')}")


@dataclass
class Ticket:
    job: str
    id: str = field(default_factory=lambda: uuid4().hex)
    submitted: float = field(default_factory=time.time)
    queued_ns: int | None = None
    parent: str | None = None


@dataclass
class Span:
    ticket: Ticket
    scope: str
    started: float
    wall_ns: int
    cpu_start: float | None
    metadata: dict = field(default_factory=dict)


def _new_ticket(name, queued):
    if _options() is None:
        return None
    parent = _CURRENT.get()
    ticket = Ticket(_label(name), queued_ns=time.monotonic_ns() if queued else None,
                    parent=parent.ticket.id if parent else None)
    _safe(_write, lambda conn: conn.execute(
        "INSERT INTO runs(id,job,parent,submitted,state) VALUES(?,?,?,?,?)",
        (ticket.id, ticket.job, ticket.parent, ticket.submitted, "queued" if queued else "pending")))
    return ticket


def queue_job(func):
    """No arguments are captured. A new CPU callable inherits this automatically."""
    return _safe(lambda: _new_ticket(job_name(func), True))


def _cpu(scope):
    if scope == "async_wall_only":
        return None  # event-loop CPU cannot be attributed to one interleaved coroutine
    return _safe(time.process_time if scope == "process" else time.thread_time)


def _start(ticket, scope):
    started, now_ns = time.time(), time.monotonic_ns()
    queue_s = max(0, (now_ns - ticket.queued_ns) / 1e9) if ticket.queued_ns is not None else None
    span = Span(ticket, scope, started, now_ns, _cpu(scope))
    _safe(_write, lambda conn: conn.execute(
        "UPDATE runs SET started=?,pid=?,scope=?,state='running',queue_s=? WHERE id=?",
        (started, os.getpid(), scope, queue_s, ticket.id)))
    return span


def annotate_job(**values):
    """Accept only safe scalar context/counts and a hashed input revision."""
    def annotate():
        span = _CURRENT.get()
        if span is None:
            return
        for key, value in values.items():
            if key == "input_revision" and isinstance(value, str) and len(value) <= 8192:
                span.metadata[key] = hashlib.sha256(value.encode()).hexdigest()[:24]
            elif key == "season" and type(value) is int and 2000 <= value <= 2100:
                span.metadata[key] = value
            elif key == "week" and type(value) is int and 1 <= value <= 53:
                span.metadata[key] = value
            elif key in {"force", "apply_injury", "material_change", "retrain", "cache_hit", "computation_performed"} and type(value) is bool:
                span.metadata[key] = value
            elif key in _COUNTS | {"freshness_age_s", "cadence_s"} and type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1e12:
                span.metadata[key] = value
    _safe(annotate)


def _result_summary(result, job=None):
    """Allowlisted summary only; dynamic dict keys and nested payloads are ignored."""
    status, reason, counts = "ok", None, {}
    if job == "draft_clock" and isinstance(result, list):
        return ("ok" if result else "unchanged"), None, {"changed": len(result)}
    if isinstance(result, dict):
        raw_status, raw_reason = result.get("status"), result.get("reason")
        status = raw_status if isinstance(raw_status, str) and raw_status in _STATUS else ("other" if raw_status is not None else "ok")
        reason = raw_reason if isinstance(raw_reason, str) and raw_reason in _REASONS else None
        counts = {key: value for key, value in result.items() if key in _COUNTS
                  and type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1e12}
        if counts.get("failed", 0) or counts.get("unavailable", 0):
            status = "partial" if counts.get("completed", 0) or counts.get("prepared", 0) or counts.get("synced", 0) else "error"
    return status, reason, counts


def _finish(span, result=None, error=None):
    finished = time.time()
    wall = max(0, (time.monotonic_ns() - span.wall_ns) / 1e9)
    cpu_end = _cpu(span.scope)
    cpu = max(0, cpu_end - span.cpu_start) if cpu_end is not None and span.cpu_start is not None else None
    status, reason, counts = _result_summary(result, span.ticket.job)
    if error is not None:
        status, reason = "error", None
    span.metadata.update(counts)
    if error is None and status == "ok":
        if span.metadata.get("failed", 0) or span.metadata.get("unavailable", 0):
            status = "partial"
        elif span.metadata.get("checked", 0) and span.metadata.get("current") == span.metadata.get("checked"):
            status = "current"
    if isinstance(result, dict):
        # Safe known context and a single freshness timestamp, never copied text.
        annotate_job(season=result.get("season"), week=result.get("week"))
        stamp = result.get("last_success_at")
        if isinstance(stamp, str):
            from datetime import datetime
            try:
                age = finished - datetime.fromisoformat(stamp).timestamp()
                annotate_job(freshness_age_s=age)
            except (ValueError, OverflowError):
                pass
    metadata = json.dumps(span.metadata, separators=(",", ":"), allow_nan=False)
    def save(conn):
        row = conn.execute("SELECT queue_s,state FROM runs WHERE id=?", (span.ticket.id,)).fetchone()
        if row is None or row[1] == "finished":
            return
        queue_s = row[0]
        revision = span.metadata.get("input_revision")
        context = json.dumps([span.metadata.get(k) for k in ("season", "week", "apply_injury")])
        same = 0
        if revision is not None:
            prior = conn.execute("SELECT revision FROM revisions WHERE job=? AND context=?", (span.ticket.job, context)).fetchone()
            same = int(prior is not None and prior[0] == revision)
            conn.execute("INSERT OR REPLACE INTO revisions VALUES(?,?,?,?)", (span.ticket.job, context, revision, finished))
        failure, skip = int(status in _FAILURES), int(status in _SKIPS)
        if (span.ticket.job, status) in _AGGREGATE_ONLY:
            conn.execute("DELETE FROM runs WHERE id=?", (span.ticket.id,))
        else:
            conn.execute("UPDATE runs SET finished=?,state='finished',wall_s=?,cpu_s=?,status=?,reason=?,error_type=?,metadata=? WHERE id=?",
                (finished, wall, cpu, status, reason or (status if skip else None),
                 _label(type(error).__name__, "Exception") if error is not None else None, metadata, span.ticket.id))
        conn.execute("""INSERT INTO buckets(hour,job,scope,nested,runs,failures,skips,same_input,
            wall_sum,wall_max,queue_sum,queue_max,queue_samples,cpu_sum,cpu_samples,cpu_max)
            VALUES(?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(hour,job,scope,nested) DO UPDATE SET
            runs=runs+1,failures=failures+excluded.failures,skips=skips+excluded.skips,
            same_input=same_input+excluded.same_input,wall_sum=wall_sum+excluded.wall_sum,
            wall_max=max(wall_max,excluded.wall_max),queue_sum=queue_sum+excluded.queue_sum,
            queue_max=max(queue_max,excluded.queue_max),queue_samples=queue_samples+excluded.queue_samples,
            cpu_sum=cpu_sum+excluded.cpu_sum,cpu_samples=cpu_samples+excluded.cpu_samples,
            cpu_max=max(cpu_max,excluded.cpu_max)""",
            (int(finished // 3600), span.ticket.job, span.scope, int(span.ticket.parent is not None),
             failure, skip, same, wall, wall, queue_s or 0, queue_s or 0, int(queue_s is not None), cpu or 0, int(cpu is not None), cpu or 0))
    _write(save)


def execute_job(func, args, kwargs, ticket=None, scope="process"):
    """Picklable worker entry; preserve result/exception and invoke the job once."""
    if ticket is None:
        return func(*args, **kwargs)
    span = _safe(_start, ticket, scope)
    if span is None:
        return func(*args, **kwargs)
    token = _CURRENT.set(span)
    try:
        result = func(*args, **kwargs)
    except BaseException as error:
        _safe(_finish, span, error=error)
        raise
    else:
        _safe(_finish, span, result=result)
        return result
    finally:
        _CURRENT.reset(token)


def observe_job(name=None, *, cadence_s=None):
    """Register a direct/thread/CLI entry point; avoid duplicate CPU wrapper spans."""
    def decorate(func):
        registered = _label(name or job_name(func))
        @wraps(func)
        def observed(*args, **kwargs):
            current = _CURRENT.get()
            if current is not None and current.ticket.job == registered:
                annotate_job(cadence_s=cadence_s)
                return func(*args, **kwargs)
            ticket = _safe(_new_ticket, registered, False)
            # Child spans inside the CPU worker use process CPU; ordinary direct
            # callers use thread CPU, which excludes other/child threads.
            scope = current.scope if current else "thread"
            def invoke():
                annotate_job(cadence_s=cadence_s)
                return func(*args, **kwargs)
            return execute_job(invoke, (), {}, ticket, scope)
        observed.__diagnostic_job__ = registered
        return observed
    return decorate


def observe_async_job(name):
    """Wall-only observation for async work; interleaved event-loop CPU is unknown."""
    def decorate(func):
        @wraps(func)
        async def observed(*args, **kwargs):
            ticket = _safe(_new_ticket, _label(name), False)
            span = _safe(_start, ticket, "async_wall_only") if ticket is not None else None
            if span is None:
                return await func(*args, **kwargs)
            token = _CURRENT.set(span)
            try:
                result = await func(*args, **kwargs)
            except BaseException as error:
                _safe(_finish, span, error=error)
                raise
            else:
                _safe(_finish, span, result=result)
                return result
            finally:
                _CURRENT.reset(token)
        return observed
    return decorate


def call_phase(name, func, *args, **kwargs):
    """Optional named child span; totals must not add children to their parents."""
    current = _CURRENT.get()
    if current is None:
        return func(*args, **kwargs)
    ticket = _safe(_new_ticket, _label(f"{current.ticket.job}.{name}"), False)
    return execute_job(func, args, kwargs, ticket, current.scope)


def future_observed(future, ticket):
    """Worker death/submission failure has unknown execution and CPU duration.

    Cancelling an asyncio observer does NOT prove that underlying work stopped.
    """
    if ticket is None:
        return
    def update(conn):
        if future.cancelled():
            conn.execute("UPDATE runs SET observer_cancelled=1 WHERE id=?", (ticket.id,))
        elif future.exception() is not None:
            row = conn.execute("SELECT state,status,finished,job,scope,parent FROM runs WHERE id=?", (ticket.id,)).fetchone()
            if row is None:
                return
            # Result serialization/delivery can fail after the callable returned.
            # Preserve measured timing but record that executor-level failure too.
            if row[0] == "finished" and row[1] not in _FAILURES:
                conn.execute("UPDATE buckets SET failures=failures+1 WHERE hour=? AND job=? AND scope=? AND nested=?",
                    (int(row[2] // 3600), row[3], row[4], int(row[5] is not None)))
            conn.execute("UPDATE runs SET state=?,finished=COALESCE(finished,?),status='error',error_type=? WHERE id=?",
                ("finished" if row[0] == "finished" else "lost", time.time(),
                 _label(type(future.exception()).__name__, "Exception"), ticket.id))
    _safe(_write, update)


async def submit_thread_job(func, *args, **kwargs):
    """Same default thread executor/cancellation semantics as asyncio.to_thread."""
    ticket = queue_job(func)
    try:
        return await asyncio.to_thread(execute_job, func, args, kwargs, ticket, "thread")
    except asyncio.CancelledError:
        if ticket is not None:
            _safe(_write, lambda conn: conn.execute("UPDATE runs SET observer_cancelled=1 WHERE id=?", (ticket.id,)))
        raise
    except Exception as error:
        from concurrent.futures import Future
        failed = Future()
        failed.set_exception(error)
        future_observed(failed, ticket)
        raise
