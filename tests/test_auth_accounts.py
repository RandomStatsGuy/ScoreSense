"""ScoreSense native account registration and login."""

import pytest
from fastapi.testclient import TestClient

from app.auth import (
    _hash_password,
    _verify_password,
    authenticate_native_user,
    create_access_token,
    decode_access_token,
    native_user_sub,
    register_native_user,
    reset_password_with_token,
    verify_email_token,
)
from src.auth import user_store


@pytest.fixture()
def auth_db(tmp_path, monkeypatch):
    monkeypatch.setattr(user_store, "AUTH_DB", tmp_path / "users.db")
    monkeypatch.setattr(user_store, "AUTH_DIR", tmp_path)
    return tmp_path


@pytest.fixture()
def mock_send(monkeypatch):
    sent = []

    def _capture_email(*args, **kwargs):
        sent.append({"args": args, "kwargs": kwargs})
        return True

    monkeypatch.setattr("src.email.smtp.send_email", _capture_email)
    monkeypatch.setattr("app.auth.send_verification_email", lambda *a, **k: sent.append({"verify": True}) or True)
    monkeypatch.setattr("app.auth.send_welcome_email", lambda *a, **k: sent.append({"welcome": True}) or True)
    monkeypatch.setattr("app.auth.send_password_reset_email", lambda *a, **k: sent.append({"reset": True}) or True)
    return sent


def test_register_and_password_verify(auth_db, mock_send):
    user = register_native_user("caleb@example.com", "secretpass", "Caleb K", accept_terms=True)
    assert user["display_name"] == "Caleb K"
    assert not user_store.is_email_verified(user)
    row = user_store.get_user_by_email("caleb@example.com")
    assert row is not None
    assert _verify_password("secretpass", row["password_hash"])
    assert not _verify_password("wrong", row["password_hash"])
    assert len(mock_send) >= 1


def test_verification_email_link_uses_api(auth_db, monkeypatch):
    captured = {}

    def _capture_send(to_email, *, subject, text_body):
        captured["body"] = text_body
        return True

    monkeypatch.setattr("src.auth.email_flow.send_email", _capture_send)
    monkeypatch.setattr("src.auth.email_flow.FRONTEND_URL", "https://app.fourthdownlabs.com")
    from src.auth.email_flow import send_verification_email

    send_verification_email("test@example.com", token="abc123", display_name="Test")
    assert "/api/auth/verify-email?token=abc123" in captured["body"]
    assert "/auth/verify?token=" not in captured["body"]


def test_register_requires_terms(auth_db):
    with pytest.raises(ValueError, match="Terms"):
        register_native_user("no@terms.com", "password12", "X", accept_terms=False)


def test_verify_email_and_welcome(auth_db, mock_send):
    user = register_native_user("verify@example.com", "password12", "V", accept_terms=True)
    mock_send.clear()
    token = user_store.create_email_token(user["id"], "verify", hours=24)
    verified = verify_email_token(token)
    assert verified is not None
    assert user_store.is_email_verified(verified)
    assert any(item.get("welcome") for item in mock_send)


def test_password_reset_flow(auth_db, mock_send):
    register_native_user("reset@example.com", "oldpassword1", "R", accept_terms=True)
    row = user_store.get_user_by_email("reset@example.com")
    user_store.mark_email_verified(row["id"])
    token = user_store.create_email_token(row["id"], "reset", hours=1)
    updated = reset_password_with_token(token, "newpassword2")
    assert updated is not None
    user = authenticate_native_user("reset@example.com", "newpassword2")
    assert user["email"] == "reset@example.com"


def test_native_jwt_sub_is_stable(auth_db, mock_send):
    user = user_store.create_user("a@b.com", _hash_password("longenough"), "A", terms_version="2026-06")
    token = create_access_token(user, auth_type="native")
    payload = decode_access_token(token)
    assert payload["sub"] == native_user_sub(user["id"])
    assert payload["auth_type"] == "native"


def test_duplicate_email_rejected(auth_db, mock_send):
    register_native_user("dup@example.com", "password12", "One", accept_terms=True)
    with pytest.raises(ValueError, match="already exists"):
        register_native_user("dup@example.com", "password12", "Two", accept_terms=True)


def test_authenticate_native_user(auth_db, mock_send):
    register_native_user("hub@example.com", "longpassword", "Hub User", accept_terms=True)
    user = authenticate_native_user("hub@example.com", "longpassword")
    assert user["display_name"] == "Hub User"


@pytest.fixture()
def api_client(auth_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: True)
    from app.api import app

    return TestClient(app)


def test_api_register_requires_terms(api_client, mock_send):
    res = api_client.post(
        "/api/auth/register",
        json={"email": "api@example.com", "password": "password12", "accept_terms": False},
    )
    assert res.status_code == 400


def test_api_register_and_verify(api_client, mock_send):
    res = api_client.post(
        "/api/auth/register",
        json={"email": "api2@example.com", "password": "password12", "accept_terms": True},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["email_verified"] is False
    row = user_store.get_user_by_email("api2@example.com")
    token = user_store.create_email_token(row["id"], "verify", hours=24)
    verify_res = api_client.get(f"/api/auth/verify-email?token={token}", follow_redirects=False)
    assert verify_res.status_code in (302, 307)
    assert user_store.is_email_verified(user_store.get_user_by_id(row["id"]))


def test_api_forgot_password(api_client, mock_send):
    register_native_user("fp@example.com", "password12", "FP", accept_terms=True)
    res = api_client.post("/api/auth/forgot-password", json={"email": "fp@example.com"})
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def _register_and_token(api_client, email="change@example.com", password="password12"):
    res = api_client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "display_name": "Change User", "accept_terms": True},
    )
    assert res.status_code == 200
    return res.json()["token"]


