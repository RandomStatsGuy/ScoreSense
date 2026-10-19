"""Credential persistence, redaction, admin access, and live Jira credential reads."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import create_access_token, register_native_user
from src import config
from src.auth import user_store
from src.ops import admin_store, connection_store as store
from src.support import jira_bugs

TOKEN = "test-api-token-that-must-never-be-returned"


@pytest.fixture()
def client(auth_db, monkeypatch):
    monkeypatch.setattr(config, "JIRA_EMAIL", "")
    monkeypatch.setattr(config, "JIRA_API_TOKEN", "")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"admin@fourthdown.test"}))
    monkeypatch.setattr("app.auth.ADMIN_EMAILS", frozenset({"admin@fourthdown.test"}))
    from app.admin_connection_routes import router
    from app.support_routes import router as support
    app = FastAPI()
    app.include_router(router)
    app.include_router(support)
    return TestClient(app)


def headers(email="admin@fourthdown.test"):
    user = register_native_user(email, "longpassword1", "Connection admin", accept_terms=True)
    user_store.mark_email_verified(user["id"])
    return {"Authorization": "Bearer " + create_access_token(user, auth_type="native")}


def save(client, auth, values=None):
    return client.put("/api/admin/connections/jira", headers=auth,
                      json={"values": values or {"email": "jira@fourthdown.test", "api_token": TOKEN}})


@pytest.mark.parametrize("method,path", [("get", ""), ("put", "/jira"), ("delete", "/jira"), ("post", "/jira/check")])
def test_admin_required_on_every_action(client, method, path):
    request = getattr(client, method)
    assert request("/api/admin/connections" + path).status_code == 401
    response = request("/api/admin/connections" + path, headers=headers("member@fourthdown.test"))
    assert response.status_code == 403


def test_keys_encrypted_and_never_returned_or_audited(client):
    auth = headers()
    response = save(client, auth)
    assert response.status_code == 200
    assert TOKEN not in response.text
    assert response.json()["configured"] is True
    listing = client.get("/api/admin/connections", headers=auth)
    assert listing.headers["cache-control"] == "no-store"
    assert TOKEN not in listing.text
    fields = {field["id"]: field for field in listing.json()["connections"][0]["fields"]}
    assert fields["api_token"]["value"] == ""
    assert fields["api_token"]["configured"] is True
    assert fields["api_token"]["source"] == "saved"
    assert fields["email"]["value"] == "jira@fourthdown.test"
    assert TOKEN.encode() not in Path(config.ADMIN_OPS_DB).read_bytes()
    assert TOKEN not in json.dumps(admin_store.list_activity())
    assert "Updated Jira connection" in json.dumps(admin_store.list_activity())
    # Fresh reads use persisted ciphertext, without mutating environment config.
    assert store.connection_values("jira")["api_token"] == TOKEN
    assert config.JIRA_API_TOKEN == ""
    assert client.get("/api/support/bugs/status").json() == {"enabled": True}


def test_blank_key_keeps_existing_and_rotation_is_immediate(client):
    auth = headers()
    assert save(client, auth).status_code == 200
    assert save(client, auth, {"email": "changed@fourthdown.test", "api_token": ""}).status_code == 200
    assert store.connection_values("jira") == {"email": "changed@fourthdown.test", "api_token": TOKEN}
    assert save(client, auth, {"api_token": "rotated-key"}).status_code == 200
    assert store.connection_values("jira")["api_token"] == "rotated-key"


def test_server_defaults_and_reset(client, monkeypatch):
    monkeypatch.setattr(config, "JIRA_EMAIL", "server@fourthdown.test")
    monkeypatch.setattr(config, "JIRA_API_TOKEN", "server-secret")
    auth = headers()
    assert save(client, auth).status_code == 200
    response = client.delete("/api/admin/connections/jira", headers=auth)
    assert response.status_code == 200
    assert TOKEN not in response.text and "server-secret" not in response.text
    assert store.connection_values("jira")["api_token"] == "server-secret"
    assert all(field["source"] == "server" for field in response.json()["fields"])


@pytest.mark.parametrize("values", [
    {"email": "bad-email", "api_token": TOKEN}, {"api_token": TOKEN},
    {"JWT_SECRET": TOKEN}, {"email": [TOKEN]}, {"api_token": TOKEN + "\n"},
    {"api_token": TOKEN * 400}, [TOKEN], None,
])
def test_invalid_values_never_echo_credentials_or_write(client, values):
    response = client.put("/api/admin/connections/jira", headers=headers(), json={"values": values})
    assert response.status_code == 400
    assert TOKEN not in response.text
    assert not store.connection_status("jira")["configured"]


def test_unknown_service_cannot_set_arbitrary_environment(client):
    response = client.put("/api/admin/connections/JWT_SECRET", headers=headers(), json={"values": {"key": TOKEN}})
    assert response.status_code == 404
    assert TOKEN not in response.text


def test_new_registered_service_uses_same_store_and_response(client, monkeypatch):
    monkeypatch.setitem(store.CONNECTIONS, "future", {
        "label": "Future service", "purpose": "A registered integration", "fields": {
            "key": {"label": "API key", "secret": True, "config": "JIRA_API_TOKEN"},
        },
    })
    auth = headers()
    response = client.put("/api/admin/connections/future", headers=auth, json={"values": {"key": TOKEN}})
    assert response.status_code == 200
    assert TOKEN not in response.text
    assert store.connection_values("future")["key"] == TOKEN
    assert len(client.get("/api/admin/connections", headers=auth).json()["connections"]) == 2


def test_jwt_rotation_does_not_lose_saved_connections(client, monkeypatch):
    save(client, headers())
    monkeypatch.setattr(config, "JWT_SECRET", "rotated-session-signing-secret")
    assert store.connection_values("jira")["api_token"] == TOKEN


def test_missing_encryption_key_fails_closed_and_can_reset(client):
    auth = headers()
    save(client, auth)
    (Path(config.ADMIN_OPS_DIR) / "connections.key").unlink()
    response = client.get("/api/admin/connections", headers=auth)
    status = response.json()["connections"][0]
    assert status["error"]
    assert status["configured"] is False
    assert TOKEN not in response.text
    assert client.get("/api/support/bugs/status").json() == {"enabled": False}
    assert client.delete("/api/admin/connections/jira", headers=auth).status_code == 200


def test_saved_jira_credentials_used_for_actual_bug_create(client, monkeypatch):
    auth = headers()
    save(client, auth)
    calls = []

    class Result:
        status_code = 201
        def json(self):
            return {"key": "SCORE-TEST", "id": "123"}

    def post(url, **kwargs):
        calls.append(kwargs)
        return Result()

    monkeypatch.setattr(jira_bugs.requests, "post", post)
    response = client.post("/api/support/bugs", headers=auth, json={
        "title": "Report action is missing", "what_happened": "The report form has no send button when the status request fails.",
    })
    assert response.status_code == 200
    assert response.json()["key"] == "SCORE-TEST"
    assert calls[0]["auth"] == ("jira@fourthdown.test", TOKEN)
    assert calls[0]["json"]["fields"]["labels"] == ["user-reported", "pickup"]


@pytest.mark.parametrize("status,allowed,ok", [(200, True, True), (200, False, False), (401, False, False), (502, False, False)])
def test_connection_check_uses_permissions_without_creating_ticket(client, monkeypatch, status, allowed, ok):
    auth = headers()
    save(client, auth)
    calls = []

    class Result:
        status_code = status
        def json(self):
            return {"permissions": {key: {"havePermission": allowed} for key in ("BROWSE_PROJECTS", "CREATE_ISSUES")}}

    def get(url, **kwargs):
        assert url.endswith("/mypermissions")
        assert kwargs["auth"] == ("jira@fourthdown.test", TOKEN)
        assert kwargs["allow_redirects"] is False
        calls.append(url)
        return Result()

    monkeypatch.setattr(jira_bugs.requests, "get", get)
    monkeypatch.setattr(jira_bugs.requests, "post", lambda *a, **k: pytest.fail("Connection checks never create tickets"))
    response = client.post("/api/admin/connections/jira/check", headers=auth)
    assert response.status_code == 200
    assert response.json()["ok"] is ok
    assert TOKEN not in response.text
    assert len(calls) == 1
