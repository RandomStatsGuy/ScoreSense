"""Admin API — ADMIN_EMAILS allowlist."""

from __future__ import annotations

import pytest
from unittest.mock import Mock
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import (
    _hash_password,
    authenticate_native_user,
    change_native_password,
    create_access_token,
    register_native_user,
    reset_password_with_token,
    upsert_google_user,
)
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


def _open_franchise(league_id: str, name: str = "Night Owls") -> dict:
    return storage.get_or_create_league_team_by_name(league_id, name, LeagueRules().salary_cap)


def test_admin_link_team_by_email(admin_client):
    comm = register_native_user("link.comm@mail.com", "longpassword1", "Comm", accept_terms=True)
    user_store.mark_email_verified(comm["id"])
    league = storage.create_league(f"ss:{comm['id']}", "Link League", 2026, LeagueRules(), team_count=10)
    open_team = _open_franchise(league["id"])
    player = register_native_user("missed.claim@mail.com", "longpassword1", "Missed", accept_terms=True)
    user_store.mark_email_verified(player["id"])

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{open_team['id']}/link",
        headers=_auth_headers(),
        json={"email": "missed.claim@mail.com"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["already_member"] is False
    assert body["team"]["user_email"] == "missed.claim@mail.com"
    updated = storage.get_team(open_team["id"])
    assert updated["user_sub"] == f"ss:{player['id']}"
    assert storage.get_hub_focus_league_id(f"ss:{player['id']}") == league["id"]


def test_admin_link_team_by_user_sub(admin_client):
    comm = register_native_user("link.sub.comm@mail.com", "longpassword1", "Comm", accept_terms=True)
    league = storage.create_league(f"ss:{comm['id']}", "Link Sub League", 2026, LeagueRules(), team_count=10)
    open_team = _open_franchise(league["id"], "Sunday Club")
    player = register_native_user("link.sub.player@mail.com", "longpassword1", "Player", accept_terms=True)
    player_sub = f"ss:{player['id']}"

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{open_team['id']}/link",
        headers=_auth_headers(),
        json={"user_sub": player_sub},
    )
    assert res.status_code == 200
    assert storage.get_team(open_team["id"])["user_sub"] == player_sub


def test_admin_link_team_unknown_email(admin_client):
    comm = register_native_user("link.miss.comm@mail.com", "longpassword1", "Comm", accept_terms=True)
    league = storage.create_league(f"ss:{comm['id']}", "Missing Email League", 2026, LeagueRules(), team_count=10)
    open_team = _open_franchise(league["id"])

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{open_team['id']}/link",
        headers=_auth_headers(),
        json={"email": "nobody@mail.com"},
    )
    assert res.status_code == 400
    assert "No account" in res.json()["detail"]


def test_admin_link_team_rejects_missing_native_account(admin_client):
    league = storage.create_league("comm", "Known accounts", 2026, LeagueRules())
    team = _open_franchise(league["id"])
    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{team['id']}/link",
        headers=_auth_headers(),
        json={"user_sub": "ss:deleted-account"},
    )
    assert res.status_code == 400
    assert storage.get_team(team["id"])["user_sub"] is None


def test_admin_restores_unlinked_account_to_existing_team(admin_client):
    league = storage.create_league("comm", "Restore access", 2026, LeagueRules())
    player = register_native_user("restore@mail.com", "longpassword1", "Owner", accept_terms=True)
    sub = f"ss:{player['id']}"
    team = storage.join_league(sub, league["room_code"], "Existing franchise")
    storage.update_league_status(league["id"], "live")
    headers = _auth_headers()
    url = f"/api/admin/leagues/{league['id']}/teams/{team['id']}"
    assert admin_client.post(f"{url}/unlink", headers=headers).status_code == 200
    assert storage.get_team_by_user(league["id"], sub) is None
    response = admin_client.post(f"{url}/link", headers=headers, json={"user_sub": sub})
    assert response.status_code == 200
    restored = storage.get_team_by_user(league["id"], sub)
    assert restored["id"] == team["id"]
    assert restored["name"] == "Existing franchise"
    assert storage.get_hub_focus_league_id(sub) == league["id"]
    memberships = admin_client.get("/api/admin/users", headers=headers).json()["accounts"]
    owner = next(row for row in memberships if row["user_sub"] == sub)
    assert any(m["team"]["id"] == team["id"] for m in owner["memberships"])