def test_api_change_password(api_client, mock_send):
    token = _register_and_token(api_client)
    headers = {"Authorization": f"Bearer {token}"}
    bad = api_client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": "wrong", "new_password": "newpassword9"},
    )
    assert bad.status_code == 400
    ok = api_client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": "password12", "new_password": "newpassword9"},
    )
    assert ok.status_code == 200
    assert ok.json()["user"]["email"] == "change@example.com"
    login = api_client.post(
        "/api/auth/login",
        json={"email": "change@example.com", "password": "newpassword9"},
    )
    assert login.status_code == 200


def test_api_update_profile(api_client, mock_send):
    token = _register_and_token(api_client, email="profile@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    res = api_client.patch(
        "/api/auth/profile",
        headers=headers,
        json={"display_name": "Updated Name"},
    )
    assert res.status_code == 200
    assert res.json()["user"]["name"] == "Updated Name"


def test_api_sms_opt_in_persists_phone(api_client, mock_send):
    denied = api_client.post(
        "/api/auth/sms-opt-in",
        json={"phone": "5551234567", "consent": True},
    )
    assert denied.status_code == 401
    token = _register_and_token(api_client, email="sms@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    bad = api_client.post(
        "/api/auth/sms-opt-in",
        headers=headers,
        json={"phone": "5551234567", "consent": False},
    )
    assert bad.status_code == 400
    short = api_client.post(
        "/api/auth/sms-opt-in",
        headers=headers,
        json={"phone": "555", "consent": True},
    )
    assert short.status_code == 400
    res = api_client.post(
        "/api/auth/sms-opt-in",
        headers=headers,
        json={"phone": "(555) 123-4567", "consent": True},
    )
    assert res.status_code == 200
    body = res.json()["user"]
    assert body["phone"] == "5551234567"
    assert body["sms_opted_in"] is True
    me = api_client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["phone"] == "5551234567"
    assert me.json()["user"]["sms_opted_in"] is True
    row = user_store.get_user_by_email("sms@example.com")
    assert row["phone"] == "5551234567"
    assert row["sms_opted_in_at"]


def test_api_accept_terms_and_me(api_client, mock_send, monkeypatch):
    token = _register_and_token(api_client, email="terms@example.com")
    row = user_store.get_user_by_email("terms@example.com")
    user_store.accept_terms(row["id"], "2026-old")
    monkeypatch.setattr("app.auth.TERMS_VERSION", "2026-new")
    headers = {"Authorization": f"Bearer {token}"}
    me = api_client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["terms_current"] is False
    accept = api_client.post("/api/auth/accept-terms", headers=headers)
    assert accept.status_code == 200
    assert accept.json()["user"]["terms_current"] is True


def test_api_delete_account(api_client, mock_send):
    token = _register_and_token(api_client, email="delete@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    res = api_client.post(
        "/api/auth/delete-account",
        headers=headers,
        json={"password": "password12"},
    )
    assert res.status_code == 200
    assert user_store.get_user_by_email("delete@example.com") is None
    login = api_client.post(
        "/api/auth/login",
        json={"email": "delete@example.com", "password": "password12"},
    )
    assert login.status_code == 401


def test_api_forgot_password_rate_limit(api_client, mock_send, monkeypatch):
    from src.auth.rate_limit import reset_rate_limits

    reset_rate_limits()
    monkeypatch.setattr("app.api.check_rate_limit", lambda key, **kw: False)
    register_native_user("rate@example.com", "password12", "Rate", accept_terms=True)
    res = api_client.post("/api/auth/forgot-password", json={"email": "rate@example.com"})
    assert res.status_code == 429


def test_api_resend_already_verified(api_client, mock_send):
    res = api_client.post(
        "/api/auth/register",
        json={"email": "verified@example.com", "password": "password12", "accept_terms": True},
    )
    token = res.json()["token"]
    row = user_store.get_user_by_email("verified@example.com")
    user_store.mark_email_verified(row["id"])
    headers = {"Authorization": f"Bearer {token}"}
    resend = api_client.post("/api/auth/resend-verification", headers=headers, json={})
    assert resend.status_code == 200
    body = resend.json()
    assert body["sent"] is False
    assert body.get("already_verified") is True


def test_api_resend_orphaned_native_session(api_client, mock_send):
    user = register_native_user("orphan@example.com", "password12", "Orphan", accept_terms=True)
    token = create_access_token(user, auth_type="native")
    user_store.delete_user(user["id"])
    headers = {"Authorization": f"Bearer {token}"}
    resend = api_client.post(
        "/api/auth/resend-verification",
        headers=headers,
        json={"email": "orphan@example.com"},
    )
    assert resend.status_code == 200
    body = resend.json()
    assert body["sent"] is False
    assert body.get("reason") == "not_found"

    me = api_client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    pub = me.json()["user"]
    assert pub["account_found"] is False
    assert pub["email_verified"] is False


def test_login_rate_limit(api_client, auth_db):
    from src.auth.rate_limit import reset_rate_limits

    reset_rate_limits()
    res = None
    for _ in range(16):
        res = api_client.post(
            "/api/auth/login",
            json={"email": "ratelimit@example.com", "password": "wrong"},
        )
        if res.status_code == 429:
            break
    assert res is not None
    assert res.status_code == 429
    reset_rate_limits()
