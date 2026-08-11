"""Reset live (non-practice) draft state."""

import pytest

from src.draft_hub import storage
from src.draft_hub.contract_typing import advance_contract_year, rewind_contract_year
from src.draft_hub.draft_recap import build_draft_recap
from src.draft_hub.draft_state import end_draft, reset_live_draft, start_draft
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _live_league():
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("live-commish")
    return storage.create_league(
        "live-commish",
        "Live League",
        2026,
        rules,
        workspace_id=ws["id"],
    )


def test_reset_live_draft_clears_picks_keeps_keepers(hub_db):
    league = _live_league()
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    ws = storage.roster_workspace_for_league(league)

    storage.add_roster_slot(
        ws,
        {
            "player_id": "keeper1",
            "player_name": "Keeper One",
            "team": "DAL",
            "position": "WR",
            "salary": 12,
            "contract_years": 2,
            "source": "sheet",
        },
        team_id=team["id"],
    )
    start_draft(league["id"], "live-commish")
    storage.add_roster_slot(
        ws,
        {
            "player_id": "pick1",
            "player_name": "Draft Pick",
            "team": "KC",
            "position": "RB",
            "salary": 25,
            "contract_years": 1,
            "source": "draft",
        },
        team_id=team["id"],
    )
    storage.append_draft_event(
        league["id"],
        "win",
        {"team_id": team["id"], "player_name": "Draft Pick", "amount": 25},
    )
    storage.update_team_budget(team["id"], 175.0)

    result = reset_live_draft(league["id"], "live-commish")
    state = result["state"]
    assert state["session"]["status"] == "setup"
    assert state["league"]["draft_completed"] is False
    assert state["league"]["status"] == "setup"
    assert state["events"] == []
    assert build_draft_recap(league["id"]) is None
    assert result["picks_removed"] == 1

    roster = storage.list_league_rosters_by_team(league["id"])[team["id"]]
    assert len(roster) == 1
    assert roster[0]["player_id"] == "keeper1"
    assert roster[0]["source"] == "sheet"
    refreshed = storage.get_team(team["id"])
    assert float(refreshed["budget_remaining"]) == float(load_preset("salary_cap_auction_v1").salary_cap)


def test_reset_after_end_rewinds_years(hub_db):
    league = _live_league()
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws,
        {
            "player_id": "k2",
            "player_name": "Keeper Two",
            "team": "SF",
            "position": "RB",
            "salary": 10,
            "contract_years": 2,
            "source": "sheet",
            "contract": {
                "years_remaining": 2,
                "current_salary": 10,
                "base_salary": 10,
                "schedule": [
                    {"year_offset": 0, "salary": 10},
                    {"year_offset": 1, "salary": 10},
                ],
                "contract_type": "rookie",
            },
        },
        team_id=team["id"],
    )
    start_draft(league["id"], "live-commish")
    end_draft(league["id"], "live-commish")

    after_end = storage.list_league_rosters_by_team(league["id"])[team["id"]][0]
    assert int((after_end.get("contract") or {}).get("years_remaining") or after_end["contract_years"]) == 1

    result = reset_live_draft(league["id"], "live-commish")
    assert result["year_rewind"]["rewound"] == 1
    restored = storage.list_league_rosters_by_team(league["id"])[team["id"]][0]
    assert int((restored.get("contract") or {}).get("years_remaining") or restored["contract_years"]) == 2
    assert result["state"]["league"]["draft_completed"] is False


def test_reset_live_rejected_for_practice(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("mock-user", "Mock", 2026, rules, test_mode=True)
    start_draft(league["id"], "mock-user")
    with pytest.raises(ValueError, match="practice"):
        reset_live_draft(league["id"], "mock-user")


def test_rewind_contract_year_roundtrip():
    row = {"salary": 8, "contract_years": 2}
    contract = {
        "years_remaining": 2,
        "current_salary": 8,
        "base_salary": 8,
        "schedule": [{"year_offset": 0, "salary": 8}, {"year_offset": 1, "salary": 13}],
        "contract_type": "extension",
        "step_up_per_year": 5,
    }
    advanced = advance_contract_year(contract, row)
    assert advanced["years_remaining"] == 1
    assert advanced["current_salary"] == 13
    rewound = rewind_contract_year(advanced, {**row, "contract_years": 1, "salary": advanced["current_salary"]})
    assert rewound["years_remaining"] == 2
    assert rewound["current_salary"] == 8
    assert [y["salary"] for y in rewound["schedule"]] == [8, 13]


def test_rewind_restores_stepped_veteran_schedule():
    row = {"salary": 8, "contract_years": 2}
    contract = {
        "years_remaining": 2,
        "current_salary": 8,
        "base_salary": 8,
        "schedule": [{"year_offset": 0, "salary": 8}, {"year_offset": 1, "salary": 13}],
        "contract_type": "veteran",
        "step_up_per_year": 5,
    }
    advanced = advance_contract_year(contract, row)
    assert advanced["years_remaining"] == 1
    assert [y["salary"] for y in advanced["schedule"]] == [13]
    rewound = rewind_contract_year(advanced, {**row, "contract_years": 1, "salary": 13})
    assert rewound["years_remaining"] == 2
    assert rewound["current_salary"] == 8
    assert [y["salary"] for y in rewound["schedule"]] == [8, 13]