def test_admin_link_team_rejects_taken_seat(admin_client):
    comm = register_native_user("link.taken.comm@mail.com", "longpassword1", "Comm", accept_terms=True)
    league = storage.create_league(f"ss:{comm['id']}", "Taken Seat League", 2026, LeagueRules(), team_count=10)
    owner = register_native_user("link.taken.owner@mail.com", "longpassword1", "Owner", accept_terms=True)
    claimed = storage.join_league(f"ss:{owner['id']}", league["room_code"], "Taken Club")
    other = register_native_user("link.taken.other@mail.com", "longpassword1", "Other", accept_terms=True)

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{claimed['id']}/link",
        headers=_auth_headers(),
        json={"email": "link.taken.other@mail.com"},
    )
    assert res.status_code == 400
    assert "already claimed" in res.json()["detail"].lower()


def test_admin_link_team_rejects_existing_membership(admin_client):
    comm = register_native_user("link.dup.comm@mail.com", "longpassword1", "Comm", accept_terms=True)
    league = storage.create_league(f"ss:{comm['id']}", "Dup Seat League", 2026, LeagueRules(), team_count=10)
    open_team = _open_franchise(league["id"], "Open Club")
    player = register_native_user("link.dup.player@mail.com", "longpassword1", "Player", accept_terms=True)
    storage.join_league(f"ss:{player['id']}", league["room_code"], "Wrong Club")

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{open_team['id']}/link",
        headers=_auth_headers(),
        json={"email": "link.dup.player@mail.com"},
    )
    assert res.status_code == 400
    assert "already owns" in res.json()["detail"].lower()


def test_admin_link_team_idempotent(admin_client):
    comm = register_native_user("link.again.comm@mail.com", "longpassword1", "Comm", accept_terms=True)
    league = storage.create_league(f"ss:{comm['id']}", "Again League", 2026, LeagueRules(), team_count=10)
    open_team = _open_franchise(league["id"])
    player = register_native_user("link.again.player@mail.com", "longpassword1", "Player", accept_terms=True)

    headers = _auth_headers()
    first = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{open_team['id']}/link",
        headers=headers,
        json={"email": "link.again.player@mail.com"},
    )
    again = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{open_team['id']}/link",
        headers=headers,
        json={"email": "link.again.player@mail.com"},
    )
    assert first.status_code == 200
    assert again.status_code == 200
    assert again.json()["already_member"] is True
    assert storage.get_team(open_team["id"])["user_sub"] == f"ss:{player['id']}"


def test_admin_link_team_revokes_pending_invite(admin_client):
    from src.draft_hub.league_invites import create_invite

    comm = register_native_user("link.inv.comm@mail.com", "longpassword1", "Comm", accept_terms=True)
    comm_sub = f"ss:{comm['id']}"
    league = storage.create_league(comm_sub, "Invite Revoke League", 2026, LeagueRules(), team_count=10)
    open_team = _open_franchise(league["id"], "Reserved Club")
    invite = create_invite(league["id"], "pending.owner@mail.com", "Reserved Club", comm_sub)
    player = register_native_user("link.inv.player@mail.com", "longpassword1", "Player", accept_terms=True)

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{open_team['id']}/link",
        headers=_auth_headers(),
        json={"email": "link.inv.player@mail.com"},
    )
    assert res.status_code == 200
    stored = storage.get_invite_by_token(invite["token"])
    assert stored["status"] == "revoked"


def test_admin_link_team_works_after_draft_started(admin_client):
    comm = register_native_user("link.live.comm@mail.com", "longpassword1", "Comm", accept_terms=True)
    league = storage.create_league(f"ss:{comm['id']}", "Live Link League", 2026, LeagueRules(), team_count=10)
    open_team = _open_franchise(league["id"])
    storage.update_league_status(league["id"], "live")
    player = register_native_user("link.live.player@mail.com", "longpassword1", "Player", accept_terms=True)

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{open_team['id']}/link",
        headers=_auth_headers(),
        json={"email": "link.live.player@mail.com"},
    )
    assert res.status_code == 200
    assert storage.get_team(open_team["id"])["user_sub"] == f"ss:{player['id']}"


def test_admin_link_forbidden_for_non_allowlisted(admin_client):
    comm = register_native_user("link.forbid.comm@mail.com", "longpassword1", "Comm", accept_terms=True)
    league = storage.create_league(f"ss:{comm['id']}", "Forbid Link League", 2026, LeagueRules(), team_count=10)
    open_team = _open_franchise(league["id"])

    res = admin_client.post(
        f"/api/admin/leagues/{league['id']}/teams/{open_team['id']}/link",
        headers=_auth_headers("other@example.com"),
        json={"email": "anyone@mail.com"},
    )
    assert res.status_code == 403


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


