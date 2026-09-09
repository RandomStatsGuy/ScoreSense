"""Room disclosure, staff-chat fan-out, trade rollback, and stale Award."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.draft_state import award_nominee, end_draft, start_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.ws_manager import DraftRoomManager


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {
        "sub": sub,
        "auth_type": "dev",
        "email": f"{sub}@example.com",
    }
    return TestClient(app)


def _league(comm: str, name: str):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace(comm)
    return storage.create_league(comm, name, 2026, rules, workspace_id=ws["id"])


def test_stranger_cannot_read_room_or_nomination_pool(hub_db):
    league = _league("room-comm", "Room League")
    storage.join_league("room-member", league["room_code"], "Member Team")

    member = _client_for("room-member")
    try:
        ok = member.get(f"/api/hub/league/{league['id']}")
        assert ok.status_code == 200
        assert ok.json()["league"]["id"] == league["id"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

    stranger = _client_for("room-stranger")
    try:
        room = stranger.get(f"/api/hub/league/{league['id']}")
        assert room.status_code == 403
        pool = stranger.get(f"/api/hub/league/{league['id']}/nomination-pool")
        assert pool.status_code == 403
        missing = stranger.get("/api/hub/league/not-a-league")
        assert missing.status_code == 404
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_office_ws_broadcast_skips_non_staff(hub_db):
    class FakeWS:
        def __init__(self):
            self.texts: list[str] = []

        async def accept(self):
            return None

        async def send_text(self, text):
            self.texts.append(text)

    class DeadWS(FakeWS):
        async def send_text(self, text):
            raise RuntimeError("socket closed")

    async def run():
        mgr = DraftRoomManager()
        staff = FakeWS()
        member = FakeWS()
        dead = DeadWS()
        await mgr.connect("lg-office", staff, staff=True)
        await mgr.connect("lg-office", member, staff=False)
        await mgr.connect("lg-office", dead, staff=False)
        await mgr.broadcast(
            "lg-office",
            {"type": "chat", "kind": "office", "message": {"body": "Staff only"}},
            staff_only=True,
        )
        await mgr.broadcast(
            "lg-office",
            {"type": "chat", "kind": "league", "message": {"body": "Hello league"}},
            staff_only=False,
        )
        staff_kinds = [json.loads(t)["kind"] for t in staff.texts]
        member_kinds = [json.loads(t)["kind"] for t in member.texts]
        assert "office" in staff_kinds
        assert "league" in staff_kinds
        assert "office" not in member_kinds
        assert "league" in member_kinds
        assert dead not in mgr._rooms.get("lg-office", {})

    asyncio.run(run())


def test_apply_trade_plan_rolls_back_when_a_player_is_missing(hub_db):
    comm = "trade-atom-comm"
    member = "trade-atom-member"
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace(comm)
    league = storage.create_league(comm, "Atomic Trade", 2026, rules, workspace_id=ws["id"])
    team_a = storage.get_team_by_user(league["id"], comm)
    team_b = storage.join_league(member, league["room_code"], "Team B")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "keep-me",
            "player_name": "Keep Me",
            "team": "SEA",
            "position": "WR",
            "salary": 20,
            "contract_years": 2,
        },
        team_id=team_a["id"],
    )
    with pytest.raises(ValueError, match="Failed to move ghost"):
        storage.apply_trade_plan(
            ws["id"],
            [
                {"player_id": "keep-me", "team_id": team_b["id"]},
                {"player_id": "ghost", "team_id": team_b["id"]},
            ],
        )
    assert storage.get_roster_slot(ws["id"], "keep-me")["team_id"] == team_a["id"]


def test_apply_trade_plan_does_not_steal_from_another_team(hub_db):
    comm = "trade-from-comm"
    member = "trade-from-member"
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace(comm)
    league = storage.create_league(comm, "From Team Trade", 2026, rules, workspace_id=ws["id"])
    team_a = storage.get_team_by_user(league["id"], comm)
    team_b = storage.join_league(member, league["room_code"], "Team B")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "stay-put",
            "player_name": "Stay Put",
            "team": "SEA",
            "position": "WR",
            "salary": 18,
            "contract_years": 2,
        },
        team_id=team_a["id"],
    )
    with pytest.raises(ValueError, match="Failed to move stay-put"):
        storage.apply_trade_plan(
            ws["id"],
            [
                {
                    "player_id": "stay-put",
                    "from_team_id": team_b["id"],
                    "team_id": team_b["id"],
                }
            ],
        )
    assert storage.get_roster_slot(ws["id"], "stay-put")["team_id"] == team_a["id"]


def test_stale_award_after_end_draft_does_not_revive(hub_db):
    comm = "stale-award-comm"
    league = _league(comm, "Stale Award")
    start_draft(league["id"], comm, allow_empty=True)
    ended = end_draft(league["id"], comm, force=True)
    assert ended["session"]["status"] == "completed"
    assert ended["league"]["draft_completed"] is True

    state = award_nominee(league["id"], comm)
    session = storage.get_draft_session(league["id"])
    league = storage.get_league(league["id"])
    assert session["status"] == "completed"
    assert league["draft_completed"] is True
    assert state["session"]["status"] == "completed"
    assert state["session"].get("current_nominee_json") in (None, "", {})
