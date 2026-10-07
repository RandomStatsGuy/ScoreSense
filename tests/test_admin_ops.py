"""Admin ops: settings with real effects, schedules, sessions, request stats, routes."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import admin_jobs, request_stats
from app.auth import create_access_token, native_email_verified, register_native_user, session_user_public
from src.auth import user_store
from src.ops import admin_store


@pytest.fixture()
def admin_client(hub_db, auth_db, monkeypatch):
    monkeypatch.setattr("src.config.ADMIN_EMAILS", frozenset({"admin@fourthdown.test"}))
    monkeypatch.setattr("app.auth.ADMIN_EMAILS", frozenset({"admin@fourthdown.test"}))
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: True)
    from app.api import app

    return TestClient(app)


def _account(email="admin@fourthdown.test", *, verified=True):
    user = register_native_user(email, "longpassword1", "Some One", accept_terms=True)
    if verified:
        user_store.mark_email_verified(user["id"])
    return user


def _headers(user):
    return {"Authorization": f"Bearer {create_access_token(user_store.get_user_by_id(user['id']), auth_type='native')}"}


# --- settings -------------------------------------------------------------------


def test_settings_validate_before_writing_anything():
    with pytest.raises(ValueError):
        admin_store.update_settings({"signups_open": False, "injury_poll_reporting_minutes": 1}, actor="a")
    assert admin_store.get_setting("signups_open") is True
    with pytest.raises(ValueError):
        admin_store.update_settings({"not_a_setting": 1}, actor="a")


def test_settings_report_only_real_changes():
    changed = admin_store.update_settings({"signups_open": False, "email_verification_required": True}, actor="a")
    assert changed == {"signups_open": (True, False)}
    assert admin_store.get_setting("signups_open") is False
    assert admin_store.update_settings({"signups_open": False}, actor="a") == {}


def test_maintenance_message_is_trimmed_and_bounded():
    admin_store.update_settings({"maintenance_message": "  Down   at 9  "}, actor="a")
    assert admin_store.get_setting("maintenance_message") == "Down at 9"
    with pytest.raises(ValueError):
        admin_store.update_settings({"maintenance_message": "x" * 201}, actor="a")


def test_closed_signups_block_registration(admin_client):
    admin_store.update_settings({"signups_open": False}, actor="a")
    res = admin_client.post("/api/auth/register", json={
        "email": "new@example.com", "password": "longpassword1", "display_name": "New", "accept_terms": True,
    })
    assert res.status_code == 403
    assert user_store.get_user_by_email("new@example.com") is None


def test_closed_signups_still_accept_league_invites(admin_client):
    from src.draft_hub import storage
    from src.draft_hub.league_invites import create_invite
    from src.draft_hub.schemas import LeagueRules

    commissioner = _account("comm@fourthdown.test")
    league = storage.create_league(f"ss:{commissioner['id']}", "Invite League", 2026, LeagueRules(), 4, None)
    create_invite(league["id"], "Invited@fourthdown.test", "Team Two", f"ss:{commissioner['id']}")
    admin_store.update_settings({"signups_open": False}, actor="a")
    res = admin_client.post("/api/auth/register", json={
        "email": "invited@fourthdown.test", "password": "longpassword1", "display_name": "Inv", "accept_terms": True,
    })
    assert res.status_code == 200


def test_verification_toggle_opens_fantasy_for_unverified_accounts(auth_db):
    user = _account("unverified@example.com", verified=False)
    jwt_user = {"sub": f"ss:{user['id']}", "auth_type": "native", "email": user["email"]}
    assert native_email_verified(jwt_user) is False
    assert session_user_public(jwt_user)["email_verified"] is False
    admin_store.update_settings({"email_verification_required": False}, actor="a")
    assert native_email_verified(jwt_user) is True
    assert session_user_public(jwt_user)["email_verified"] is True


def test_injury_cadence_follows_saved_override_only():
    from src.integrations import injury_poll

    default = injury_poll.cadence_seconds_for_phase(injury_poll.PHASE_REPORTING)
    assert default == int(injury_poll.INJURY_POLL_REPORTING_SECONDS)
    admin_store.update_settings({"injury_poll_reporting_minutes": 20}, actor="a")
    assert injury_poll.cadence_seconds_for_phase(injury_poll.PHASE_REPORTING) == 1200


# --- schedules ------------------------------------------------------------------


def _utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


def test_weekly_slot_is_pacific_wall_clock():
    schedule = {"repeat": "weekly", "weekday": 1, "at_time": "03:00"}
    # Tue 2026-10-06 03:00 PDT == 10:00 UTC.
    assert admin_jobs.latest_slot(schedule, _utc(2026, 10, 6, 10, 30)) == _utc(2026, 10, 6, 10, 0)
    assert admin_jobs.latest_slot(schedule, _utc(2026, 10, 6, 9, 59)) == _utc(2026, 9, 29, 10, 0)
    # After DST ends the same 3:00 AM is 11:00 UTC.
    assert admin_jobs.next_slot(schedule, _utc(2026, 10, 30, 0, 0)) == _utc(2026, 11, 3, 11, 0)


def test_daily_slot_rolls_back_a_day_before_the_time():
    schedule = {"repeat": "daily", "at_time": "23:30"}
    assert admin_jobs.latest_slot(schedule, _utc(2026, 10, 6, 12, 0)) == _utc(2026, 10, 6, 6, 30)


def _fake_runs(monkeypatch, outcome=None):
    started = []

    def start(job_id):
        started.append(job_id)
        future = asyncio.get_running_loop().create_future()
        if isinstance(outcome, Exception):
            future.set_exception(outcome)
        else:
            future.set_result(outcome or {"status": "completed"})
        return future

    monkeypatch.setattr(admin_jobs, "_start", start)
    monkeypatch.setattr(admin_jobs, "_inflight", {})
    return started


def test_saving_a_schedule_does_not_fire_a_slot_that_already_passed(monkeypatch):
    started = _fake_runs(monkeypatch)
    now = datetime.now(timezone.utc)
    local = now.astimezone(admin_jobs.SCHEDULE_TZ)
    admin_jobs.save_schedule("sentiment_refresh", enabled=True, repeat="daily", weekday=None,
                             at_time=f"{local.hour:02d}:00", actor="admin@fourthdown.test")

    async def tick():
        return await admin_jobs.scheduler_tick(now)

    assert asyncio.run(tick()) == []
    assert started == []


def test_due_slot_starts_once_and_old_missed_slots_are_skipped(monkeypatch):
    started = _fake_runs(monkeypatch)
    admin_store.save_schedule("sentiment_refresh", enabled=True, repeat="daily", weekday=None, at_time="03:00",
                              actor="a", last_slot=_utc(2026, 10, 4, 10, 0).timestamp())

    async def ticks():
        first = await admin_jobs.scheduler_tick(_utc(2026, 10, 5, 10, 5))
        second = await admin_jobs.scheduler_tick(_utc(2026, 10, 5, 10, 6))
        missed = await admin_jobs.scheduler_tick(_utc(2026, 10, 6, 15, 0))
        await asyncio.sleep(0)
        return first, second, missed

    assert asyncio.run(ticks()) == (["sentiment_refresh"], [], [])
    assert started == ["sentiment_refresh"]
    kinds = [row["kind"] for row in admin_store.list_activity()]
    assert "job" in kinds and "job_ok" in kinds


def test_failed_scheduled_run_retries_once(monkeypatch):
    started = _fake_runs(monkeypatch, outcome={"status": "error"})
    admin_store.update_settings({"job_retry_minutes": 15}, actor="a")
    admin_store.save_schedule("sentiment_refresh", enabled=True, repeat="daily", weekday=None, at_time="03:00",
                              actor="a", last_slot=_utc(2026, 10, 4, 10, 0).timestamp())

    async def ticks():
        await admin_jobs.scheduler_tick(_utc(2026, 10, 5, 10, 1))
        await asyncio.sleep(0)
        assert admin_store.get_schedule("sentiment_refresh")["retry_due"] is not None
        admin_store.set_retry_due("sentiment_refresh", _utc(2026, 10, 5, 10, 16).timestamp())
        retried = await admin_jobs.scheduler_tick(_utc(2026, 10, 5, 10, 17))
        await asyncio.sleep(0)
        again = await admin_jobs.scheduler_tick(_utc(2026, 10, 5, 11, 17))
        return retried, again

    retried, again = asyncio.run(ticks())
    assert retried == ["sentiment_refresh"]
    assert again == []
    assert started == ["sentiment_refresh", "sentiment_refresh"]


def test_automatic_jobs_cannot_be_scheduled():
    with pytest.raises(ValueError):
        admin_jobs.save_schedule("season_refresh", enabled=True, repeat="daily", weekday=None, at_time="03:00", actor="a")


def test_jobs_in_one_group_do_not_overlap(monkeypatch):
    _fake_runs(monkeypatch)

    async def run():
        pending = asyncio.get_running_loop().create_future()
        admin_jobs._inflight["weekly_refresh"] = pending
        with pytest.raises(admin_jobs.JobBusy):
            admin_jobs.run_job("preseason_refresh", actor="a")
        pending.cancel()

    asyncio.run(run())


# --- sessions -------------------------------------------------------------------


def test_last_seen_is_throttled(auth_db):
    user = _account("seen@example.com")
    assert user_store.touch_last_seen(user["id"]) is True
    assert user_store.touch_last_seen(user["id"]) is False
    assert user_store.get_user_by_id(user["id"])["last_seen_at"]


def test_sign_out_everywhere_revokes_existing_tokens(admin_client):
    admin = _account()
    member = _account("member@example.com")
    member_headers = _headers(member)
    assert admin_client.get("/api/auth/me", headers=member_headers).json().get("user")
    res = admin_client.post(f"/api/admin/ops/users/{member['id']}/sign-out", headers=_headers(admin))
    assert res.status_code == 200
    assert admin_client.get("/api/admin/ops/sessions", headers=member_headers).status_code == 401
    activity = admin_client.get("/api/admin/ops/activity", headers=_headers(admin)).json()["activity"]
    assert activity[0]["summary"] == "Signed out everywhere: member@example.com"


def test_sessions_list_counts_recent_activity(admin_client):
    admin = _account()
    user_store.touch_last_seen(admin["id"])
    body = admin_client.get("/api/admin/ops/sessions", headers=_headers(admin)).json()
    assert body["counts"]["active_15m"] == 1
    assert body["accounts"][0]["email"] == "admin@fourthdown.test"


# --- request stats --------------------------------------------------------------


def test_request_stats_key_by_route_template_and_keep_only_error_type():
    request_stats.reset()
    app = FastAPI()
    app.add_middleware(request_stats.RequestStatsMiddleware)

    @app.get("/api/thing/{thing_id}")
    def thing(thing_id: str):
        if thing_id == "boom":
            raise RuntimeError("secret detail")
        return {"id": thing_id}

    client = TestClient(app, raise_server_exceptions=False)
    client.get("/api/thing/a")
    client.get("/api/thing/b")
    client.get("/api/thing/boom")
    snap = request_stats.snapshot()
    assert [row["route"] for row in snap["slowest"]] == ["GET /api/thing/{thing_id}"]
    assert snap["slowest"][0]["count"] == 3
    error = snap["recent_errors"][0]
    assert error["route"] == "GET /api/thing/{thing_id}"
    assert error["error_type"] == "RuntimeError"
    assert "secret" not in str(snap)


# --- routes ---------------------------------------------------------------------


def test_ops_routes_are_admin_only(admin_client):
    other = _account("other@example.com")
    for path in ("/api/admin/ops/overview", "/api/admin/ops/jobs", "/api/admin/ops/settings", "/api/admin/ops/server"):
        assert admin_client.get(path, headers=_headers(other)).status_code == 403


def test_ops_read_routes_load(admin_client, monkeypatch):
    monkeypatch.setattr(admin_jobs, "cache_rows", lambda **_: [])
    headers = _headers(_account())
    overview = admin_client.get("/api/admin/ops/overview", headers=headers)
    assert overview.status_code == 200
    assert overview.json()["sessions"]["new_7d"] == 1
    jobs = admin_client.get("/api/admin/ops/jobs", headers=headers).json()["jobs"]
    assert {job["id"] for job in jobs} >= {"weekly_refresh", "sleeper_rosters"}
    server = admin_client.get("/api/admin/ops/server", headers=headers).json()
    assert server["resources"]["memory"]["total"] > 0


def test_settings_never_return_secret_values(admin_client, monkeypatch):
    monkeypatch.setattr("src.config.OPENAI_API_KEY", "sk-very-secret")
    body = admin_client.get("/api/admin/ops/settings", headers=_headers(_account())).text
    assert "sk-very-secret" not in body
    assert '"OPENAI_API_KEY","set":true' in body.replace(" ", "")


def test_saving_settings_logs_activity_and_shows_banner(admin_client):
    headers = _headers(_account())
    assert admin_client.get("/api/site/notice").json() == {"message": None}
    res = admin_client.put("/api/admin/ops/settings", headers=headers, json={
        "values": {"maintenance_banner_on": True, "maintenance_message": "Back at 9 PM"},
    })
    assert res.status_code == 200
    assert res.json()["changed"] == ["maintenance_banner_on", "maintenance_message"]
    assert admin_client.get("/api/site/notice").json() == {"message": "Back at 9 PM"}
    summaries = [row["summary"] for row in admin_client.get("/api/admin/ops/activity", headers=headers).json()["activity"]]
    assert "Maintenance banner → on" in summaries


def test_bad_setting_is_a_400(admin_client):
    res = admin_client.put("/api/admin/ops/settings", headers=_headers(_account()),
                           json={"values": {"job_retry_minutes": 7}})
    assert res.status_code == 400


def test_schedule_route_validates_and_reports_next_run(admin_client):
    headers = _headers(_account())
    bad = admin_client.put("/api/admin/ops/jobs/weekly_refresh/schedule", headers=headers,
                           json={"enabled": True, "repeat": "weekly", "at_time": "03:00"})
    assert bad.status_code == 400
    ok = admin_client.put("/api/admin/ops/jobs/weekly_refresh/schedule", headers=headers,
                          json={"enabled": True, "repeat": "weekly", "weekday": 1, "at_time": "3:00"})
    assert ok.status_code == 200
    schedule = ok.json()["job"]["schedule"]
    assert schedule["at_time"] == "03:00"
    assert schedule["next_run_at"]


def test_unknown_job_is_404(admin_client):
    headers = _headers(_account())
    assert admin_client.post("/api/admin/ops/jobs/nope/run", headers=headers).status_code == 404


def test_attention_lists_failed_jobs_and_full_disk():
    now = _utc(2026, 10, 6, 12, 0)
    jobs = [{"id": "weekly_refresh", "label": "Weekly refresh", "running": False, "schedule": None, "detail": None,
             "last_run": {"outcome": "failed", "finished_at": "2026-10-06T10:00:00+00:00", "status": "error"}},
            {"id": "old", "label": "Old", "running": False, "schedule": None, "detail": None,
             "last_run": {"outcome": "failed", "finished_at": "2026-09-01T10:00:00+00:00"}}]
    from app.admin_ops_routes import attention_items

    items = attention_items(jobs, [], {"disk": {"percent": 91.0}}, {"recent_errors": []}, now)
    assert [item["kind"] for item in items] == ["job", "disk"]
    assert items[0]["id"] == "weekly_refresh"