def test_refresh_allowed_when_site_auth_is_off(hub_db, auth_db, monkeypatch):
    monkeypatch.setattr("app.auth.auth_enabled", lambda: False)
    monkeypatch.setattr("src.config.ADMIN_EMAILS", frozenset({"admin@example.com"}))
    monkeypatch.setattr("app.auth.ADMIN_EMAILS", frozenset({"admin@example.com"}))
    monkeypatch.setattr(
        "app.api.mark_refresh_started",
        lambda **kwargs: {"status": "running", "stage": "queued", "started_at": "2026-01-01T00:00:00+00:00"},
    )
    monkeypatch.setattr(
        "app.api.submit_cpu_job",
        Mock(),
    )

    from app.api import app

    res = TestClient(app).post("/api/refresh?retrain=false")
    assert res.status_code == 200
    assert res.json()["status"] == "running"
    assert res.json()["stage"] == "queued"


def test_refresh_requires_login_when_site_auth_is_on(hub_db, auth_db, monkeypatch):
    monkeypatch.setattr("app.auth.auth_enabled", lambda: True)
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    monkeypatch.setattr("src.config.ADMIN_EMAILS", frozenset({"admin@example.com"}))
    monkeypatch.setattr("app.auth.ADMIN_EMAILS", frozenset({"admin@example.com"}))

    from app.api import app

    res = TestClient(app).post("/api/refresh?retrain=false")
    assert res.status_code == 401
    assert res.json()["detail"] == "Login required"


def test_auth_me_includes_is_admin(admin_client):
    res = admin_client.get("/api/auth/me", headers=_auth_headers())
    assert res.status_code == 200
    body = res.json()
    assert body["authenticated"] is True
    assert body["user"]["is_admin"] is True

    other = admin_client.get("/api/auth/me", headers=_auth_headers("other@example.com"))
    assert other.json()["user"]["is_admin"] is False


def _verified_state(client, headers, user_id: str) -> bool:
    res = client.get("/api/admin/users", headers=headers)
    assert res.status_code == 200
    row = next(r for r in res.json()["accounts"] if r["id"] == user_id)
    return bool(row["email_verified_at"])


