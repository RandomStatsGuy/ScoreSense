"""Commissioner Sleeper link imports full league."""

import pytest

from src.draft_hub import storage
from src.draft_hub.presets import load_preset
from src.draft_hub.sleeper_link import link_sleeper_team


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_commissioner_link_imports_all_sleeper_teams(hub_db, monkeypatch):
    comm = "comm-full-import"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Full Import", 2025, rules, workspace_id=ws["id"])

    def fake_list(_sl_id):
        return {
            "league_name": "Sleeper Test",
            "season": 2025,
            "teams": [
                {"roster_id": "1", "team_name": "Alpha", "owner_name": "A", "player_count": 1},
                {"roster_id": "2", "team_name": "Beta", "owner_name": "B", "player_count": 1},
            ],
        }

    def fake_fetch_one(_sl, rid):
        players = {
            "1": [{"player_id": "p1", "player_name": "One", "team": "KC", "position": "WR", "sleeper_player_id": "s1"}],
            "2": [{"player_id": "p2", "player_name": "Two", "team": "SF", "position": "RB", "sleeper_player_id": "s2"}],
        }[str(rid)]
        return {
            "team_name": "Alpha" if str(rid) == "1" else "Beta",
            "players": players,
            "player_ids": [p["player_id"] for p in players],
            "sleeper_roster_size": len(players),
            "unmatched": [],
        }

    snapshots = {"1": fake_fetch_one("x", "1"), "2": fake_fetch_one("x", "2")}

    monkeypatch.setattr("src.draft_hub.sleeper_link.list_league_teams", fake_list)
    monkeypatch.setattr("src.draft_hub.sleeper_link.fetch_linked_roster", fake_fetch_one)
    monkeypatch.setattr("src.draft_hub.league_sleeper_sync.list_league_teams", fake_list)
    monkeypatch.setattr("src.draft_hub.league_sleeper_sync.fetch_all_linked_rosters", lambda _sl: snapshots)
    monkeypatch.setattr("src.draft_hub.league_sleeper_sync.fetch_linked_roster", fake_fetch_one)

    result = link_sleeper_team(
        comm,
        sleeper_league_id="999",
        sleeper_roster_id="1",
        sleeper_team_name="Alpha",
        import_to_hub=True,
    )

    assert result["full_league_import"] is True
    assert result["teams_synced"] == 2
    overview = storage.league_roster_overview(league["id"])
    assert len(overview["teams"]) == 2
    assert sum(b["player_count"] for b in overview["teams"]) == 2
