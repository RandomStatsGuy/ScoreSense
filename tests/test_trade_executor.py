"""Cross-team trade execution tests."""

import pytest

from src.draft_hub import storage
from src.draft_hub.presets import load_preset
from src.draft_hub.trade_executor import execute_league_trade


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _league_with_players(hub_db):
    comm = "exec-comm"
    member = "exec-member"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Exec League", 2025, rules, workspace_id=ws["id"])
    team_a = storage.get_team_by_user(league["id"], comm)
    team_b = storage.join_league(member, league["room_code"], "Team B")
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "p-a", "player_name": "Player A", "team": "SEA", "position": "WR", "salary": 40, "contract_years": 2},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "p-b", "player_name": "Player B", "team": "SF", "position": "RB", "salary": 35, "contract_years": 1},
        team_id=team_b["id"],
    )
    return league, team_a, team_b, ws


def test_trade_moves_players(hub_db):
    league, team_a, team_b, ws = _league_with_players(hub_db)
    result = execute_league_trade(
        league["id"],
        team_a_id=team_a["id"],
        team_b_id=team_b["id"],
        send_a=["p-a"],
        send_b=["p-b"],
    )
    slot_a = storage.get_roster_slot(ws["id"], "p-a")
    slot_b = storage.get_roster_slot(ws["id"], "p-b")
    assert slot_a["team_id"] == team_b["id"]
    assert slot_b["team_id"] == team_a["id"]
    assert float(slot_a["salary"]) == 40
    assert result["team_a"]["roster"]
    assert result["team_b"]["roster"]


def test_invalid_trade_rejected(hub_db):
    league, team_a, team_b, _ws = _league_with_players(hub_db)
    with pytest.raises(ValueError, match="not on team"):
        execute_league_trade(
            league["id"],
            team_a_id=team_a["id"],
            team_b_id=team_b["id"],
            send_a=["p-b"],
            send_b=[],
        )
