"""Admin API — ADMIN_EMAILS allowlist."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth import _hash_password, create_access_token, register_native_user
from src.auth import user_store
from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def admin_client(hub_db, auth_db, monkeypatch):
    monkeypatch.setattr("src.config.ADMIN_EMAILS", frozenset({"admin@example.com"}))
    monkeypatch.setattr("app.auth.ADMIN_EMAILS", frozenset({"admin@example.com"}))
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: True)

    from app.api import app

    return TestClient(app)


def _auth_headers(email: str = "admin@example.com", password: str = "longpassword1") -> dict[str, str]:
    user = register_native_user(email, password, "Admin User", accept_terms=True)
    user_store.mark_email_verified(user["id"])
    token = create_access_token(user, auth_type="native")
    return {"Authorization": f"Bearer {token}"}


def test_admin_unconfigured_returns_503(hub_db, auth_db, monkeypatch):
    monkeypatch.setattr("src.config.ADMIN_EMAILS", frozenset())
    monkeypatch.setattr("app.auth.ADMIN_EMAILS", frozenset())
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: True)
    from app.api import app

    client = TestClient(app)
    headers = _auth_headers()
    res = client.get("/api/admin/overview", headers=headers)
    assert res.status_code == 503


def test_admin_forbidden_for_non_allowlisted(admin_client):
    headers = _auth_headers("other@example.com")
    res = admin_client.get("/api/admin/overview", headers=headers)
    assert res.status_code == 403


def test_admin_overview_for_allowlisted(admin_client):
    res = admin_client.get("/api/admin/overview", headers=_auth_headers())
    assert res.status_code == 200
    body = res.json()
    assert "native_user_count" in body
    assert "league_count" in body


def test_admin_unlink_team(admin_client):
    comm = register_native_user("comm@example.com", "longpassword1", "Comm", accept_terms=True)
    user_store.mark_email_verified(comm["id"])
    sub = f"ss:{comm['id']}"
    league = storage.create_league(sub, "Admin Unlink", 2026, LeagueRules(), team_count=10)
    member = register_native_user("member@example.com", "longpassword1", "Member", accept_terms=True)
    user_store.mark_email_verified(member["id"])
    member_sub = f"ss:{member['id']}"
    team = storage.join_league(member_sub, league["room_code"], "Member Team")

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{team['id']}/unlink",
        headers=_auth_headers(),
    )
    assert res.status_code == 200
    updated = storage.get_team(team["id"])
    assert updated["user_sub"] is None


def test_admin_delete_league(admin_client):
    comm = register_native_user("del@example.com", "longpassword1", "Del", accept_terms=True)
    user_store.mark_email_verified(comm["id"])
    sub = f"ss:{comm['id']}"
    league = storage.create_league(sub, "Delete Me", 2026, LeagueRules(), test_mode=True)
    room = league["room_code"]

    res = admin_client.delete(
        f"/api/admin/leagues/{league['id']}?confirm={room}",
        headers=_auth_headers(),
    )
    assert res.status_code == 200
    assert storage.get_league(league["id"]) is None


def test_admin_users_filters_bots_and_test_accounts(admin_client):
    register_native_user("real.user@mail.com", "longpassword1", "Real", accept_terms=True)
    headers = _auth_headers()
    res = admin_client.get("/api/admin/users", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert "accounts" in body
    assert "native_users" not in body
    emails = [row["email"] for row in body["accounts"]]
    assert "real.user@mail.com" in emails
    assert "admin@example.com" not in emails
    assert body["count"] == 1

    with_test = admin_client.get(
        "/api/admin/users?include_test_accounts=true",
        headers=headers,
    ).json()
    assert len(with_test["accounts"]) >= 2


def test_admin_transfer_commissioner(admin_client):
    old_comm = register_native_user("old.comm@mail.com", "longpassword1", "Old", accept_terms=True)
    new_comm = register_native_user("new.comm@mail.com", "longpassword1", "New", accept_terms=True)
    old_sub = f"ss:{old_comm['id']}"
    league = storage.create_league(old_sub, "Transfer League", 2026, LeagueRules(), test_mode=True)
    headers = _auth_headers()

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/transfer-commissioner",
        headers=headers,
        json={"commissioner_email": "new.comm@mail.com"},
    )
    assert res.status_code == 200
    updated = storage.get_league(league["id"])
    assert updated["commissioner_sub"] == f"ss:{new_comm['id']}"


def test_admin_create_invite(admin_client):
    comm = register_native_user("inv.comm@mail.com", "longpassword1", "Inv", accept_terms=True)
    user_store.mark_email_verified(comm["id"])
    sub = f"ss:{comm['id']}"
    league = storage.create_league(sub, "Invite League", 2026, LeagueRules(), test_mode=True)
    rules = LeagueRules()
    open_team = storage.get_or_create_league_team_by_name(league["id"], "Open Slot", rules.salary_cap)
    headers = _auth_headers()

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/invites",
        headers=headers,
        json={"email": "player@mail.com", "team_name": open_team["name"]},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["invite"]["email"] == "player@mail.com"
    assert body["invite"]["invite_url"]


def test_auth_me_includes_is_admin(admin_client):
    res = admin_client.get("/api/auth/me", headers=_auth_headers())
    assert res.status_code == 200
    body = res.json()
    assert body["authenticated"] is True
    assert body["user"]["is_admin"] is True

    other = admin_client.get("/api/auth/me", headers=_auth_headers("other@example.com"))
    assert other.json()["user"]["is_admin"] is False
