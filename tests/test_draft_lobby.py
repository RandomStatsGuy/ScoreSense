"""Guest draft lobby, snake-slot claims, and live-draft open email."""

from fastapi.testclient import TestClient
from unittest.mock import Mock
import pytest

from app.auth import create_access_token, create_guest_access_token, require_hub_user
from src.auth import user_store
from src.draft_hub import storage
from src.draft_hub.draft_state import get_room_state, start_draft
from src.draft_hub.lobby import (
    LIVE_MEMBERS_ONLY_MESSAGE,
    build_lobby_preview,
    build_lobby_url,
    claim_draft_slot,
    fill_empty_seats_with_bots,
    join_lobby,
    notify_managers_draft_open,
)
from src.draft_hub.mock_draft import start_mock_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


def test_build_lobby_url_uses_room_code():
    assert build_lobby_url("ab12cd").endswith("/lobby/AB12CD")


def test_mock_lobby_leaves_seats_open(hub_db):
    out = start_mock_draft(
        "host-sub",
        mode="quick_bots",
        team_count=8,
        lobby=True,
        preset_id="snake_draft_v1",
    )
    assert out["lobby"] is True
    assert out["auto_started"] is False
    assert out["room_code"]
    league = storage.get_league(out["league_id"])
    teams = storage.list_league_teams(out["league_id"])
    assert league["test_mode"] is True
    assert league["status"] == "setup"
    assert len(teams) == 1
    preview = build_lobby_preview(league["room_code"])
    assert preview["can_join"] is True
    assert preview["can_walk_in"] is True
    assert preview["members_only"] is False
    assert preview["open_seats"] == 7
    assert preview["pick_draft"] is True


def test_account_can_join_and_claim_snake_slot(hub_db):
    out = start_mock_draft(
        "host-sub",
        mode="quick_bots",
        team_count=8,
        lobby=True,
        preset_id="snake_draft_v1",
    )
    code = out["room_code"]
    joined = join_lobby(code, "Alex", user={"sub": "account-alex", "auth_type": "patreon"})
    assert joined["token"] is None
    assert joined["auth_type"] == "patreon"
    assert joined["team"]["name"] == "Alex"
    assert joined["team"]["is_guest"] is False

    state = claim_draft_slot(out["league_id"], joined["team"]["user_sub"], 1)
    me = next(t for t in state["teams"] if t["id"] == joined["team"]["id"])
    assert me["draft_slot"] == 1

    claim_draft_slot(out["league_id"], "host-sub", 8)
    filled = fill_empty_seats_with_bots(out["league_id"])
    assert filled == 6
    started = start_draft(out["league_id"], "host-sub")
    order = started["session"]["nomination_order"]
    assert order[0] == joined["team"]["id"]
    host = storage.get_team_by_user(out["league_id"], "host-sub")
    assert order[7] == host["id"]


def test_legacy_guest_can_read_public_preview_but_not_room_or_hub(hub_db, monkeypatch):
    from app.api import app

    out = start_mock_draft(
        "http-host",
        mode="quick_bots",
        team_count=6,
        lobby=True,
        preset_id="linear_draft_v1",
    )
    legacy_team = storage.join_league("guest:legacy-bea", out["room_code"], "Bea")
    legacy_token, _ = create_guest_access_token(league_id=out["league_id"], team_id=legacy_team["id"], name="Bea", guest_id="legacy-bea")
    client = TestClient(app)
    public = client.get(f"/api/hub/lobby/{out['room_code']}")
    assert public.status_code == 200, public.text
    assert public.json()["name"]
    assert "user_sub" not in str(public.json().get("seats"))

    headers = {"Authorization": f"Bearer {legacy_token}"}
    timers = Mock(side_effect=AssertionError("Guest reads must not advance a draft"))
    monkeypatch.setattr("app.hub_routes.check_timers", timers)
    room = client.get(f"/api/hub/league/{out['league_id']}", headers=headers)
    assert room.status_code == 401, room.text
    timers.assert_not_called()

    blocked = client.get("/api/hub/mock-drafts", headers=headers)
    assert blocked.status_code == 401


