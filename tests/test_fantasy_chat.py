"""Private chat ACL, durable unread state, reaction idempotency, and alert isolation."""
import pytest
from fastapi.testclient import TestClient
from app.api import app
from app.auth import require_hub_user
from src.draft_hub import chat, storage
from src.draft_hub.presets import load_preset


@pytest.fixture
def room(hub_db):
    league = storage.create_league("comm", "Chat tests", 2026, load_preset("salary_cap_auction_v1"))
    for sub in ("one", "two"):
        storage.join_league(sub, league["room_code"], sub.title())
    return league, {sub: storage.get_team_by_user(league["id"], sub) for sub in ("comm", "one", "two")}


def test_private_conversations_are_only_visible_to_the_two_managers(room):
    league, people = room
    thread = "direct:" + people["two"]["id"]
    message = chat.post_message(league["id"], "one", thread, "Just between us", [])
    reverse = "direct:" + people["one"]["id"]
    assert chat.list_messages(league["id"], "two", reverse)[0]["body"] == "Just between us"
    assert not chat.list_messages(league["id"], "comm", thread)
    assert not any(t["latest"] and t["latest"]["body"] == "Just between us" for t in chat.summary(league["id"], "comm")["threads"])
    with pytest.raises(PermissionError):
        chat.set_reaction(league["id"], "comm", message["id"], "👍", True)
    with pytest.raises(PermissionError):
        chat.list_messages(league["id"], "outsider", "league")
    assert "author_sub" not in message


def test_staff_mentions_cannot_notify_regular_members(room):
    league, people = room
    with pytest.raises(PermissionError):
        chat.list_messages(league["id"], "one", "office")
    with pytest.raises(ValueError):
        chat.post_message(league["id"], "comm", "office", "@One secret", [people["one"]["id"]])
    chat.post_message(league["id"], "comm", "office", "Staff only", [])
    assert not chat.summary(league["id"], "one")["notifications"]


def test_mentions_reactions_and_monotonic_read_cursor(room):
    league, people = room
    mid = people["one"]["id"]
    message = chat.post_message(league["id"], "comm", "league", "@One your turn", [mid])
    summary = chat.summary(league["id"], "one")
    assert summary["unread"] == 1
    assert summary["notifications"][0]["kind"] == "mention"
    assert summary["notification_unread"] == 1
    for _ in range(2):
        reacted = chat.set_reaction(league["id"], "one", message["id"], "👍", True)
    assert reacted["reactions"] == [{"emoji": "👍", "count": 1, "mine": True}]
    assert chat.list_messages(league["id"], "two", "league")[0]["reactions"][0]["mine"] is False
    newer = chat.post_message(league["id"], "comm", "league", "Another message", [])
    chat.mark_read(league["id"], "one", "league", newer["id"])
    chat.mark_read(league["id"], "one", "league", message["id"])
    assert chat.summary(league["id"], "one")["unread"] == 0
    assert chat.summary(league["id"], "one")["notification_unread"] == 0
    chat.set_reaction(league["id"], "one", message["id"], "👍", False)
    assert not chat.list_messages(league["id"], "one", "league")[0]["reactions"]
    with pytest.raises(ValueError):
        chat.post_message(league["id"], "comm", "league", "No mention here", [mid])


def test_trades_and_read_alerts_do_not_leak_or_return_after_refresh(room):
    league, people = room
    proposal = storage.create_trade_proposal(league["id"], created_by_sub="one", parties=[
        {"team_id": people["one"]["id"], "send": []}, {"team_id": people["two"]["id"], "send": []}])
    assert not chat.summary(league["id"], "comm")["notifications"]
    notifications = chat.summary(league["id"], "two")["notifications"]
    assert notifications[0]["target"]["proposal_id"] == proposal["id"]
    chat.read_notifications(league["id"], "one", [notifications[0]["id"]])
    assert chat.summary(league["id"], "two")["notification_unread"] == 1
    chat.read_notifications(league["id"], "two", [notifications[0]["id"]])
    assert chat.summary(league["id"], "two")["notification_unread"] == 0
    storage.update_trade_proposal(proposal["id"], status="rejected")
    assert chat.summary(league["id"], "one")["notifications"][0]["title"] == "Trade declined"


def test_repeat_summary_polls_do_not_write(room, monkeypatch):
    from contextlib import contextmanager
    league, people = room
    storage.create_trade_proposal(league["id"], created_by_sub="one", parties=[
        {"team_id": people["one"]["id"], "send": []}, {"team_id": people["two"]["id"], "send": []}])
    chat.summary(league["id"], "two")
    statements, real_conn = [], storage.get_conn

    @contextmanager
    def traced_conn(*args, **kwargs):
        with real_conn(*args, **kwargs) as conn:
            conn.set_trace_callback(statements.append)
            yield conn
            conn.set_trace_callback(None)

    monkeypatch.setattr(storage, "get_conn", traced_conn)
    snapshot = chat.summary(league["id"], "two")
    assert snapshot["notifications"][0]["kind"] == "trade"
    assert [s for s in statements if s.lstrip().split()[0].upper() in ("INSERT", "UPDATE", "DELETE", "BEGIN")] == []


def test_preferences_persist_per_account_and_reject_unknown_settings(hub_db):
    assert chat.preferences("one")["league"] is False
    chat.preferences("one", {"direct": False})
    assert chat.preferences("one")["direct"] is False
    assert chat.preferences("two")["direct"] is True
    with pytest.raises(ValueError):
        chat.preferences("one", {"trade": "false"})
    with pytest.raises(ValueError):
        chat.preferences("one", {"unknown": True})


