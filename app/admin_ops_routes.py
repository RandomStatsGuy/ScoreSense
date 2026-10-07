"""Admin ops API: health overview, server stats, jobs, sessions, settings, activity."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import admin_jobs, request_stats
from app.auth import (
    admin_configured,
    google_configured,
    native_user_sub,
    patreon_configured,
    require_admin,
)
from src import config
from src.auth import user_store
from src.ops import admin_store, server_stats

router = APIRouter(prefix="/api/admin/ops", tags=["admin"])
public_router = APIRouter(prefix="/api/site", tags=["site"])

DISK_WARN_PERCENT = 85
_SESSION_WINDOWS = {"active_15m": 15 * 60, "active_24h": 86400, "active_7d": 7 * 86400}


def actor_for(admin: dict[str, Any] | None) -> str:
    admin = admin or {}
    return str(admin.get("email") or admin.get("name") or admin.get("sub") or "Admin")


def _is_test_email(email: str | None) -> bool:
    e = str(email or "").strip().lower()
    return not e or e.endswith("@example.com") or e.endswith("@example.org")


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# --- overview -------------------------------------------------------------------


def _session_counts(users: list[dict[str, Any]], now: datetime) -> dict[str, int]:
    counts = {key: 0 for key in _SESSION_WINDOWS}
    counts["new_7d"] = 0
    for user in users:
        seen = _parse(user.get("last_seen_at"))
        if seen:
            age = (now - seen).total_seconds()
            for key, window in _SESSION_WINDOWS.items():
                if age <= window:
                    counts[key] += 1
        created = _parse(user.get("created_at"))
        if created and (now - created).total_seconds() <= 7 * 86400:
            counts["new_7d"] += 1
    return counts


def attention_items(jobs: list[dict], caches: list[dict], resources: dict | None, requests: dict, now: datetime) -> list[dict]:
    items: list[dict] = []
    for job in jobs:
        last = job.get("last_run") or {}
        finished = _parse(last.get("finished_at") or last.get("started_at"))
        if job.get("running") or last.get("outcome") != "failed" or not finished:
            continue
        if (now - finished).total_seconds() > 7 * 86400:
            continue
        items.append({"kind": "job", "id": job["id"], "label": job["label"], "at": finished.isoformat(),
                      "reason": (job.get("detail") or {}).get("error") or last.get("error_type") or last.get("status"),
                      "retry_due_at": (job.get("schedule") or {}).get("retry_due_at")})
    for cache in caches:
        if cache["status"] in {"error", "missing"}:
            items.append({"kind": "cache", "id": cache["key"], "cache_kind": cache["kind"], "season": cache["season"],
                          "week": cache["week"], "status": cache["status"]})
    disk = (resources or {}).get("disk") or {}
    if disk.get("percent") is not None and disk["percent"] >= DISK_WARN_PERCENT:
        items.append({"kind": "disk", "id": "disk", "percent": disk["percent"]})
    hour_ago = time.time() - 3600
    recent_errors = [e for e in requests.get("recent_errors", []) if e["at"] >= hour_ago]
    if recent_errors:
        items.append({"kind": "errors", "id": "errors", "count": len(recent_errors)})
    return items


def upcoming_runs(jobs: list[dict], limit: int = 5) -> list[dict]:
    rows = []
    for job in jobs:
        schedule = job.get("schedule") or {}
        nxt = schedule.get("retry_due_at") or schedule.get("next_run_at")
        if nxt:
            rows.append({"id": job["id"], "label": job["label"], "at": nxt, "retry": bool(schedule.get("retry_due_at"))})
    rows.sort(key=lambda row: row["at"])
    return rows[:limit]


@router.get("/overview")
def ops_overview(_admin=Depends(require_admin)) -> dict:
    now = datetime.now(timezone.utc)
    try:
        resources = server_stats.resources()
    except Exception:
        resources = None
    jobs = admin_jobs.list_jobs(now=now)
    caches = admin_jobs.cache_rows()
    requests = request_stats.snapshot()
    users = [u for u in user_store.list_users(limit=2000) if not _is_test_email(u.get("email"))]
    settings = admin_store.all_settings()
    return {
        "generated_at": now.isoformat(),
        "attention": attention_items(jobs, caches, resources, requests, now),
        "api": {"requests": requests["requests"], "server_errors": requests["server_errors"], "since": requests["since"]},
        "resources": resources,
        "jobs": {
            "running": sum(1 for job in jobs if job["running"]),
            "failed": sum(1 for job in jobs if (job.get("last_run") or {}).get("outcome") == "failed"),
            "scheduled": sum(1 for job in jobs if (job.get("schedule") or {}).get("enabled")),
        },
        "sessions": _session_counts(users, now),
        "upcoming": upcoming_runs(jobs),
        "deploy": server_stats.build_info(),
        "maintenance_banner_on": bool(settings["maintenance_banner_on"] and settings["maintenance_message"]),
        "activity": _activity_rows(admin_store.list_activity(limit=6)),
    }


# --- server ---------------------------------------------------------------------


@router.get("/server")
def ops_server(_admin=Depends(require_admin)) -> dict:
    try:
        resources = server_stats.resources()
    except Exception:
        resources = None
    return {
        "resources": resources,
        "runtime": server_stats.runtime(),
        "deploy": server_stats.build_info(),
        "storage": server_stats.storage_sizes(),
        "caches": admin_jobs.cache_rows(),
        "requests": request_stats.snapshot(),
    }


class CacheRebuildRequest(BaseModel):
    kind: str = Field(pattern="^(draft|weekly|ros)$")
    season: int = Field(ge=2015, le=2035)
    week: int = Field(default=1, ge=1, le=22)


@router.post("/caches/rebuild")
async def ops_cache_rebuild(body: CacheRebuildRequest, admin=Depends(require_admin)) -> dict:
    try:
        result = admin_jobs.run_cache_rebuild(body.kind, body.season, body.week, actor=actor_for(admin))
    except admin_jobs.JobBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    admin_jobs.clear_status_caches()
    return result


# --- jobs -----------------------------------------------------------------------


@router.get("/jobs")
def ops_jobs(_admin=Depends(require_admin)) -> dict:
    return {"jobs": admin_jobs.list_jobs(), "timezone": "America/Los_Angeles"}


@router.post("/jobs/{job_id}/run")
async def ops_run_job(job_id: str, admin=Depends(require_admin)) -> dict:
    if job_id not in admin_jobs.JOBS_BY_ID:
        raise HTTPException(status_code=404, detail="No job with that id")
    try:
        return admin_jobs.run_job(job_id, actor=actor_for(admin))
    except admin_jobs.JobBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


class ScheduleRequest(BaseModel):
    enabled: bool
    repeat: str = Field(pattern="^(daily|weekly)$")
    weekday: Optional[int] = Field(default=None, ge=0, le=6)
    at_time: str = Field(pattern=r"^\d{1,2}:\d{2}$")


@router.put("/jobs/{job_id}/schedule")
def ops_save_schedule(job_id: str, body: ScheduleRequest, admin=Depends(require_admin)) -> dict:
    if job_id not in admin_jobs.JOBS_BY_ID:
        raise HTTPException(status_code=404, detail="No job with that id")
    try:
        admin_jobs.save_schedule(job_id, enabled=body.enabled, repeat=body.repeat, weekday=body.weekday,
                                 at_time=body.at_time, actor=actor_for(admin))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"job": next(job for job in admin_jobs.list_jobs() if job["id"] == job_id)}


# --- sessions -------------------------------------------------------------------


@router.get("/sessions")
def ops_sessions(_admin=Depends(require_admin), limit: int = Query(200, ge=1, le=1000)) -> dict:
    from src.draft_hub import storage

    now = datetime.now(timezone.utc)
    users = [u for u in user_store.list_users(limit=2000) if not _is_test_email(u.get("email"))]
    users.sort(key=lambda u: u.get("last_seen_at") or "", reverse=True)
    rows = []
    for user in users[:limit]:
        try:
            leagues = sum(1 for m in storage.list_memberships_for_sub(native_user_sub(user["id"]))
                          if not m.get("test_mode"))
        except Exception:
            leagues = None
        rows.append({
            "id": user["id"],
            "email": user.get("email"),
            "display_name": user.get("display_name"),
            "google": bool(user.get("google_sub")),
            "password": bool(user.get("has_password")),
            "leagues": leagues,
            "last_seen_at": user.get("last_seen_at"),
            "created_at": user.get("created_at"),
        })
    return {"counts": _session_counts(users, now), "accounts": rows, "count": len(users)}


@router.post("/users/{user_id}/sign-out")
def ops_sign_out_everywhere(user_id: str, admin=Depends(require_admin)) -> dict:
    user = user_store.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="No account with that id")
    user_store.bump_session_version(user_id)
    admin_store.record_activity(actor_for(admin), "session", f"Signed out everywhere: {user.get('email')}")
    return {"user_id": user_id, "signed_out": True}


# --- settings -------------------------------------------------------------------


def _environment() -> list[dict[str, Any]]:
    from src.email.smtp import smtp_configured
    try:
        from src.integrations.youtube import youtube_api_key_configured
        youtube = youtube_api_key_configured()
    except Exception:
        youtube = False
    return [
        {"key": "AUTH_REQUIRED", "set": bool(config.AUTH_REQUIRED)},
        {"key": "HUB_AUTH_REQUIRED", "set": bool(config.HUB_AUTH_REQUIRED)},
        {"key": "ADMIN_EMAILS", "set": admin_configured(), "count": len(config.ADMIN_EMAILS)},
        {"key": "SMTP", "set": smtp_configured()},
        {"key": "GOOGLE_OAUTH", "set": google_configured()},
        {"key": "PATREON_OAUTH", "set": patreon_configured()},
        {"key": "YOUTUBE_API_KEY", "set": youtube},
        {"key": "OPENAI_API_KEY", "set": bool(config.OPENAI_API_KEY)},
        {"key": "JIRA_API_TOKEN", "set": bool(config.JIRA_API_TOKEN)},
        {"key": "JOB_DIAGNOSTICS_ENABLED", "set": bool(config.JOB_DIAGNOSTICS_ENABLED)},
        {"key": "HUB_TIMING", "set": bool(config.HUB_TIMING)},
    ]


def _settings_payload() -> dict:
    specs = {}
    for key, spec in admin_store.SETTINGS.items():
        specs[key] = {k: v for k, v in spec.items() if k in {"type", "default", "min", "max", "max_len", "choices"}}
    return {"values": admin_store.all_settings(), "specs": specs, "environment": _environment()}


@router.get("/settings")
def ops_settings(_admin=Depends(require_admin)) -> dict:
    return _settings_payload()


class SettingsRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict, max_length=len(admin_store.SETTINGS))


@router.put("/settings")
def ops_save_settings(body: SettingsRequest, admin=Depends(require_admin)) -> dict:
    try:
        changed = admin_store.update_settings(body.values, actor=actor_for(admin))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    for key, (old, new) in changed.items():
        label = admin_store.SETTINGS[key]["label"]
        if key == "maintenance_message":
            admin_store.record_activity(actor_for(admin), "setting", f"Changed {label}", str(new)[:200] or "Cleared")
        else:
            admin_store.record_activity(actor_for(admin), "setting",
                                        f"{label} → {admin_store.describe_value(key, new)}",
                                        f"Was {admin_store.describe_value(key, old)}")
    return {**_settings_payload(), "changed": sorted(changed)}


# --- activity -------------------------------------------------------------------


def _activity_rows(rows: list[dict]) -> list[dict]:
    return [{"id": row["id"], "at": datetime.fromtimestamp(row["at"], timezone.utc).isoformat(), "actor": row["actor"],
             "kind": row["kind"], "summary": row["summary"], "detail": row.get("detail")} for row in rows]


@router.get("/activity")
def ops_activity(_admin=Depends(require_admin), limit: int = Query(100, ge=1, le=500)) -> dict:
    return {"activity": _activity_rows(admin_store.list_activity(limit=limit)),
            "retention_days": admin_store.ACTIVITY_RETENTION_DAYS}


# --- public ---------------------------------------------------------------------


@public_router.get("/notice")
def site_notice() -> dict:
    on = bool(admin_store.settings_safe("maintenance_banner_on", False))
    message = str(admin_store.settings_safe("maintenance_message", "") or "")
    return {"message": message if on and message else None}
