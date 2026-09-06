"""League context and Sleeper trade contract moves."""

import pytest

from src.draft_hub import storage
from src.draft_hub.hub_context import resolve_hub_context, roster_scope
from src.draft_hub.league_sleeper_sync import detect_and_apply_sleeper_trades, merge_sleeper_team_roster
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_league_membership_uses_shared_workspace(hub_db):
    comm = "comm-sub"
    member = "member-sub"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Test League", 2025, rules, team_count=12, workspace_id=ws["id"])
    storage.join_league(member, league["room_code"], "Member Team")

    ctx = resolve_hub_context(member)
    assert ctx["mode"] == "league"
    assert ctx["workspace_id"] == ws["id"]
    assert ctx["team_name"] == "Member Team"
    assert ctx["team_count"] == 12
    assert ctx["rules"]["salary_cap"] == rules.salary_cap

    ws_id, team_id = roster_scope(ctx)
    assert ws_id == ws["id"]
    assert team_id is not None


def test_league_without_workspace_id_uses_dedicated_roster_pool(hub_db):
    """Members see rows in the league pool, not the commissioner's solo workspace."""
    from src.draft_hub.hub_context import list_roster_for_context

    comm = "cap-comm"
    member = "cap-member"
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Cap Sheet League", 2025, rules, team_count=10)
    member_team = storage.join_league(member, league["room_code"], "White Supremacists")
    comm_ws = storage.get_or_create_workspace(comm)
    league_ws = storage.roster_workspace_for_league(league)
    assert league_ws != comm_ws["id"]
    storage.add_roster_slot(
        league_ws,
        {
            "player_id": "00-0035640",
            "player_name": "Test Player",
            "team": "SEA",
            "position": "WR",
            "salary": 10,
            "contract_years": 1,
            "source": "sheet",
        },
        team_id=member_team["id"],
    )

    member_ctx = resolve_hub_context(member)
    assert member_ctx["workspace_id"] == league_ws
    assert member_ctx["workspace_id"] != comm_ws["id"]
    assert member_ctx["team_count"] == 10
    roster = list_roster_for_context(member_ctx)
    assert len(roster) == 1
    assert roster[0]["player_name"] == "Test Player"


def test_commissioner_rules_update_league(hub_db):
    comm = "comm-rules"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Rules League", 2025, rules, workspace_id=ws["id"])
    new_rules = rules.model_copy(update={"salary_cap": 250})
    storage.update_league_rules(league["id"], new_rules)

    member = "member-rules"
    storage.join_league(member, league["room_code"], "T2")
    ctx = resolve_hub_context(member)
    assert ctx["rules"]["salary_cap"] == 250


def test_sleeper_trade_moves_contract(hub_db):
    comm = "trade-comm"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Trade League", 2025, rules, workspace_id=ws["id"])
    team_a = storage.get_team_by_user(league["id"], comm)
    member = "trade-member"
    team_b = storage.join_league(member, league["room_code"], "Team B")

    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0035640",
            "player_name": "Player A",
            "team": "SEA",
            "position": "WR",
            "salary": 45,
            "contract_years": 2,
            "source": "sheet",
        },
        team_id=team_a["id"],
    )

    team_snapshots = {
        str(team_a["id"]): [],
        str(team_b["id"]): [
            {
                "player_id": "00-0035640",
                "player_name": "Player A",
                "team": "SEA",
                "position": "WR",
                "sleeper_player_id": "1234",
            }
        ],
    }
    moves = detect_and_apply_sleeper_trades(ws["id"], team_snapshots)
    assert len(moves) == 1
    assert moves[0]["to_team_id"] == team_b["id"]

    slot = storage.get_roster_slot(ws["id"], "00-0035640")
    assert slot["team_id"] == team_b["id"]
    assert float(slot["salary"]) == 45.0
    assert int(slot["contract_years"]) == 2


def test_merge_sleeper_preserves_existing_contract(hub_db):
    ws = storage.get_or_create_workspace("merge-user")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0035640",
            "player_name": "Old Name",
            "team": "SEA",
            "position": "WR",
            "salary": 55,
            "contract_years": 3,
            "source": "sheet",
        },
        team_id="team-1",
    )
    stats = merge_sleeper_team_roster(
        ws["id"],
        "team-1",
        [
            {
                "player_id": "00-0035640",
                "player_name": "New Name",
                "team": "SEA",
                "position": "WR",
                "sleeper_player_id": "999",
            }
        ],
    )
    assert stats["added"] == 0
    assert stats["updated"] == 1
    slot = storage.get_roster_slot(ws["id"], "00-0035640")
    assert slot["player_name"] == "New Name"
    assert float(slot["salary"]) == 55.0