def test_endpoints_preserve_focus_and_reject_cross_league_reads(room):
    league, people = room
    other = storage.create_league("one", "Other league", 2026, load_preset("salary_cap_auction_v1"))
    focus = storage.get_hub_focus_league_id("one")
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "one", "auth_type": "dev"}
    try:
        with TestClient(app) as client:
            assert client.get(f"/api/hub/league/{league['id']}/chat/summary").status_code == 200
            assert storage.get_hub_focus_league_id("one") == focus
            response = client.post(f"/api/hub/league/{league['id']}/chat/thread/direct:{people['two']['id']}", json={"body": "Private hello"})
            assert response.status_code == 200
            assert client.get(f"/api/hub/league/{other['id']}/chat/thread/direct:{people['two']['id']}").status_code == 400
            assert client.put("/api/hub/notifications/preferences", json={"preferences": {"trade": "false"}}).status_code == 422
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_clear_removes_message_metadata_and_new_messages_are_unread(room):
    league, people = room
    message = chat.post_message(league["id"], "comm", "league", "@One hello", [people["one"]["id"]])
    chat.set_reaction(league["id"], "one", message["id"], "👍", True)
    chat.mark_read(league["id"], "one", "league", message["id"])
    storage.clear_chat_messages(league["id"], "league")
    assert not chat.summary(league["id"], "one")["notifications"]
    chat.post_message(league["id"], "comm", "league", "Fresh message", [])
    assert chat.summary(league["id"], "one")["unread"] == 1


def test_muted_categories_only_count_on_chat_bubble(room):
    league, people = room
    chat.post_message(league["id"], "comm", "league", "New league message", [])
    assert chat.summary(league["id"], "one")["notification_unread"] == 0
    chat.preferences("one", {"league": True})
    assert chat.summary(league["id"], "one")["notification_unread"] == 1
    chat.post_message(league["id"], "two", "direct:" + people["one"]["id"], "Private", [])
    chat.preferences("one", {"direct": False, "league": False})
    snapshot = chat.summary(league["id"], "one")
    assert snapshot["notification_unread"] == 0
    assert snapshot["unread"] == 2


def test_mark_all_read_preserves_newer_arrivals_and_other_accounts(room):
    league, people = room
    older = chat.post_message(league["id"], "comm", "league", "@One @Two earlier", [])
    newer = chat.post_message(league["id"], "comm", "league", "@One later", [])
    chat.read_notifications(league["id"], "one", [], older["created_at"])
    snapshot = chat.summary(league["id"], "one")
    assert snapshot["notification_unread"] == 1
    assert next(n for n in snapshot["notifications"] if n["target"]["message_id"] == newer["id"])["read_at"] is None
    assert chat.summary(league["id"], "two")["notification_unread"] == 1


def test_private_endpoint_does_not_broadcast_to_league(room, monkeypatch):
    from app.hub_chat_routes import draft_room_manager
    league, people = room
    broadcasts = []
    async def capture(*args, **kwargs):
        broadcasts.append((args, kwargs))
    monkeypatch.setattr(draft_room_manager, "broadcast", capture)
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "one", "auth_type": "dev"}
    try:
        with TestClient(app) as client:
            assert client.post(f"/api/hub/league/{league['id']}/chat/thread/direct:{people['two']['id']}", json={"body": "Private"}).status_code == 200
            assert broadcasts == []
            assert client.post(f"/api/hub/league/{league['id']}/chat/thread/league", json={"body": "Public"}).status_code == 200
            assert len(broadcasts) == 1
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_revoked_staff_cannot_read_saved_notification_previews(room):
    league, people = room
    storage.set_team_co_commissioner(league["id"], people["one"]["id"], enabled=True, actor_sub="comm")
    chat.post_message(league["id"], "comm", "office", "@One staff secret", [])
    assert chat.summary(league["id"], "one")["notifications"][0]["body"] == "@One staff secret"
    storage.set_team_co_commissioner(league["id"], people["one"]["id"], enabled=False, actor_sub="comm")
    snapshot = chat.summary(league["id"], "one")
    assert snapshot["notifications"] == []
    assert snapshot["notification_unread"] == 0


def test_muted_league_activity_cannot_bury_a_direct_notification(room):
    league, people = room
    chat.post_message(league["id"], "two", "direct:" + people["one"]["id"], "Private message", [])
    for i in range(81):
        chat.post_message(league["id"], "comm", "league", f"League message {i}", [])
    snapshot = chat.summary(league["id"], "one")
    assert len(snapshot["notifications"]) == 1
    assert snapshot["notifications"][0]["kind"] == "direct"


def test_replacement_owner_cannot_inherit_or_react_to_previous_owner_dms(room):
    league, people = room
    message = chat.post_message(league["id"], "one", "direct:" + people["two"]["id"], "Previous owner's private message", [])
    with storage.get_conn() as conn:
        conn.execute("UPDATE team SET user_sub=? WHERE id=?", ("replacement", people["one"]["id"]))
    assert chat.list_messages(league["id"], "replacement", "direct:" + people["two"]["id"]) == []
    assert not any(t["latest"] for t in chat.summary(league["id"], "replacement")["threads"])
    assert chat.summary(league["id"], "two")["notifications"] == []
    with pytest.raises(PermissionError):
        chat.set_reaction(league["id"], "replacement", message["id"], "👍", True)
