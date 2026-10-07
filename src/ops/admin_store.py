"""Admin-editable site settings, job schedules, and the admin activity log.

Settings take effect without a deploy. Readers go through ``get_setting`` which
keeps a short per-process cache, so hot paths (auth gates, injury cadence) do
not open SQLite on every request.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src import config

ACTIVITY_RETENTION_DAYS = 90
JOB_PEAK_RETENTION_DAYS = 7
_SETTINGS_TTL_S = 10.0

_SCHEMA = """
CREATE TABLE IF NOT EXISTS site_setting (
 key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS job_schedule (
 job_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, repeat TEXT NOT NULL DEFAULT 'weekly',
 weekday INTEGER, at_time TEXT NOT NULL DEFAULT '03:00', updated_at TEXT NOT NULL, updated_by TEXT,
 last_slot REAL, retry_due REAL
);
CREATE TABLE IF NOT EXISTS admin_activity (
 id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL, actor TEXT NOT NULL,
 kind TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS admin_activity_at ON admin_activity(at);
CREATE TABLE IF NOT EXISTS job_peak (
 run_id TEXT PRIMARY KEY, job TEXT NOT NULL, peak_rss INTEGER NOT NULL, at REAL NOT NULL
);
"""

_INJURY_REPORTING_DEFAULT = max(1, round(config.INJURY_POLL_REPORTING_SECONDS / 60))
_INJURY_INSEASON_DEFAULT = max(1, round(config.INJURY_POLL_INSEASON_SECONDS / 60))
_INJURY_OFFSEASON_DEFAULT = max(1, round(config.INJURY_POLL_OFFSEASON_SECONDS / 60))

# Each setting is wired to a real effect; see the reader named in "used_by".
SETTINGS: dict[str, dict[str, Any]] = {
    "signups_open": {"type": "bool", "default": True, "label": "New sign-ups", "used_by": "register, Google sign-in"},
    "email_verification_required": {"type": "bool", "default": True, "label": "Require email verification",
                                    "used_by": "require_hub_user"},
    "maintenance_banner_on": {"type": "bool", "default": False, "label": "Maintenance banner", "used_by": "/api/site/notice"},
    "maintenance_message": {"type": "str", "default": "", "max_len": 200, "label": "Banner message",
                            "used_by": "/api/site/notice"},
    "injury_poll_reporting_minutes": {"type": "int", "default": _INJURY_REPORTING_DEFAULT, "min": 2, "max": 120,
                                      "label": "Injury poll on report days", "unit": "min"},
    "injury_poll_inseason_minutes": {"type": "int", "default": _INJURY_INSEASON_DEFAULT, "min": 5, "max": 720,
                                     "label": "Injury poll other in-season days", "unit": "min"},
    "injury_poll_offseason_minutes": {"type": "int", "default": _INJURY_OFFSEASON_DEFAULT, "min": 15, "max": 1440,
                                      "label": "Injury poll in the offseason", "unit": "min"},
    "job_retry_minutes": {"type": "choice", "default": 0, "choices": (0, 5, 15, 30, 60),
                          "label": "Retry failed scheduled jobs", "unit": "min"},
}


def describe_value(key: str, value: Any) -> str:
    spec = SETTINGS[key]
    if spec["type"] == "bool":
        return "on" if value else "off"
    if key == "job_retry_minutes" and not value:
        return "off"
    if spec.get("unit"):
        return f"{value} {spec['unit']}"
    return str(value)

_cache_lock = threading.Lock()
_cache: tuple[float, dict[str, Any], dict[str, Any]] | None = None


def db_path() -> Path:
    return Path(config.ADMIN_OPS_DB)


def _connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _invalidate_cache() -> None:
    global _cache
    with _cache_lock:
        _cache = None


# --- settings -----------------------------------------------------------------


def coerce_setting(key: str, raw: Any) -> Any:
    spec = SETTINGS.get(key)
    if spec is None:
        raise ValueError(f"Unknown setting: {key}")
    kind = spec["type"]
    if kind == "bool":
        if isinstance(raw, bool):
            return raw
        if raw in (0, 1, "0", "1", "true", "false"):
            return raw in (1, "1", "true")
        raise ValueError(f"{key} must be on or off")
    if kind == "str":
        text = " ".join(str(raw or "").split())
        if len(text) > spec["max_len"]:
            raise ValueError(f"{key} must be {spec['max_len']} characters or fewer")
        return text
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be a whole number") from None
    if kind == "choice":
        if value not in spec["choices"]:
            raise ValueError(f"{key} must be one of {', '.join(map(str, spec['choices']))}")
        return value
    if not spec["min"] <= value <= spec["max"]:
        raise ValueError(f"{key} must be between {spec['min']} and {spec['max']}")
    return value


def _stored_settings() -> dict[str, Any]:
    try:
        with closing(_connect()) as conn:
            rows = conn.execute("SELECT key, value FROM site_setting").fetchall()
    except sqlite3.Error:
        return {}
    stored: dict[str, Any] = {}
    for row in rows:
        if row["key"] not in SETTINGS:
            continue
        try:
            stored[row["key"]] = coerce_setting(row["key"], json.loads(row["value"]))
        except (ValueError, json.JSONDecodeError):
            continue
    return stored


def _cached() -> tuple[dict[str, Any], dict[str, Any]]:
    global _cache
    now = time.monotonic()
    with _cache_lock:
        if _cache and now - _cache[0] < _SETTINGS_TTL_S:
            return _cache[1], _cache[2]
    stored = _stored_settings()
    values = {key: spec["default"] for key, spec in SETTINGS.items()}
    values.update(stored)
    with _cache_lock:
        _cache = (now, values, stored)
    return values, stored


def all_settings() -> dict[str, Any]:
    return dict(_cached()[0])


def get_setting(key: str) -> Any:
    if key not in SETTINGS:
        raise KeyError(key)
    return _cached()[0][key]


def stored_override(key: str) -> Any | None:
    """The admin-saved value, or None while the setting still follows the server default."""
    try:
        return _cached()[1].get(key)
    except Exception:
        return None


def update_settings(values: dict[str, Any], *, actor: str) -> dict[str, tuple[Any, Any]]:
    """Validate everything first, then write. Returns {key: (old, new)} for changed keys."""
    coerced = {key: coerce_setting(key, raw) for key, raw in values.items()}
    current = all_settings()
    changed = {key: (current[key], value) for key, value in coerced.items() if current[key] != value}
    if not changed:
        return {}
    now = _now_iso()
    with closing(_connect()) as conn, conn:
        for key, (_old, new) in changed.items():
            conn.execute(
                """INSERT INTO site_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value,
                   updated_at=excluded.updated_at, updated_by=excluded.updated_by""",
                (key, json.dumps(new), now, actor),
            )
    _invalidate_cache()
    return changed


def settings_safe(key: str, fallback: Any) -> Any:
    """Never let a broken settings DB take down auth or polling."""
    try:
        return get_setting(key)
    except Exception:
        return fallback


# --- schedules ----------------------------------------------------------------


def list_schedules() -> dict[str, dict[str, Any]]:
    with closing(_connect()) as conn:
        rows = conn.execute("SELECT * FROM job_schedule").fetchall()
    return {row["job_id"]: dict(row) for row in rows}


def get_schedule(job_id: str) -> dict[str, Any] | None:
    with closing(_connect()) as conn:
        row = conn.execute("SELECT * FROM job_schedule WHERE job_id = ?", (job_id,)).fetchone()
    return dict(row) if row else None


def save_schedule(
    job_id: str,
    *,
    enabled: bool,
    repeat: str,
    weekday: int | None,
    at_time: str,
    actor: str,
    last_slot: float | None,
) -> dict[str, Any]:
    with closing(_connect()) as conn, conn:
        conn.execute(
            """INSERT INTO job_schedule (job_id, enabled, repeat, weekday, at_time, updated_at, updated_by, last_slot, retry_due)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
               ON CONFLICT(job_id) DO UPDATE SET enabled=excluded.enabled, repeat=excluded.repeat,
               weekday=excluded.weekday, at_time=excluded.at_time, updated_at=excluded.updated_at,
               updated_by=excluded.updated_by, last_slot=excluded.last_slot, retry_due=NULL""",
            (job_id, int(bool(enabled)), repeat, weekday, at_time, _now_iso(), actor, last_slot),
        )
    return get_schedule(job_id) or {}


def seed_schedule(job_id: str, *, repeat: str, weekday: int | None, at_time: str) -> None:
    """Create a disabled default row once; never overwrite an admin's choice."""
    with closing(_connect()) as conn, conn:
        conn.execute(
            """INSERT OR IGNORE INTO job_schedule (job_id, enabled, repeat, weekday, at_time, updated_at, updated_by)
               VALUES (?, 0, ?, ?, ?, ?, 'default')""",
            (job_id, repeat, weekday, at_time, _now_iso()),
        )


def mark_slot(job_id: str, slot: float) -> None:
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE job_schedule SET last_slot = ?, retry_due = NULL WHERE job_id = ?", (slot, job_id))


def set_retry_due(job_id: str, due: float | None) -> None:
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE job_schedule SET retry_due = ? WHERE job_id = ?", (due, job_id))


# --- activity -----------------------------------------------------------------


def record_activity(actor: str, kind: str, summary: str, detail: str | None = None) -> None:
    """Best effort: an activity write must never fail the admin action itself."""
    now = time.time()
    try:
        with closing(_connect()) as conn, conn:
            conn.execute(
                "INSERT INTO admin_activity (at, actor, kind, summary, detail) VALUES (?, ?, ?, ?, ?)",
                (now, str(actor or "Unknown")[:120], kind[:40], summary[:300], (detail or None) and detail[:500]),
            )
            conn.execute("DELETE FROM admin_activity WHERE at < ?", (now - ACTIVITY_RETENTION_DAYS * 86400,))
    except sqlite3.Error:
        pass


def list_activity(*, limit: int = 100, kind: str | None = None) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit), 500))
    try:
        with closing(_connect()) as conn:
            if kind:
                rows = conn.execute(
                    "SELECT * FROM admin_activity WHERE kind = ? ORDER BY at DESC, id DESC LIMIT ?", (kind, limit)
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM admin_activity ORDER BY at DESC, id DESC LIMIT ?", (limit,)).fetchall()
    except sqlite3.Error:
        return []
    return [dict(row) for row in rows]


# --- job memory -----------------------------------------------------------------


def record_job_peaks(peaks: dict[str, tuple[str, int]]) -> None:
    """Keep the highest memory seen for each running job run (best effort)."""
    now = time.time()
    try:
        with closing(_connect()) as conn, conn:
            conn.executemany(
                """INSERT INTO job_peak (run_id, job, peak_rss, at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(run_id) DO UPDATE SET peak_rss = MAX(peak_rss, excluded.peak_rss), at = excluded.at""",
                [(run_id, job[:120], int(rss), now) for run_id, (job, rss) in peaks.items()],
            )
            conn.execute("DELETE FROM job_peak WHERE at < ?", (now - JOB_PEAK_RETENTION_DAYS * 86400,))
    except sqlite3.Error:
        pass


def job_peaks(run_ids: list[str]) -> dict[str, int]:
    if not run_ids:
        return {}
    out: dict[str, int] = {}
    try:
        with closing(_connect()) as conn:
            for start in range(0, len(run_ids), 500):
                chunk = run_ids[start:start + 500]
                marks = ",".join("?" for _ in chunk)
                for row in conn.execute(f"SELECT run_id, peak_rss FROM job_peak WHERE run_id IN ({marks})", chunk):
                    out[row["run_id"]] = int(row["peak_rss"])
    except sqlite3.Error:
        return {}
    return out