def test_signed_in_join_uses_account_not_guest(hub_db, auth_db):
    user = user_store.create_user("join@example.com", "pbkdf2_sha256$120000$00$00", "Pat")
    from app.auth import native_user_sub

    sub = native_user_sub(user["id"])
    out = start_mock_draft("host-sub", mode="quick_bots", team_count=8, lobby=True)
    joined = join_lobby(out["room_code"], "Pat", user={"sub": sub, "auth_type": "native"})
    assert joined["token"] is None
    assert joined["team"]["user_sub"] == sub
    assert joined["team"]["is_guest"] is False


def test_full_lobby_rejects_another_account(hub_db):
    out = start_mock_draft("host-sub", mode="quick_bots", team_count=2, lobby=True)
    join_lobby(out["room_code"], "Alex", user={"sub": "account-alex", "auth_type": "patreon"})
    try:
        join_lobby(out["room_code"], "Bea", user={"sub": "account-bea", "auth_type": "patreon"})
        raise AssertionError("expected full room")
    except ValueError as exc:
        assert "full" in str(exc).lower()


def test_live_notify_emails_managers(hub_db, auth_db, monkeypatch):
    sent = []

    def fake_send(to_email, *, subject, text_body, html_body=None):
        sent.append((to_email, subject, text_body))
        return True

    monkeypatch.setattr("src.draft_hub.lobby.send_email", fake_send)
    comm = user_store.create_user("comm@example.com", "pbkdf2_sha256$120000$00$00", "Comm")
    mgr = user_store.create_user("mgr@example.com", "pbkdf2_sha256$120000$00$00", "Mgr")
    from app.auth import native_user_sub

    comm_sub = native_user_sub(comm["id"])
    mgr_sub = native_user_sub(mgr["id"])
    rules = load_preset("snake_draft_v1")
    league = storage.create_league(comm_sub, "Sunday League", 2026, rules, team_count=4)
    storage.join_league(mgr_sub, league["room_code"], "The Mgrs")
    result = notify_managers_draft_open(league["id"], comm_sub)
    assert result["recipients"] == 1
    assert result["sent"] == 1
    assert sent[0][0] == "mgr@example.com"
    assert "draft is open" in sent[0][1].lower()
    assert "/lobby/" in sent[0][2]
    assert "members only" in sent[0][2].lower()
    assert "guests cannot" in sent[0][2].lower()

    again = notify_managers_draft_open(league["id"], comm_sub, force=False)
    assert again["skipped"] is True
    assert len(sent) == 1


def test_http_start_fill_bots_and_notify(hub_db, monkeypatch):
    from app.api import app

    sent = []
    monkeypatch.setattr("src.draft_hub.lobby.send_email", lambda *a, **k: sent.append(k) or True)

    app.dependency_overrides[require_hub_user] = lambda: {"sub": "live-host", "auth_type": "dev"}
    client = TestClient(app)
    try:
        rules = LeagueRules.model_validate(load_preset("salary_cap_auction_v1").model_dump())
        league = storage.create_league("live-host", "Cap League", 2026, rules, team_count=4)
        storage.create_league_invite(
            league["id"],
            "owner@example.com",
            "Owners",
            "live-host",
            token="tok-invite-1",
            expires_at="2099-01-01T00:00:00+00:00",
        )
        res = client.post(f"/api/hub/league/{league['id']}/start?allow_empty=true")
        assert res.status_code == 200, res.text
        assert sent
        assert storage.get_league(league["id"])["lobby_notified_at"]

        mock = start_mock_draft("live-host", mode="quick_bots", team_count=6, lobby=True)
        start = client.post(f"/api/hub/league/{mock['league_id']}/start?fill_bots=true")
        assert start.status_code == 200, start.text
        teams = storage.list_league_teams(mock["league_id"])
        assert len(teams) == 6
        assert sum(1 for t in teams if t.get("is_bot")) == 5
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_guest_token_round_trip():
    token, sub = create_guest_access_token(
        league_id="lg-1",
        team_id="tm-1",
        name="Alex",
        guest_id="abc",
    )
    assert sub == "guest:abc"
    from app.auth import decode_token_or_none

    payload = decode_token_or_none(token)
    assert payload["auth_type"] == "guest"
    assert payload["league_id"] == "lg-1"
    assert create_access_token({"id": "x", "display_name": "N", "email": "n@e.com"}, auth_type="native")


