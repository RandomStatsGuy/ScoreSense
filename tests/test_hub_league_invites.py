"""League email invites and commissioner permissions."""

import pytest

from src.draft_hub import storage
from src.draft_hub.hub_context import list_roster_for_context, resolve_hub_context
from src.draft_hub.league_invites import build_invite_url, create_invite
from src.draft_hub.league_permissions import require_commissioner
from src.draft_hub.presets import load_preset
from fastapi import HTTPException


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_create_and_accept_invite(hub_db):
    comm = "comm-invite"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Invite League", 2025, rules, workspace_id=ws["id"])

    invite = create_invite(league["id"], "owner@example.com", "Team Alpha", comm)
    assert invite["email"] == "owner@example.com"
    assert invite["team_name"] == "Team Alpha"
    assert invite["token"]
    assert build_invite_url(invite["token"]).endswith(invite["token"])

    with pytest.raises(ValueError, match="email"):
        storage.accept_league_invite(invite["token"], "ss:member-1", "wrong@example.com")

    result = storage.accept_league_invite(invite["token"], "ss:member-1", "owner@example.com")
    assert result["team"]["name"] == "Team Alpha"
    assert result["team"]["user_sub"] == "ss:member-1"

    ctx = resolve_hub_context("ss:member-1")
    assert ctx["mode"] == "league"
    assert ctx["team_name"] == "Team Alpha"
    assert ctx["can_edit_salaries"] is False


def test_commissioner_context_permissions(hub_db):
    comm = "comm-perms"
    member = "member-perms"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Perm League", 2025, rules, workspace_id=ws["id"])
    storage.join_league(member, league["room_code"], "Member")

    comm_ctx = resolve_hub_context(comm)
    member_ctx = resolve_hub_context(member)
    assert comm_ctx["can_edit_salaries"] is True
    assert comm_ctx["can_invite_members"] is True
    assert member_ctx["can_edit_salaries"] is False
    assert member_ctx["can_invite_members"] is False

    with pytest.raises(HTTPException) as exc:
        require_commissioner(member_ctx)
    assert exc.value.status_code == 403


def test_roster_tab_scoped_to_own_team(hub_db):
    comm = "comm-rosters"
    member = "member-rosters"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Roster League", 2025, rules, workspace_id=ws["id"])
    team_b = storage.join_league(member, league["room_code"], "Team B")
    team_a = storage.get_team_by_user(league["id"], comm)

    storage.add_roster_slot(
        ws["id"],
        {"player_id": "00-0035640", "player_name": "A", "team": "SEA", "position": "WR", "salary": 10, "contract_years": 1},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "00-0035641", "player_name": "B", "team": "SEA", "position": "WR", "salary": 20, "contract_years": 1},
        team_id=team_b["id"],
    )

    comm_ctx = resolve_hub_context(comm)
    member_ctx = resolve_hub_context(member)
    assert len(list_roster_for_context(comm_ctx)) == 1
    assert len(list_roster_for_context(member_ctx)) == 1
    assert len(storage.list_league_roster(ws["id"])) == 2


def test_import_commissioner_league_sheet(hub_db):
    comm = "comm-import"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Import League", 2025, rules, workspace_id=ws["id"])

    rows = [
        {
            "player_id": "00-0035640",
            "player_name": "Player A",
            "team": "SEA",
            "position": "WR",
            "salary": 45,
            "contract_years": 2,
            "source": "sheet",
            "manager_team": "Alpha",
        },
        {
            "player_id": "00-0035641",
            "player_name": "Player B",
            "team": "SEA",
            "position": "WR",
            "salary": 30,
            "contract_years": 1,
            "source": "sheet",
            "manager_team": "Beta",
        },
    ]
    result = storage.import_commissioner_league_sheet(league["id"], ws["id"], rows, rules)
    assert result["imported"] == 2
    assert set(result["teams"]) == {"Alpha", "Beta"}

    teams = storage.list_league_teams(league["id"])
    names = {t["name"] for t in teams}
    assert "Alpha" in names
    assert "Beta" in names

    all_roster = storage.list_league_roster(ws["id"])
    assert len(all_roster) == 2
