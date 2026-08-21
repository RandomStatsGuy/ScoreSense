"""SCORE-46: live/sandbox budgets, min-bid reserve, cuts, sandbox reset."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.contracts import build_rookie_contract, build_veteran_contract
from src.draft_hub.draft_budgets import (
    DEADCAP_PREFIX,
    computed_auction_budget,
    max_affordable_bid,
    preserve_cut_liability,
)
from src.draft_hub.draft_state import (
    award_nominee,
    end_draft,
    nominate,
    place_bid,
    reset_live_draft,
    start_draft,
)
from src.draft_hub.mock_draft import start_mock_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.rules_engine import assert_can_acquire
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.test_draft import reset_test_draft


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _seed_source(comm_sub: str = "comm-fin") -> dict:
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace(comm_sub, 2026)
    league = storage.create_league(
        comm_sub,
        "Source Cap League",
        2026,
        rules,
        team_count=2,
        workspace_id=ws["id"],
        commissioner_team_name="Comm Team",
        test_mode=False,
    )
    lid = league["id"]
    comm = next(t for t in storage.list_league_teams(lid) if t.get("is_commissioner"))
    other_id = "other-fin-1"
    storage.add_bot_team(lid, other_id, "Other Team", float(rules.salary_cap))
    with storage.get_conn() as conn:
        conn.execute(
            "UPDATE team SET is_bot = 0, user_sub = ? WHERE id = ?",
            ("other-user", other_id),
        )
    ws_id = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "keep-rb",
            "player_name": "Keeper RB",
            "team": "NE",
            "position": "RB",
            "salary": 80,
            "contract_years": 2,
            "contract": build_rookie_contract(80, 2),
            "source": "sheet",
        },
        team_id=comm["id"],
    )
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "cut-qb",
            "player_name": "Cut QB",
            "team": "BUF",
            "position": "QB",
            "salary": 40,
            "contract_years": 1,
            "contract": build_veteran_contract(40, 1),
            "source": "sheet",
            "roster_status": "cut_before_draft",
        },
        team_id=comm["id"],
    )
    return {
        "league_id": lid,
        "comm_sub": comm_sub,
        "comm_team_id": comm["id"],
        "other_id": other_id,
        "ws_id": ws_id,
        "rules": LeagueRules.model_validate(rules.model_dump()),
    }


def test_computed_budget_is_cap_minus_retained_and_dead(hub_db):
    seeded = _seed_source()
    rows = storage.list_team_roster(seeded["league_id"], seeded["comm_team_id"])
    # $80 keeper + 50% of $40 cut = $20 dead → $100 auction budget
    assert computed_auction_budget(seeded["rules"], rows) == 100.0
    assert storage.get_team(seeded["comm_team_id"])["budget_remaining"] == 200.0


def test_completed_fallback_subtracts_dead_and_excludes_expiring(hub_db):
    seeded = _seed_source()
    storage.add_roster_slot(
        seeded["ws_id"],
        {
            "player_id": "exp-wr",
            "player_name": "Expiring WR",
            "team": "CHI",
            "position": "WR",
            "salary": 30,
            "contract_years": 1,
            "contract": build_veteran_contract(30, 1),
            "source": "sheet",
        },
        team_id=seeded["comm_team_id"],
    )
    rows = storage.list_team_roster(seeded["league_id"], seeded["comm_team_id"])
    # 1-year keeper is not retained before the draft; dead cap still counts after complete.
    assert computed_auction_budget(seeded["rules"], rows, draft_completed=False) == 100.0
    assert computed_auction_budget(seeded["rules"], rows, draft_completed=True) == 70.0


def test_start_draft_and_sandbox_sync_budgets(hub_db):
    seeded = _seed_source()
    start_draft(seeded["league_id"], seeded["comm_sub"])
    assert float(storage.get_team(seeded["comm_team_id"])["budget_remaining"]) == 100.0

    out = start_mock_draft(
        seeded["comm_sub"],
        mode="keeper_sandbox",
        source_league_id=seeded["league_id"],
        auto_start=False,
    )
    sandbox_id = out["league_id"]
    comm = next(t for t in storage.list_league_teams(sandbox_id) if t.get("is_commissioner"))
    assert float(comm["budget_remaining"]) == 100.0
    assert out["summary"]["budgets"][comm["id"]] == 100.0


def test_over_cap_team_cannot_bid(hub_db, monkeypatch):
    seeded = _seed_source()
    # Add another $150 keeper so committed+dead > $200
    storage.add_roster_slot(
        seeded["ws_id"],
        {
            "player_id": "keep-wr",
            "player_name": "Keeper WR",
            "team": "MIA",
            "position": "WR",
            "salary": 150,
            "contract_years": 2,
            "contract": build_veteran_contract(150, 2),
            "source": "sheet",
        },
        team_id=seeded["comm_team_id"],
    )
    start_draft(seeded["league_id"], seeded["comm_sub"])
    assert float(storage.get_team(seeded["comm_team_id"])["budget_remaining"]) < 0

    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: {
            "player_id": "fa-wr",
            "player_name": "FA WR",
            "team": "DAL",
            "position": "WR",
        },
    )
    with pytest.raises(ValueError, match="over cap"):
        nominate(
            seeded["league_id"],
            seeded["comm_sub"],
            {"player_id": "fa-wr", "player_name": "FA WR", "position": "WR"},
        )


def test_server_reserves_min_bid_for_open_slots(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    roster = [
        {
            "player_id": "k1",
            "position": "RB",
            "salary": 10,
            "contract_years": 2,
            "source": "sheet",
            "contract": build_rookie_contract(10, 2),
        }
    ]
    # 27 slots, 1 occupied → 26 open; reserve 25 * $1
    assert max_affordable_bid(rules, roster, 100.0) == 75.0
    from src.draft_hub.draft_budgets import assert_can_afford_auction_bid

    with pytest.raises(ValueError, match="reserving"):
        assert_can_afford_auction_bid(rules, roster, 100.0, 76)


def test_expiring_and_cut_do_not_consume_position_slots():
    rules = load_preset("salary_cap_auction_v1")
    roster = [
        {
            "player_id": "exp-wr",
            "position": "WR",
            "salary": 5,
            "contract_years": 1,
            "source": "sheet",
            "roster_status": "active",
        },
        {
            "player_id": "cut-wr",
            "position": "WR",
            "salary": 5,
            "contract_years": 1,
            "source": "sheet",
            "roster_status": "cut_before_draft",
        },
    ]
    # Neither row is retained — can still acquire a WR.
    assert_can_acquire(rules, roster, "WR")


def test_total_roster_size_limit():
    rules = LeagueRules(
        roster_size_max=1,
        roster={"wr": {"min": 0, "max": 8}, "rb": {"min": 0, "max": 8}},
    )
    roster = [
        {
            "player_id": "k1",
            "position": "RB",
            "salary": 10,
            "contract_years": 2,
            "source": "sheet",
            "contract": build_rookie_contract(10, 2),
        }
    ]
    with pytest.raises(ValueError, match="maximum size"):
        assert_can_acquire(rules, roster, "WR")


def test_award_preserves_cut_liability(hub_db, monkeypatch):
    seeded = _seed_source()
    start_draft(seeded["league_id"], seeded["comm_sub"])
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: {
            "player_id": "cut-qb",
            "player_name": "Cut QB",
            "team": "BUF",
            "position": "QB",
        },
    )
    nominate(
        seeded["league_id"],
        seeded["comm_sub"],
        {"player_id": "cut-qb", "player_name": "Cut QB", "position": "QB"},
    )
    place_bid(seeded["league_id"], seeded["comm_sub"], 2)
    award_nominee(seeded["league_id"], seeded["comm_sub"])

    rows = storage.list_team_roster(seeded["league_id"], seeded["comm_team_id"])
    by_id = {r["player_id"]: r for r in rows}
    assert f"{DEADCAP_PREFIX}cut-qb" in by_id
    assert by_id[f"{DEADCAP_PREFIX}cut-qb"]["roster_status"] == "cut_before_draft"
    assert by_id["cut-qb"]["source"] == "draft"
    assert by_id["cut-qb"]["roster_status"] == "active"


def test_preserve_cut_liability_when_deadcap_row_exists(hub_db):
    seeded = _seed_source()
    first = preserve_cut_liability(seeded["ws_id"], "cut-qb")
    assert first is not None
    assert first["player_id"] == f"{DEADCAP_PREFIX}cut-qb"
    storage.add_roster_slot(
        seeded["ws_id"],
        {
            "player_id": "cut-qb",
            "player_name": "Cut QB",
            "team": "BUF",
            "position": "QB",
            "salary": 40,
            "contract_years": 1,
            "contract": build_veteran_contract(40, 1),
            "source": "sheet",
            "roster_status": "cut_before_draft",
        },
        team_id=seeded["comm_team_id"],
    )
    second = preserve_cut_liability(seeded["ws_id"], "cut-qb")
    assert second is not None
    assert second["player_id"] == f"{DEADCAP_PREFIX}cut-qb"
    storage.add_roster_slot(
        seeded["ws_id"],
        {
            "player_id": "cut-qb",
            "player_name": "Cut QB",
            "team": "BUF",
            "position": "QB",
            "salary": 2,
            "contract_years": 1,
            "source": "draft",
        },
        team_id=seeded["comm_team_id"],
    )
    rows = storage.list_team_roster(seeded["league_id"], seeded["comm_team_id"])
    by_id = {r["player_id"]: r for r in rows}
    assert f"{DEADCAP_PREFIX}cut-qb" in by_id
    assert by_id["cut-qb"]["source"] == "draft"


def test_reset_after_end_syncs_budget_after_rewind(hub_db):
    seeded = _seed_source()
    storage.add_roster_slot(
        seeded["ws_id"],
        {
            "player_id": "keep-te",
            "player_name": "Keeper TE",
            "team": "KC",
            "position": "TE",
            "salary": 10,
            "contract_years": 2,
            "contract": {
                "contract_type": "veteran",
                "years_remaining": 2,
                "current_salary": 10,
                "base_salary": 10,
                "step_up_per_year": 5,
                "schedule": [
                    {"year_offset": 0, "salary": 10},
                    {"year_offset": 1, "salary": 15},
                ],
            },
            "source": "sheet",
        },
        team_id=seeded["comm_team_id"],
    )
    start_draft(seeded["league_id"], seeded["comm_sub"])
    # $80 + $10 retained + $20 dead → $90
    assert float(storage.get_team(seeded["comm_team_id"])["budget_remaining"]) == 90.0
    end_draft(seeded["league_id"], seeded["comm_sub"], force=True)
    reset_live_draft(seeded["league_id"], seeded["comm_sub"])
    assert float(storage.get_team(seeded["comm_team_id"])["budget_remaining"]) == 90.0


def test_sandbox_reset_after_end_uses_pre_draft_budget(hub_db):
    seeded = _seed_source()
    storage.add_roster_slot(
        seeded["ws_id"],
        {
            "player_id": "exp-wr",
            "player_name": "Expiring WR",
            "team": "CHI",
            "position": "WR",
            "salary": 30,
            "contract_years": 1,
            "contract": build_veteran_contract(30, 1),
            "source": "sheet",
        },
        team_id=seeded["comm_team_id"],
    )
    out = start_mock_draft(
        seeded["comm_sub"],
        mode="keeper_sandbox",
        source_league_id=seeded["league_id"],
        auto_start=False,
    )
    sandbox_id = out["league_id"]
    comm = next(t for t in storage.list_league_teams(sandbox_id) if t.get("is_commissioner"))
    assert float(comm["budget_remaining"]) == 100.0
    start_draft(sandbox_id, seeded["comm_sub"])
    end_draft(sandbox_id, seeded["comm_sub"], force=True)
    reset_test_draft(sandbox_id, seeded["comm_sub"])
    assert float(storage.get_team(comm["id"])["budget_remaining"]) == 100.0


def test_sandbox_reset_restores_keepers_and_budgets(hub_db):
    seeded = _seed_source()
    out = start_mock_draft(
        seeded["comm_sub"],
        mode="keeper_sandbox",
        source_league_id=seeded["league_id"],
        auto_start=False,
    )
    sandbox_id = out["league_id"]
    comm = next(t for t in storage.list_league_teams(sandbox_id) if t.get("is_commissioner"))
    ws = storage.roster_workspace_for_league(storage.get_league(sandbox_id))
    storage.add_roster_slot(
        ws,
        {
            "player_id": "draft-pick",
            "player_name": "Pick",
            "team": "KC",
            "position": "WR",
            "salary": 15,
            "contract_years": 1,
            "source": "draft",
        },
        team_id=comm["id"],
    )
    storage.update_team_budget(comm["id"], 50.0)

    reset_test_draft(sandbox_id, seeded["comm_sub"])
    restored = storage.list_team_roster(sandbox_id, comm["id"])
    ids = {r["player_id"] for r in restored}
    assert "keep-rb" in ids
    assert "cut-qb" in ids
    assert "draft-pick" not in ids
    assert float(storage.get_team(comm["id"])["budget_remaining"]) == 100.0


def test_client_position_is_not_trusted(hub_db, monkeypatch):
    seeded = _seed_source()
    start_draft(seeded["league_id"], seeded["comm_sub"])
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: {
            "player_id": "pool-te",
            "player_name": "Pool TE",
            "team": "SF",
            "position": "TE",
        },
    )
    state = nominate(
        seeded["league_id"],
        seeded["comm_sub"],
        {"player_id": "pool-te", "player_name": "Hacked", "position": "QB"},
    )
    nominee = state["session"]["current_nominee"]
    assert nominee["position"] == "TE"
    assert nominee["player_name"] == "Pool TE"
