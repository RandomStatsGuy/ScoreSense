"""Gate A leftovers: isolation migration, money gates, reserved seats, sessions."""

import pytest
from pydantic import ValidationError

from fastapi import HTTPException

from app.auth import (
    _verify_native_session,
    create_access_token,
    decode_access_token,
    native_session_current,
)
from src.auth import user_store
from src.draft_hub import storage
from src.draft_hub.league_invites import create_invite
from src.draft_hub.presets import load_preset
from src.draft_hub.rules_engine import blocking_acquisition_errors
from src.draft_hub.schemas import LeagueRules, RosterAddRequest, RosterUpdateRequest


def _add(ws_id, team_id, player_id="00-0033873", name="Patrick Mahomes", salary=40):
    return storage.add_roster_slot(
        ws_id,
        {
            "player_id": player_id,
            "player_name": name,
            "team": "KC",
            "position": "QB",
            "salary": salary,
            "contract_years": 1,
        },
        team_id=team_id,
    )


def test_null_workspace_moves_assigned_rows_from_personal(hub_db):
    rules = LeagueRules()
    comm = "comm-null-ws"
    personal = storage.get_or_create_workspace(comm)
    league = storage.create_league(comm, "Legacy Null", 2026, rules, team_count=8)
    team = storage.list_league_teams(league["id"])[0]
    _add(personal["id"], team["id"])
    storage.add_roster_slot(
        personal["id"],
        {
            "player_id": "solo-prep",
            "player_name": "Solo Prep",
            "team": "NE",
            "position": "RB",
            "salary": 5,
            "contract_years": 1,
        },
        team_id=None,
    )
    with storage.get_conn() as conn:
        conn.execute("UPDATE league SET workspace_id = NULL WHERE id = ?", (league["id"],))

    moved = storage.ensure_dedicated_league_workspaces()
    assert moved >= 1
    league = storage.get_league(league["id"])
    dedicated = storage.roster_workspace_for_league(league)
    assert dedicated == league["id"]
    assert dedicated != personal["id"]
    assert storage.get_roster_slot(dedicated, "00-0033873")["team_id"] == team["id"]
    assert storage.get_roster_slot(personal["id"], "00-0033873") is None
    assert storage.get_roster_slot(personal["id"], "solo-prep") is not None
    assert storage.get_roster_slot(dedicated, "solo-prep") is None


def test_shared_workspace_leaves_unassigned_orphans(hub_db):
    rules = LeagueRules()
    ws = storage.get_or_create_workspace("comm-orphan")
    league_a = storage.create_league(
        "comm-orphan", "Orphan A", 2026, rules, workspace_id=ws["id"], team_count=8
    )
    league_b = storage.create_league(
        "comm-orphan", "Orphan B", 2026, rules, workspace_id=ws["id"], team_count=8
    )
    team_a = storage.list_league_teams(league_a["id"])[0]
    team_b = storage.list_league_teams(league_b["id"])[0]
    _add(ws["id"], team_a["id"])
    _add(ws["id"], team_b["id"], player_id="00-0035228", name="Josh Allen")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "orphan-fa",
            "player_name": "Orphan FA",
            "team": "FA",
            "position": "WR",
            "salary": 8,
            "contract_years": 1,
        },
        team_id=None,
    )

    storage.ensure_dedicated_league_workspaces()
    league_a = storage.get_league(league_a["id"])
    league_b = storage.get_league(league_b["id"])
    ws_a = storage.roster_workspace_for_league(league_a)
    ws_b = storage.roster_workspace_for_league(league_b)
    assert storage.get_roster_slot(ws["id"], "orphan-fa") is not None
    assert storage.get_roster_slot(ws_a, "orphan-fa") is None
    assert storage.get_roster_slot(ws_b, "orphan-fa") is None


def test_room_code_join_rejects_reserved_seat(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("comm-reserve", "Reserve", 2026, rules, team_count=8)
    storage.add_unclaimed_team(league["id"], "The Night Owls", rules.salary_cap)
    create_invite(league["id"], "owl@example.com", "The Night Owls", "comm-reserve")
    night = next(t for t in storage.list_league_teams(league["id"]) if t["name"] == "The Night Owls")
    with pytest.raises(ValueError, match="reserved"):
        storage.join_league("ss:thief", league["room_code"], "The Night Owls")
    assert not storage.get_team(night["id"]).get("user_sub")


def test_roster_add_schema_rejects_negative_salary():
    with pytest.raises(ValidationError):
        RosterAddRequest(
            player_id="x",
            player_name="X",
            position="QB",
            salary=-100,
        )
    with pytest.raises(ValidationError):
        RosterUpdateRequest(player_id="x", salary=-5)


def test_league_rules_reject_negative_cap():
    with pytest.raises(ValidationError):
        LeagueRules(salary_cap=-1)


def test_blocking_acquisition_errors_catch_over_cap_not_mins():
    rules = LeagueRules(salary_cap=200)
    over = blocking_acquisition_errors(
        rules,
        [{"player_id": "a", "position": "QB", "salary": 1000, "contract_years": 1}],
    )
    assert any("Over cap" in e for e in over)
    incomplete = blocking_acquisition_errors(
        rules,
        [{"player_id": "b", "position": "QB", "salary": 40, "contract_years": 1}],
    )
    assert incomplete == []


def test_password_reset_revokes_old_jwt(auth_db):
    user = user_store.create_user("reset2@example.com", "hash", "R")
    old = create_access_token(user, auth_type="native")
    user_store.update_password(user["id"], "new-hash")
    stale = decode_access_token(old)
    assert native_session_current(stale) is False
    with pytest.raises(HTTPException) as exc:
        _verify_native_session(stale)
    assert exc.value.status_code == 401
    _verify_native_session({"auth_type": "patreon", "sub": "p1"})
    fresh_row = user_store.get_user_by_id(user["id"])
    fresh = create_access_token(fresh_row, auth_type="native")
    assert native_session_current(decode_access_token(fresh)) is True
