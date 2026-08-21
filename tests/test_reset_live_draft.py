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
    # $12 two-year keeper is retained — auction budget is cap minus that hit.
    assert float(refreshed["budget_remaining"]) == 188.0


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
    end_draft(league["id"], "live-commish", force=True)

    after_end = storage.list_league_rosters_by_team(league["id"])[team["id"]][0]
    assert int((after_end.get("contract") or {}).get("years_remaining") or after_end["contract_years"]) == 1

    result = reset_live_draft(league["id"], "live-commish")
    assert result["year_rewind"]["lossless"] is True
    assert result["year_rewind"]["rewound"] == 1
    restored = storage.list_league_rosters_by_team(league["id"])[team["id"]][0]
    assert int((restored.get("contract") or {}).get("years_remaining") or restored["contract_years"]) == 2
    assert result["state"]["league"]["draft_completed"] is False
    assert result["warning"] is None


def test_reset_after_end_restores_expired_keepers(hub_db):
    """Lossless reset reinstates keepers archived by the draft-complete year tick."""
    league = _live_league()
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws,
        {
            "player_id": "expiring-vet",
            "player_name": "Expiring Vet",
            "team": "CHI",
            "position": "WR",
            "salary": 20,
            "contract_years": 1,
            "source": "sheet",
            "contract": {
                "contract_type": "veteran",
                "years_remaining": 1,
                "current_salary": 20,
                "schedule": [{"year_offset": 0, "salary": 20}],
            },
        },
        team_id=team["id"],
    )
    storage.add_roster_slot(
        ws,
        {
            "player_id": "auction-win",
            "player_name": "Auction Win",
            "team": "BUF",
            "position": "RB",
            "salary": 35,
            "contract_years": 1,
            "source": "draft",
            "contract": {
                "contract_type": "veteran",
                "years_remaining": 1,
                "current_salary": 35,
                "schedule": [{"year_offset": 0, "salary": 35}],
            },
        },
        team_id=team["id"],
    )
    start_draft(league["id"], "live-commish")
    end_draft(league["id"], "live-commish", force=True)

    after = {r["player_id"]: r for r in storage.list_league_rosters_by_team(league["id"])[team["id"]]}
    assert "expiring-vet" in after
    assert after["expiring-vet"]["roster_status"] == "expired"
    assert int(after["expiring-vet"]["contract_years"]) == 0
    assert "auction-win" in after
    assert int(after["auction-win"]["contract"]["years_remaining"]) == 1

    result = reset_live_draft(league["id"], "live-commish")
    assert result["year_rewind"]["lossless"] is True
    assert result["picks_removed"] == 1
    restored = {r["player_id"]: r for r in storage.list_league_rosters_by_team(league["id"])[team["id"]]}
    assert "expiring-vet" in restored
    assert restored["expiring-vet"]["roster_status"] == "active"
    assert "auction-win" not in restored
    assert int(restored["expiring-vet"]["contract"]["years_remaining"]) == 1


def test_end_draft_activates_pending_extension_and_skips_auction(hub_db):
    from src.draft_hub.contracts import apply_or_queue_extension, build_rookie_contract

    league = _live_league()
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    ws = storage.roster_workspace_for_league(league)
    rules = load_preset("salary_cap_auction_v1")
    row = {
        "player_id": "rook-ext",
        "player_name": "Rook Extend",
        "team": "NE",
        "position": "QB",
        "salary": 10,
        "contract_years": 1,
        "source": "sheet",
        "contract": {
            **build_rookie_contract(10, 2),
            "years_remaining": 1,
            "schedule": [{"year_offset": 0, "salary": 10}],
        },
    }
    row["contract"] = apply_or_queue_extension(
        row, rules, extension_years=3, start_salary=10, draft_completed=False
    )
    storage.add_roster_slot(ws, row, team_id=team["id"])
    storage.add_roster_slot(
        ws,
        {
            "player_id": "new-buy",
            "player_name": "New Buy",
            "team": "KC",
            "position": "WR",
            "salary": 40,
            "contract_years": 1,
            "source": "auction",
            "contract": {
                "contract_type": "veteran",
                "years_remaining": 1,
                "current_salary": 40,
                "schedule": [{"year_offset": 0, "salary": 40}],
            },
        },
        team_id=team["id"],
    )
    start_draft(league["id"], "live-commish")
    state = end_draft(league["id"], "live-commish", force=True)
    tick = state.get("contract_year_tick") or {}
    assert tick.get("extensions_activated") == 1
    assert tick.get("skipped_auction") == 1
    assert tick.get("snapshot_published") is True

    by_id = {r["player_id"]: r for r in storage.list_league_rosters_by_team(league["id"])[team["id"]]}
    assert int(by_id["rook-ext"]["contract"]["years_remaining"]) == 3
    assert by_id["rook-ext"]["contract"]["contract_type"] == "extension"
    assert "pending_extension" not in by_id["rook-ext"]["contract"]
    assert int(by_id["new-buy"]["contract"]["years_remaining"]) == 1
    snap = storage.get_draft_contract_snapshot(league["id"])
    assert snap and snap.get("published") is True
    assert snap.get("post_draft", {}).get("extensions_activated") == 1


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