def test_admin_can_take_verification_away_and_give_it_back(admin_client):
    headers = _auth_headers()
    player = register_native_user("toggle.me@mail.com", "longpassword1", "Toggle", accept_terms=True)
    user_store.mark_email_verified(player["id"])
    assert _verified_state(admin_client, headers, player["id"]) is True

    res = admin_client.post(
        f"/api/admin/users/{player['id']}/email-verified",
        json={"verified": False},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["email_verified"] is False
    assert res.json()["email_verified_at"] is None
    assert _verified_state(admin_client, headers, player["id"]) is False

    res = admin_client.post(
        f"/api/admin/users/{player['id']}/email-verified",
        json={"verified": True},
        headers=headers,
    )
    assert res.status_code == 200
    assert res.json()["email_verified"] is True
    assert _verified_state(admin_client, headers, player["id"]) is True


def test_removing_verification_closes_draft_hub_for_that_account(admin_client):
    """The point of the toggle: the gate reads the row live, not the session."""
    player = register_native_user("gated.user@mail.com", "longpassword1", "Gated", accept_terms=True)
    user_store.mark_email_verified(player["id"])
    token = create_access_token(player, auth_type="native")
    player_headers = {"Authorization": f"Bearer {token}"}

    before = admin_client.get("/api/hub/memberships", headers=player_headers)
    assert before.status_code != 403

    res = admin_client.post(
        f"/api/admin/users/{player['id']}/email-verified",
        json={"verified": False},
        headers=_auth_headers(),
    )
    assert res.status_code == 200

    # Same token, already issued — the gate still closes.
    after = admin_client.get("/api/hub/memberships", headers=player_headers)
    assert after.status_code == 403


def test_admin_verification_unknown_user_is_404(admin_client):
    res = admin_client.post(
        "/api/admin/users/not-a-real-id/email-verified",
        json={"verified": True},
        headers=_auth_headers(),
    )
    assert res.status_code == 404


def test_admin_verification_forbidden_for_non_allowlisted(admin_client):
    player = register_native_user("victim@mail.com", "longpassword1", "Victim", accept_terms=True)
    res = admin_client.post(
        f"/api/admin/users/{player['id']}/email-verified",
        json={"verified": True},
        headers=_auth_headers("other@example.com"),
    )
    assert res.status_code == 403
    assert user_store.is_email_verified(user_store.get_user_by_id(player["id"])) is False


def _set_temp_password(client, user_id: str, password: str, admin_email: str = "admin@example.com"):
    return client.post(
        f"/api/admin/users/{user_id}/temp-password",
        json={"password": password},
        headers=_auth_headers(admin_email),
    )


def test_admin_temp_password_forces_a_change_and_never_echoes_it(admin_client):
    player = register_native_user("reset.me@mail.com", "longpassword1", "Reset", accept_terms=True)
    user_store.mark_email_verified(player["id"])

    res = _set_temp_password(admin_client, player["id"], "TempPass!2026")
    assert res.status_code == 200
    body = res.json()
    assert body["must_change_password"] is True
    # The password must not come back in any form.
    assert "TempPass!2026" not in res.text
    assert set(body) == {"user_id", "email", "must_change_password", "notified"}

    # The temp password works for signing in...
    assert authenticate_native_user("reset.me@mail.com", "TempPass!2026")["id"] == player["id"]
    # ...and the old one does not.
    with pytest.raises(HTTPException) as exc:
        authenticate_native_user("reset.me@mail.com", "longpassword1")
    assert exc.value.status_code == 401


def test_temp_password_closes_draft_hub_until_the_holder_picks_their_own(admin_client):
    player = register_native_user("forced.change@mail.com", "longpassword1", "Forced", accept_terms=True)
    user_store.mark_email_verified(player["id"])

    assert _set_temp_password(admin_client, player["id"], "TempPass!2026").status_code == 200

    # A session issued after the reset still cannot use the Hub.
    token = create_access_token(user_store.get_user_by_id(player["id"]), auth_type="native")
    headers = {"Authorization": f"Bearer {token}"}
    assert admin_client.get("/api/hub/memberships", headers=headers).status_code == 403

    change_native_password(player["id"], "TempPass!2026", "TheirOwnPass!9")
    assert user_store.must_change_password(user_store.get_user_by_id(player["id"])) is False

    token = create_access_token(user_store.get_user_by_id(player["id"]), auth_type="native")
    headers = {"Authorization": f"Bearer {token}"}
    assert admin_client.get("/api/hub/memberships", headers=headers).status_code != 403


def test_admin_temp_password_rejects_a_short_password(admin_client):
    player = register_native_user("short.pw@mail.com", "longpassword1", "Short", accept_terms=True)
    res = _set_temp_password(admin_client, player["id"], "short")
    assert res.status_code == 422
    assert user_store.must_change_password(user_store.get_user_by_id(player["id"])) is False


def test_admin_temp_password_unknown_user_is_404(admin_client):
    assert _set_temp_password(admin_client, "not-a-real-id", "TempPass!2026").status_code == 404


def test_admin_temp_password_forbidden_for_non_allowlisted(admin_client):
    player = register_native_user("pw.victim@mail.com", "longpassword1", "Victim", accept_terms=True)
    res = _set_temp_password(admin_client, player["id"], "TempPass!2026", admin_email="other@example.com")
    assert res.status_code == 403
    # The password was not changed.
    assert authenticate_native_user("pw.victim@mail.com", "longpassword1")["id"] == player["id"]


@pytest.mark.parametrize("sign_in", ["password", "google", "link_google"])
def test_admin_deactivates_temp_password_after_sign_in(admin_client, monkeypatch, sign_in):
    player = register_native_user("retire.temp@mail.com", "longpassword1", "Owner", accept_terms=True)
    user_store.mark_email_verified(player["id"])
    identity = {"id": "google-owner", "email": player["email"], "name": "Owner"}
    if sign_in == "google":
        upsert_google_user(identity)
    headers = _auth_headers()
    url = f"/api/admin/users/{player['id']}/temp-password"
    assert admin_client.post(url, headers=headers, json={"password": "TempPass!2026"}).status_code == 200

    if sign_in == "password":
        response = admin_client.post("/api/auth/login", json={"email": player["email"], "password": "TempPass!2026"})
        assert response.status_code == 200
        token = response.json()["token"]
    else:
        signed_in = upsert_google_user(identity)
        token = create_access_token(signed_in, auth_type="native")
    user_headers = {"Authorization": f"Bearer {token}"}
    accounts = admin_client.get("/api/admin/users", headers=headers).json()["accounts"]
    assert next(row for row in accounts if row["id"] == player["id"])["can_deactivate_temp_password"] is True
    assert admin_client.get("/api/hub/memberships", headers=user_headers).status_code == 403

    activity = Mock()
    monkeypatch.setattr("app.admin_routes.record_activity", activity)
    response = admin_client.post(f"{url}/deactivate", headers=headers)
    assert response.status_code == 200
    assert "TempPass!2026" not in response.text
    activity.assert_called_once()
    assert "Deactivated temporary password" in activity.call_args.args[2]
    updated = user_store.get_user_by_id(player["id"])
    assert updated["has_password"] is False
    assert updated["must_change_password_at"] is None
    assert user_store.can_deactivate_temp_password(updated) is False
    # The same session now has access; retiring the credential doesn't eject its holder.
    assert admin_client.get("/api/hub/memberships", headers=user_headers).status_code == 200
    with pytest.raises(HTTPException) as exc:
        authenticate_native_user(player["email"], "TempPass!2026")
    assert exc.value.status_code == 401
    if sign_in == "password":
        assert "Forgot password" in exc.value.detail
        assert "Google" not in exc.value.detail
    else:
        assert upsert_google_user(identity)["id"] == player["id"]
    # Email recovery remains available for password-only accounts too.
    reset = user_store.create_email_token(player["id"], "reset", hours=1)
    assert reset_password_with_token(reset, "TheirOwnPass!9")
    assert authenticate_native_user(player["email"], "TheirOwnPass!9")["id"] == player["id"]


def test_temp_password_deactivation_waits_for_sign_in_after_latest_reset(admin_client):
    player = register_native_user("wait.temp@mail.com", "longpassword1", "Owner", accept_terms=True)
    headers = _auth_headers()
    url = f"/api/admin/users/{player['id']}/temp-password"
    # A sign-in before issuing the temporary password doesn't qualify.
    authenticate_native_user(player["email"], "longpassword1")
    assert admin_client.post(url, headers=headers, json={"password": "TempPass!2026"}).status_code == 200
    with pytest.raises(HTTPException):
        authenticate_native_user(player["email"], "wrongpassword")
    accounts = admin_client.get("/api/admin/users", headers=headers).json()["accounts"]
    assert next(row for row in accounts if row["id"] == player["id"])["can_deactivate_temp_password"] is False
    assert admin_client.post(f"{url}/deactivate", headers=headers).status_code == 400
    authenticate_native_user(player["email"], "TempPass!2026")
    assert admin_client.post(url, headers=headers, json={"password": "AnotherTemp!9"}).status_code == 200
    assert admin_client.post(f"{url}/deactivate", headers=headers).status_code == 400
    assert user_store.must_change_password(user_store.get_user_by_id(player["id"])) is True
    authenticate_native_user(player["email"], "AnotherTemp!9")
    assert admin_client.post(f"{url}/deactivate", headers=headers).status_code == 200
    assert admin_client.post(f"{url}/deactivate", headers=headers).status_code == 400


def test_temp_password_deactivation_preserves_a_password_the_user_already_chose(admin_client):
    player = register_native_user("own.password@mail.com", "longpassword1", "Owner", accept_terms=True)
    headers = _auth_headers()
    url = f"/api/admin/users/{player['id']}/temp-password"
    assert admin_client.post(url, headers=headers, json={"password": "TempPass!2026"}).status_code == 200
    authenticate_native_user(player["email"], "TempPass!2026")
    change_native_password(player["id"], "TempPass!2026", "TheirOwnPass!9")
    assert admin_client.post(f"{url}/deactivate", headers=headers).status_code == 400
    assert authenticate_native_user(player["email"], "TheirOwnPass!9")["id"] == player["id"]


def test_temp_password_deactivation_requires_admin_and_known_account(admin_client):
    player = register_native_user("protected.temp@mail.com", "longpassword1", "Owner", accept_terms=True)
    assert _set_temp_password(admin_client, player["id"], "TempPass!2026").status_code == 200
    authenticate_native_user(player["email"], "TempPass!2026")
    url = f"/api/admin/users/{player['id']}/temp-password/deactivate"
    headers = _auth_headers("other@example.com")
    assert admin_client.post(url, headers=headers).status_code == 403
    assert admin_client.post(url).status_code == 401
    assert user_store.must_change_password(user_store.get_user_by_id(player["id"])) is True
    admin = user_store.get_user_by_email("admin@example.com")
    headers = {"Authorization": f"Bearer {create_access_token(admin, auth_type='native')}"}
    assert admin_client.post("/api/admin/users/missing/temp-password/deactivate", headers=headers).status_code == 404
