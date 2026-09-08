"""Draft Hub WebSocket authentication helpers."""

import pytest

from app.auth import (
    create_access_token,
    decode_token_or_none,
    hub_auth_enabled,
    ws_cookie_origin_trusted,
    ws_handshake_uses_cookie_auth,
    ws_user_from_handshake,
    ws_user_from_token,
)
from src.auth import user_store
from src.draft_hub import storage
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_decode_token_or_none_rejects_garbage():
    assert decode_token_or_none("not-a-jwt") is None


def test_ws_user_from_token_missing_when_hub_auth(hub_db, monkeypatch):
    if not hub_auth_enabled():
        pytest.skip("Hub auth disabled in this environment")
    assert ws_user_from_token(None) is None
    assert ws_user_from_token("bad-token") is None
    assert ws_user_from_handshake(None, None) is None
    assert ws_user_from_handshake(None, "bad-token") is None


def test_ws_user_from_handshake_falls_back_to_cookie(hub_db, auth_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: True)
    user = user_store.create_user("cookie@example.com", "pbkdf2_sha256$120000$00$00", "Cookie")
    token = create_access_token(user, auth_type="native")
    assert ws_user_from_handshake(None, None) is None
    assert ws_user_from_handshake(None, token) is not None
    assert ws_user_from_handshake("bad-token", token) is not None
    assert ws_handshake_uses_cookie_auth(None, token) is True
    assert ws_handshake_uses_cookie_auth(token, token) is False
    assert ws_handshake_uses_cookie_auth("bad-token", token) is True
    assert ws_handshake_uses_cookie_auth(None, None) is False


def test_ws_cookie_origin_trusted_matches_frontend_or_host():
    frontend = "https://app.example.test"
    assert ws_cookie_origin_trusted(
        "https://app.example.test",
        "app.example.test",
        frontend_url=frontend,
    )
    assert ws_cookie_origin_trusted(
        "http://127.0.0.1:5173",
        "127.0.0.1:5173",
        frontend_url="http://localhost:5173",
    )
    assert not ws_cookie_origin_trusted(
        "https://evil.example",
        "app.example.test",
        frontend_url=frontend,
    )
    assert not ws_cookie_origin_trusted(None, "app.example.test", frontend_url=frontend)
    assert not ws_cookie_origin_trusted("null", "app.example.test", frontend_url=frontend)
    assert not ws_cookie_origin_trusted(
        "https://app.example.test",
        None,
        frontend_url="http://localhost:5173",
    )


def test_verify_league_membership(hub_db, auth_db):
    user = user_store.create_user("ws@example.com", "pbkdf2_sha256$120000$00$00", "WS User")
    from app.auth import native_user_sub

    sub = native_user_sub(user["id"])
    token = create_access_token(user, auth_type="native")
    assert decode_token_or_none(token) is not None
    assert ws_user_from_token(token) is not None

    ws = storage.get_or_create_workspace(sub)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(sub, "WS League", 2025, rules, workspace_id=ws["id"])
    assert storage.verify_league_membership(sub, league["id"]) is True

    outsider = user_store.create_user("other@example.com", "pbkdf2_sha256$120000$00$00", "Other")
    outsider_sub = native_user_sub(outsider["id"])
    assert storage.verify_league_membership(outsider_sub, league["id"]) is False
    member = user_store.create_user("seat@example.com", "pbkdf2_sha256$120000$00$00", "Seat")
    member_sub = native_user_sub(member["id"])
    storage.join_league(member_sub, league["room_code"], "Seat Team")
    assert storage.verify_league_membership(member_sub, league["id"]) is True
    assert storage.verify_league_membership(sub, "missing-league") is False