def test_guest_request_allowed_only_for_public_lobby_preview():
    from types import SimpleNamespace

    from app.auth import guest_request_allowed

    user = {"sub": "guest:abc", "auth_type": "guest", "league_id": "lg-1"}

    def req(path: str, method: str = "GET"):
        return SimpleNamespace(url=SimpleNamespace(path=path), method=method)

    assert guest_request_allowed(req("/api/hub/lobby/ABCD"), user) is True
    assert guest_request_allowed(req("/api/hub/draft-room/lg-1"), user) is False
    assert guest_request_allowed(req("/api/hub/league/lg-1"), user) is False
    assert guest_request_allowed(req("/api/hub/league/lg-1/pick"), user) is False
    assert guest_request_allowed(req("/api/hub/league/lg-1/pick", "POST"), user) is False
    assert guest_request_allowed(req("/api/hub/league/lg-1/bid", "POST"), user) is False
    assert guest_request_allowed(req("/api/hub/lobby/ABCD/join", "POST"), user) is False
    assert guest_request_allowed(req("/api/hub/ws/lg-1"), user) is False
    assert guest_request_allowed(req("/api/hub/league/other"), user) is False
    assert guest_request_allowed(req("/api/hub/ws/other"), user) is False
    assert guest_request_allowed(req("/api/hub/mock-drafts"), user) is False
    # Lobby join stays reachable even if the token is missing league_id.
    bare = {"sub": "guest:abc", "auth_type": "guest"}
    assert guest_request_allowed(req("/api/hub/lobby/ABCD"), bare) is True
    assert guest_request_allowed(req("/api/hub/league/lg-1"), bare) is False


