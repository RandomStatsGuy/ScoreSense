"""Office: co-commissioners and league/office chat ACL."""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.hub_context import resolve_hub_context
from src.draft_hub.league_invites import create_invite
from src.draft_hub.league_permissions import require_commissioner, require_primary_commissioner
from src.draft_hub.presets import load_preset


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {
        "sub": sub,
        "auth_type": "dev",
        "email": f"{sub}@example.com",
    }
    return TestClient(app)


def test_co_commissioner_invite_and_permissions(hub_db):
    comm = "office-comm"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Office League", 2026, rules, workspace_id=ws["id"])

    invite = create_invite(
        league["id"],
        "coco@example.com",
        "Co Team",
        comm,
        co_commissioner=True,
    )
    assert invite["co_commissioner"] is True

    result = storage.accept_league_invite(invite["token"], "ss:coco", "coco@example.com")
    assert result["team"]["is_commissioner"] is True

    coco_ctx = resolve_hub_context("ss:coco")
    assert coco_ctx["is_commissioner"] is True
    assert coco_ctx["is_primary_commissioner"] is False
    assert coco_ctx["can_invite_members"] is True
    assert coco_ctx["can_edit_salaries"] is True
    require_commissioner(coco_ctx)
    with pytest.raises(HTTPException) as exc:
        require_primary_commissioner(coco_ctx)
    assert exc.value.status_code == 403

    primary_ctx = resolve_hub_context(comm)
    assert primary_ctx["is_primary_commissioner"] is True

    team = result["team"]
    demoted = storage.set_team_co_commissioner(
        league["id"], team["id"], enabled=False, actor_sub=comm,
    )
    assert demoted["is_commissioner"] is False
    coco_ctx2 = resolve_hub_context("ss:coco")
    assert coco_ctx2["is_commissioner"] is False


def test_chat_league_vs_office_acl(hub_db):
    comm = "chat-comm"
    member = "chat-member"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Chat League", 2026, rules, workspace_id=ws["id"])
    storage.join_league(member, league["room_code"], "Member Team")

    msg = storage.post_chat_message(
        league["id"],
        "league",
        author_sub=comm,
        team_id=storage.get_team_by_user(league["id"], comm)["id"],
        body="Hello league",
    )
    assert msg["body"] == "Hello league"
    listed = storage.list_chat_messages(league["id"], "league")
    assert any(m["id"] == msg["id"] for m in listed)

    client = _client_for(member)
    try:
        ok = client.get(f"/api/hub/league/{league['id']}/chat/league/messages")
        assert ok.status_code == 200
        denied = client.get(f"/api/hub/league/{league['id']}/chat/office/messages")
        assert denied.status_code == 403

        post_denied = client.post(
            f"/api/hub/league/{league['id']}/chat/office/messages",
            json={"body": "sneaky"},
        )
        assert post_denied.status_code == 403
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

    client_comm = _client_for(comm)
    try:
        res = client_comm.post(
            f"/api/hub/league/{league['id']}/chat/office/messages",
            json={"body": "Staff only"},
        )
        assert res.status_code == 200
        assert res.json()["message"]["body"] == "Staff only"
        listed_office = client_comm.get(
            f"/api/hub/league/{league['id']}/chat/office/messages"
        )
        assert listed_office.status_code == 200
        assert any(m["body"] == "Staff only" for m in listed_office.json()["messages"])
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_primary_commissioner_can_clear_chat(hub_db):
    comm = "clear-comm"
    member = "clear-member"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Clear Chat League", 2026, rules, workspace_id=ws["id"])
    storage.join_league(member, league["room_code"], "Member Team")
    storage.post_chat_message(
        league["id"],
        "league",
        author_sub=member,
        team_id=storage.get_team_by_user(league["id"], member)["id"],
        body="noise",
    )
    assert len(storage.list_chat_messages(league["id"], "league")) >= 1

    member_client = _client_for(member)
    try:
        denied = member_client.delete(f"/api/hub/league/{league['id']}/chat/league/messages")
        assert denied.status_code == 403
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

    comm_client = _client_for(comm)
    try:
        cleared = comm_client.delete(f"/api/hub/league/{league['id']}/chat/league/messages")
        assert cleared.status_code == 200
        assert cleared.json()["deleted"] >= 1
        assert storage.list_chat_messages(league["id"], "league") == []
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
