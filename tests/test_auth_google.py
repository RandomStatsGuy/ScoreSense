"""Google OAuth account create / link."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import (
    authenticate_native_user,
    create_access_token,
    delete_native_account,
    fetch_google_identity,
    google_authorize_url,
    register_native_user,
    upsert_google_user,
)
from src.auth import user_store


@pytest.fixture()
def auth_db(tmp_path, monkeypatch):
    monkeypatch.setattr(user_store, "AUTH_DB", tmp_path / "users.db")
    monkeypatch.setattr(user_store, "AUTH_DIR", tmp_path)
    return tmp_path


@pytest.fixture()
def api_client(auth_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: True)
    from app.api import app

    return TestClient(app)


def _identity(**overrides):
    data = {
        "id": "google-sub-1",
        "email": "caleb@gmail.com",
        "name": "Caleb K",
    }
    data.update(overrides)
    return data


def test_google_create_marks_verified_and_blocks_password(auth_db):
    user = upsert_google_user(_identity())
    assert user["email"] == "caleb@gmail.com"
    assert user["google_sub"] == "google-sub-1"
    assert user_store.is_email_verified(user)
    assert not user_store.has_usable_password(user)
    with pytest.raises(HTTPException) as exc:
        authenticate_native_user("caleb@gmail.com", "anything12")
    assert exc.value.status_code == 401
    assert "Google" in exc.value.detail


def test_google_same_sub_returns_same_account(auth_db):
    first = upsert_google_user(_identity())
    second = upsert_google_user(_identity(name="Other"))
    assert first["id"] == second["id"]


def test_google_links_existing_email_account(auth_db, monkeypatch):
    monkeypatch.setattr("app.auth.send_verification_email", lambda *a, **k: True)
    native = register_native_user("caleb@gmail.com", "password12", "Caleb", accept_terms=True)
    linked = upsert_google_user(_identity())
    assert linked["id"] == native["id"]
    row = user_store.get_user_by_email("caleb@gmail.com")
    assert row["google_sub"] == "google-sub-1"
    assert user_store.has_usable_password(row)
    again = authenticate_native_user("caleb@gmail.com", "password12")
    assert again["id"] == native["id"]


def test_google_only_delete_requires_email(auth_db):
    user = upsert_google_user(_identity())
    with pytest.raises(HTTPException) as exc:
        delete_native_account(user["id"], password="nope")
    assert exc.value.status_code == 400
    delete_native_account(user["id"], confirm_email="caleb@gmail.com")
    assert user_store.get_user_by_email("caleb@gmail.com") is None


def test_google_authorize_url_includes_scopes(monkeypatch):
    monkeypatch.setattr("app.auth.GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setattr("app.auth.GOOGLE_REDIRECT_URI", "http://127.0.0.1:8000/api/auth/google/callback")
    url = google_authorize_url("abc.sig")
    assert "accounts.google.com" in url
    assert "client-id" in url
    assert "openid" in url
    assert "abc.sig" in url


def test_fetch_google_identity_requires_email(monkeypatch):
    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"sub": "x", "email_verified": True}

    monkeypatch.setattr("app.auth.requests.get", lambda *a, **k: _Resp())
    with pytest.raises(HTTPException) as exc:
        fetch_google_identity("tok")
    assert exc.value.status_code == 400


def test_google_login_unconfigured(api_client, monkeypatch):
    monkeypatch.setattr("app.api.google_configured", lambda: False)
    res = api_client.get("/api/auth/google/login")
    assert res.status_code == 503


def test_google_login_returns_url(api_client, monkeypatch):
    monkeypatch.setattr("app.api.google_configured", lambda: True)
    monkeypatch.setattr("app.api.sign_oauth_state", lambda path: "signed-state")
    monkeypatch.setattr("app.api.google_authorize_url", lambda state: f"https://accounts.google.com/?state={state}")
    res = api_client.get("/api/auth/google/login?next=/hub/home")
    assert res.status_code == 200
    assert res.json()["url"].startswith("https://accounts.google.com/")


def test_google_callback_issues_native_token(api_client, auth_db, monkeypatch):
    monkeypatch.setattr("app.api.google_configured", lambda: True)
    monkeypatch.setattr("app.api.exchange_google_code", lambda code: "access")
    monkeypatch.setattr("app.api.fetch_google_identity", lambda token: _identity())
    monkeypatch.setattr("app.api.verify_oauth_state", lambda state: "/hub/home")
    monkeypatch.setattr("app.api.FRONTEND_URL", "http://localhost:5173")
    res = api_client.get("/api/auth/google/callback?code=abc&state=x", follow_redirects=False)
    assert res.status_code in (302, 307)
    assert "/auth/callback" in res.headers["location"]
    assert "token=" in res.headers["location"]
    row = user_store.get_user_by_email("caleb@gmail.com")
    assert row is not None
    token = create_access_token(row, auth_type="native")
    me = api_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    user = me.json()["user"]
    assert user["google_linked"] is True
    assert user["has_password"] is False
    assert user["email_verified"] is True


def test_auth_config_includes_google_flag(api_client, monkeypatch):
    monkeypatch.setattr("app.api.google_configured", lambda: True)
    res = api_client.get("/api/auth/config")
    assert res.status_code == 200
    assert res.json()["google_configured"] is True