def test_live_lobby_rejects_guest_walk_in(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("live-comm", "Harbor", 2026, rules, team_count=8)
    preview = build_lobby_preview(league["room_code"])
    assert preview["members_only"] is True
    assert preview["can_walk_in"] is False
    try:
        join_lobby(league["room_code"], "Walk In")
        raise AssertionError("expected members-only rejection")
    except ValueError as exc:
        assert "members" in str(exc).lower()
        assert str(exc) == LIVE_MEMBERS_ONLY_MESSAGE


def test_live_lobby_rejects_signed_in_non_member(hub_db, auth_db):
    user = user_store.create_user("stranger@example.com", "pbkdf2_sha256$120000$00$00", "Pat")
    from app.auth import native_user_sub

    stranger = native_user_sub(user["id"])
    rules = load_preset("snake_draft_v1")
    league = storage.create_league("live-comm", "Sunday", 2026, rules, team_count=4)
    try:
        join_lobby(
            league["room_code"],
            "Pat",
            user={"sub": stranger, "auth_type": "native"},
        )
        raise AssertionError("expected members-only rejection")
    except ValueError as exc:
        assert "members" in str(exc).lower()
    teams = storage.list_league_teams(league["id"])
    assert all(t.get("user_sub") != stranger for t in teams)


def test_live_lobby_member_can_reenter(hub_db, auth_db):
    comm = user_store.create_user("comm2@example.com", "pbkdf2_sha256$120000$00$00", "Comm")
    mgr = user_store.create_user("mgr2@example.com", "pbkdf2_sha256$120000$00$00", "Mgr")
    from app.auth import native_user_sub

    comm_sub = native_user_sub(comm["id"])
    mgr_sub = native_user_sub(mgr["id"])
    rules = load_preset("snake_draft_v1")
    league = storage.create_league(comm_sub, "Member Night", 2026, rules, team_count=4)
    storage.join_league(mgr_sub, league["room_code"], "The Mgrs")
    joined = join_lobby(
        league["room_code"],
        "The Mgrs",
        user={"sub": mgr_sub, "auth_type": "native"},
    )
    assert joined["token"] is None
    assert joined["team"]["user_sub"] == mgr_sub
    assert joined["team"]["name"] == "The Mgrs"


def test_live_lobby_http_rejects_anonymous_join(hub_db):
    from app.api import app

    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("live-http", "Cap Night", 2026, rules, team_count=6)
    client = TestClient(app)
    res = client.post(
        f"/api/hub/lobby/{league['room_code']}/join",
        json={"display_name": "Walk In"},
    )
    assert res.status_code == 401, res.text
    assert "sign in" in res.json()["detail"].lower()


def test_get_room_state_includes_slots(hub_db):
    out = start_mock_draft("host-sub", mode="quick_bots", team_count=4, lobby=True)
    joined = join_lobby(out["room_code"], "Alex", user={"sub": "account-alex", "auth_type": "patreon"})
    claim_draft_slot(out["league_id"], joined["team"]["user_sub"], 2)
    state = get_room_state(out["league_id"], joined["team"]["user_sub"])
    guest = next(t for t in state["teams"] if t["user_sub"] == joined["team"]["user_sub"])
    assert guest["draft_slot"] == 2
    assert state["viewer"]["is_guest"] is False


@pytest.mark.parametrize("auth_required", [True, False])
def test_practice_lobby_join_requires_account_with_gates_on_or_off(hub_db, auth_db, monkeypatch, auth_required):
    from app.api import app
    from src.draft_hub.lobby import ACCOUNT_REQUIRED_MESSAGE

    monkeypatch.setattr("src.config.AUTH_REQUIRED", auth_required)
    monkeypatch.setattr("src.config.HUB_AUTH_REQUIRED", auth_required)
    out = start_mock_draft("fixture-host", mode="quick_bots", team_count=4, lobby=True)
    before = storage.list_league_teams(out["league_id"])
    with pytest.raises(ValueError, match=ACCOUNT_REQUIRED_MESSAGE):
        join_lobby(out["room_code"], "Visitor")
    client = TestClient(app)
    denied = client.post(f"/api/hub/lobby/{out['room_code']}/join", json={"display_name": "Visitor"})
    assert denied.status_code == 401
    assert storage.list_league_teams(out["league_id"]) == before
    user = user_store.create_user("join-boundary@fixture.test", "pbkdf2_sha256$120000$00$00", "Account Manager")
    user_store.mark_email_verified(user["id"])
    token = create_access_token(user, auth_type="native")
    joined = client.post(f"/api/hub/lobby/{out['room_code']}/join", json={"display_name": "Account Manager"}, headers={"Authorization": f"Bearer {token}"})
    assert joined.status_code == 200, joined.text
    assert joined.json()["token"] is None
    assert joined.json()["team"]["is_guest"] is False


@pytest.mark.parametrize("auth_required", [True, False])
def test_unverified_account_cannot_create_a_lobby_seat(hub_db, auth_db, monkeypatch, auth_required):
    from app.api import app

    monkeypatch.setattr("src.config.AUTH_REQUIRED", auth_required)
    monkeypatch.setattr("src.config.HUB_AUTH_REQUIRED", auth_required)
    out = start_mock_draft("fixture-host", mode="quick_bots", team_count=4, lobby=True)
    before = storage.list_league_teams(out["league_id"])
    user = user_store.create_user("unverified-join@fixture.test", "pbkdf2_sha256$120000$00$00", "Unverified")
    token = create_access_token(user, auth_type="native")
    denied = TestClient(app).post(f"/api/hub/lobby/{out['room_code']}/join", json={"display_name": "Unverified"}, headers={"Authorization": f"Bearer {token}"})
    assert denied.status_code == 403
    assert "Verify your email" in denied.json()["detail"]
    assert storage.list_league_teams(out["league_id"]) == before


@pytest.mark.parametrize("auth_required", [True, False])
def test_legacy_guest_cannot_join_bid_pick_or_open_socket(hub_db, auth_db, monkeypatch, auth_required):
    from app.api import app
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.setattr("src.config.AUTH_REQUIRED", auth_required)
    monkeypatch.setattr("src.config.HUB_AUTH_REQUIRED", auth_required)
    out = start_mock_draft("fixture-host", mode="quick_bots", team_count=4, lobby=True)
    team = storage.join_league("guest:legacy-test", out["room_code"], "Legacy guest")
    token, _ = create_guest_access_token(league_id=out["league_id"], team_id=team["id"], name="Legacy guest", guest_id="legacy-test")
    headers = {"Authorization": f"Bearer {token}"}
    bid = Mock(side_effect=AssertionError("Guest must not bid"))
    pick = Mock(side_effect=AssertionError("Guest must not pick"))
    timers = Mock(side_effect=AssertionError("Guest must not advance timers"))
    monkeypatch.setattr("app.hub_routes.place_bid", bid)
    monkeypatch.setattr("app.hub_routes.make_pick", pick)
    monkeypatch.setattr("app.hub_routes.check_timers", timers)
    client = TestClient(app)
    assert client.get(f"/api/hub/lobby/{out['room_code']}", headers=headers).status_code == 200
    assert client.get(f"/api/hub/league/{out['league_id']}", headers=headers).status_code == 401
    assert client.post(f"/api/hub/lobby/{out['room_code']}/join", json={"display_name": "Legacy guest"}, headers=headers).status_code == 403
    assert client.post(f"/api/hub/league/{out['league_id']}/bid", json={"amount": 10}, headers=headers).status_code == 401
    assert client.post(f"/api/hub/league/{out['league_id']}/pick", json={"player_id": "fixture-player", "player_name": "Fixture Player", "position": "WR", "team": "KC"}, headers=headers).status_code == 401
    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(f"/api/hub/ws/{out['league_id']}?token={token}"):
            raise AssertionError("Guest socket unexpectedly connected")
    assert denied.value.code == 1008
    bid.assert_not_called()
    pick.assert_not_called()
    timers.assert_not_called()


def test_guest_query_with_account_cookie_retains_websocket_origin_protection(hub_db, auth_db, monkeypatch):
    from app.api import app
    from app.auth import native_user_sub, ws_handshake_uses_cookie_auth, ws_user_from_handshake
    from starlette.websockets import WebSocketDisconnect

    monkeypatch.setattr("src.config.HUB_AUTH_REQUIRED", True)
    user = user_store.create_user("cookie-origin@fixture.test", "pbkdf2_sha256$120000$00$00", "Manager")
    user_store.mark_email_verified(user["id"])
    account_token = create_access_token(user, auth_type="native")
    sub = native_user_sub(user["id"])
    out = start_mock_draft(sub, mode="quick_bots", team_count=4, lobby=True)
    guest_token, _ = create_guest_access_token(league_id=out["league_id"], team_id="legacy", name="Legacy", guest_id="origin-test")
    assert ws_user_from_handshake(guest_token, account_token)["sub"] == sub
    assert ws_handshake_uses_cookie_auth(guest_token, account_token) is True
    state = Mock(side_effect=AssertionError("Untrusted cookie-authenticated origin must not enter the room"))
    monkeypatch.setattr("app.hub_routes.get_room_state", state)
    client = TestClient(app)
    client.cookies.set("scoresense_token", account_token)
    with pytest.raises(WebSocketDisconnect) as denied:
        with client.websocket_connect(f"/api/hub/ws/{out['league_id']}?token={guest_token}", headers={"origin": "https://evil.example"}):
            raise AssertionError("Untrusted cookie-authenticated socket unexpectedly connected")
    assert denied.value.code == 1008
    state.assert_not_called()


@pytest.mark.parametrize("auth_required", [True, False])
def test_temporary_password_account_cannot_create_a_lobby_seat(hub_db, auth_db, monkeypatch, auth_required):
    from app.api import app

    monkeypatch.setattr("src.config.AUTH_REQUIRED", auth_required)
    monkeypatch.setattr("src.config.HUB_AUTH_REQUIRED", auth_required)
    out = start_mock_draft("fixture-host", mode="quick_bots", team_count=4, lobby=True)
    before = storage.list_league_teams(out["league_id"])
    user = user_store.create_user("temporary-join@fixture.test", "pbkdf2_sha256$120000$00$00", "Temporary")
    user_store.mark_email_verified(user["id"])
    user_store.update_password(user["id"], "pbkdf2_sha256$120000$00$00", must_change=True)
    user = user_store.get_user_by_id(user["id"])
    token = create_access_token(user, auth_type="native")
    denied = TestClient(app).post(f"/api/hub/lobby/{out['room_code']}/join", json={"display_name": "Temporary"}, headers={"Authorization": f"Bearer {token}"})
    assert denied.status_code == 403
    assert denied.json()["detail"] == "Choose a new password before joining a draft. Update it in account settings."
    assert storage.list_league_teams(out["league_id"]) == before
