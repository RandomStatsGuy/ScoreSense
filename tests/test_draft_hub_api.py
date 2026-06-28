"""Draft Hub workspace/roster smoke tests (storage layer)."""

import pytest

from src.draft_hub import storage
from src.draft_hub.rules_engine import cap_summary, validate_roster
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_workspace_create_and_roster(hub_db):
    sub = "test-user-1"
    ws = storage.get_or_create_workspace(sub, season=2025)
    assert ws["rules"]["salary_cap"] == 200

    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "p1",
            "player_name": "Test Player",
            "team": "TST",
            "position": "QB",
            "salary": 30,
            "contract_years": 2,
        },
    )
    roster = storage.list_roster(ws["id"])
    assert len(roster) == 1
    rules = LeagueRules.model_validate(ws["rules"])
    summary = cap_summary(rules, roster)
    assert summary["spent"] == 30
    errors = validate_roster(rules, roster)
    assert isinstance(errors, list)


def test_sleeper_link_persisted(hub_db):
    sub = "test-sleeper-user"
    ws = storage.get_or_create_workspace(sub)
    updated = storage.update_sleeper_link(
        sub,
        sleeper_league_id="1234567890",
        sleeper_roster_id="3",
        sleeper_team_name="Test Team",
        sleeper_player_ids=["00-001", "00-002"],
    )
    assert updated["sleeper_league_id"] == "1234567890"
    assert updated["sleeper_roster_id"] == "3"
    assert updated["sleeper_team_name"] == "Test Team"
    assert updated["sleeper_player_ids"] == ["00-001", "00-002"]
    assert storage.sleeper_link_from_workspace(updated)["sleeper_league_id"] == "1234567890"


def test_prune_solo_roster_junk(hub_db):
    sub = "test-prune-user"
    ws = storage.get_or_create_workspace(sub)
    # Legacy bad import: numeric Sleeper id as player_id
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "11560",
            "player_name": "Bad Import",
            "team": "CHI",
            "position": "QB",
            "salary": 1,
            "contract_years": 1,
            "source": "manual",
        },
    )
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0035640",
            "player_name": "Valid WR",
            "team": "SEA",
            "position": "WR",
            "salary": 25,
            "contract_years": 1,
            "source": "manual",
        },
    )
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0034161",
            "player_name": "Kicker",
            "team": "LV",
            "position": "K",
            "salary": 1,
            "contract_years": 1,
            "source": "sleeper",
        },
    )
    removed = storage.prune_solo_roster_junk(ws["id"])
    assert removed == 2
    roster = storage.list_roster(ws["id"])
    assert len(roster) == 1
    assert roster[0]["player_id"] == "00-0035640"


def test_remove_solo_placeholder_imports(hub_db):
    sub = "test-placeholder-user"
    ws = storage.get_or_create_workspace(sub)
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0000001",
            "player_name": "League Junk",
            "team": "NYJ",
            "position": "QB",
            "salary": 1,
            "contract_years": 1,
            "source": "manual",
        },
    )
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0000002",
            "player_name": "Real Contract",
            "team": "KC",
            "position": "QB",
            "salary": 35,
            "contract_years": 2,
            "source": "manual",
        },
    )
    removed = storage.remove_solo_placeholder_imports(
        ws["id"],
        preserve_player_ids={"00-0000999"},
    )
    assert removed == 1
    roster = storage.list_roster(ws["id"])
    assert len(roster) == 1
    assert roster[0]["salary"] == 35


def test_update_roster_slot(hub_db):
    sub = "update-roster-user"
    ws = storage.get_or_create_workspace(sub)
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "p1",
            "player_name": "Test Player",
            "team": "KC",
            "position": "QB",
            "salary": 10,
            "contract_years": 1,
        },
    )
    updated = storage.update_roster_slot(ws["id"], "p1", salary=25, contract_years=2)
    assert updated["salary"] == 25
    assert updated["contract_years"] == 2


def test_league_create(hub_db):
    from src.draft_hub.presets import load_preset

    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("commish", "Test League", 2025, rules, team_count=8)
    assert league["room_code"]
    assert len(league["room_code"]) == 6
    teams = storage.list_league_teams(league["id"])
    assert len(teams) == 1
    assert teams[0]["is_commissioner"] == 1
