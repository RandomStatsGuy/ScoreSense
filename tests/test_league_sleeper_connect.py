"""League-wide Sleeper connect."""

import pytest

from src.draft_hub import storage
from src.draft_hub.league_sleeper_sync import connect_sleeper_league, merge_sleeper_team_roster
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_connect_sleeper_league_imports_all_teams(hub_db, monkeypatch):
    comm = "sl-connect-comm"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "SL Connect", 2025, rules, workspace_id=ws["id"])

    def fake_list(_sl_id):
        return {
            "league_name": "Sleeper Test",
            "season": 2025,
            "teams": [
                {"roster_id": "1", "team_name": "Alpha", "owner_name": "A", "player_count": 2},
                {"roster_id": "2", "team_name": "Beta", "owner_name": "B", "player_count": 1},
            ],
        }

    snapshots = {
        "1": {
            "team_name": "Alpha",
            "players": [
                {"player_id": "p1", "player_name": "One", "team": "KC", "position": "WR", "sleeper_player_id": "s1"},
                {"player_id": "p2", "player_name": "Two", "team": "KC", "position": "RB", "sleeper_player_id": "s2"},
            ],
            "player_ids": ["p1", "p2"],
            "sleeper_roster_size": 2,
            "unmatched": [],
        },
        "2": {
            "team_name": "Beta",
            "players": [
                {"player_id": "p3", "player_name": "Three", "team": "SF", "position": "QB", "sleeper_player_id": "s3"},
            ],
            "player_ids": ["p3"],
            "sleeper_roster_size": 1,
            "unmatched": [],
        },
    }

    monkeypatch.setattr(
        "src.draft_hub.league_sleeper_sync.list_league_teams",
        fake_list,
    )

    def fake_fetch_all(_sl):
        return {str(rid): snapshots[str(rid)] for rid in snapshots}

    monkeypatch.setattr(
        "src.draft_hub.league_sleeper_sync.fetch_all_linked_rosters",
        fake_fetch_all,
    )

    comm_team = storage.get_team_by_user(league["id"], comm)
    result = connect_sleeper_league(
        league["id"],
        "999",
        commissioner_sleeper_roster_id="1",
    )

    assert result["teams_connected"] == 2
    assert result["merge"]["added"] == 3
    overview = storage.league_roster_overview(league["id"])
    assert len(overview["teams"]) == 2
    names = {b["team"]["name"] for b in overview["teams"]}
    assert "Alpha" in names or any(b["player_count"] > 0 for b in overview["teams"])
    comm_block = next(b for b in overview["teams"] if b["team"]["id"] == comm_team["id"])
    assert comm_block["player_count"] == 2


def test_merge_reassigns_solo_orphan_slots(hub_db):
    comm = "orphan-comm"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Orphan League", 2025, rules, workspace_id=ws["id"])
    comm_team = storage.get_team_by_user(league["id"], comm)

    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "p-orphan",
            "player_name": "Orphan Player",
            "team": "KC",
            "position": "WR",
            "salary": 10,
            "contract_years": 1,
            "sleeper_player_id": "sl-1",
            "source": "sleeper",
        },
        team_id=None,
    )
    assert storage.list_roster(ws["id"], comm_team["id"]) == []

    stats = merge_sleeper_team_roster(
        ws["id"],
        comm_team["id"],
        [
            {
                "player_id": "p-orphan",
                "player_name": "Orphan Player",
                "team": "KC",
                "position": "WR",
                "sleeper_player_id": "sl-1",
            }
        ],
    )
    assert stats["updated"] == 1
    roster = storage.list_roster(ws["id"], comm_team["id"])
    assert len(roster) == 1
    assert roster[0]["player_id"] == "p-orphan"
