"""Keeper expire sandbox — clone, nominatable expirees, year tick, delete isolation."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.contracts import build_rookie_contract, build_veteran_contract
from src.draft_hub.draft_budgets import computed_auction_budget
from src.draft_hub.draft_expire_preview import build_draft_expire_preview
from src.draft_hub.draft_pool import list_drafted_player_ids
from src.draft_hub.draft_state import (
    end_draft,
    get_room_state,
    nominate,
    start_draft,
    update_auction_rules,
)
from src.draft_hub.mock_draft import start_mock_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _seed_source_league(comm_sub: str = "comm-sandbox") -> dict:
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
    league_id = league["id"]
    teams = storage.list_league_teams(league_id)
    comm_team = next(t for t in teams if t.get("is_commissioner"))
    other_id = "other-team-1"
    storage.add_bot_team(league_id, other_id, "Other Team", float(rules.salary_cap))
    # Force bot to a real user team for roster ownership clarity
    with storage.get_conn() as conn:
        conn.execute(
            "UPDATE team SET is_bot = 0, user_sub = ? WHERE id = ?",
            ("other-user", other_id),
        )

    ws_id = storage.roster_workspace_for_league(league)
    rook = build_rookie_contract(10, 2)
    vet = build_veteran_contract(15, 1)
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-rook-keep",
            "player_name": "Rookie Keeper",
            "team": "NE",
            "position": "RB",
            "salary": 10,
            "contract_years": 2,
            "contract": rook,
            "source": "sheet",
        },
        team_id=comm_team["id"],
    )
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-vet-expire",
            "player_name": "Expiring Vet",
            "team": "KC",
            "position": "WR",
            "salary": 15,
            "contract_years": 1,
            "contract": vet,
            "source": "sheet",
        },
        team_id=comm_team["id"],
    )
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-other-keep",
            "player_name": "Other Keeper",
            "team": "BUF",
            "position": "QB",
            "salary": 20,
            "contract_years": 2,
            "contract": build_rookie_contract(20, 2),
            "source": "sheet",
        },
        team_id=other_id,
    )
    return {
        "league_id": league_id,
        "comm_sub": comm_sub,
        "ws_id": ws_id,
        "comm_team_id": comm_team["id"],
        "rules": LeagueRules.model_validate(rules.model_dump()),
    }


def test_expire_preview_counts(hub_db):
    seeded = _seed_source_league()
    preview = build_draft_expire_preview(seeded["league_id"])
    assert preview["expire_count"] == 1
    assert preview["retained_count"] == 2
    expire_ids = {p["player_id"] for p in preview["expire"]}
    assert expire_ids == {"00-vet-expire"}


def test_keeper_sandbox_clone_and_nominatable(hub_db):
    seeded = _seed_source_league()
    result = start_mock_draft(
        seeded["comm_sub"],
        mode="keeper_sandbox",
        source_league_id=seeded["league_id"],
        auto_start=False,
    )
    sandbox_id = result["league_id"]
    assert result["mock_mode"] == "keeper_sandbox"
    assert result["summary"]["expire_count"] == 1
    assert result["summary"]["retained_count"] == 2
    assert result["summary"]["players"] == 3

    start_draft(sandbox_id, seeded["comm_sub"])
    drafted = list_drafted_player_ids(sandbox_id)
    assert "00-rook-keep" in drafted
    assert "00-other-keep" in drafted
    assert "00-vet-expire" not in drafted  # nominatable


def test_end_draft_ticks_and_removes_expiree(hub_db):
    seeded = _seed_source_league()
    result = start_mock_draft(
        seeded["comm_sub"],
        mode="keeper_sandbox",
        source_league_id=seeded["league_id"],
        auto_start=False,
    )
    sandbox_id = result["league_id"]
    start_draft(sandbox_id, seeded["comm_sub"])
    end_draft(sandbox_id, seeded["comm_sub"], force=True)

    ws = storage.roster_workspace_for_league(storage.get_league(sandbox_id))
    ids = {r["player_id"] for r in storage.list_roster(ws)}
    assert "00-vet-expire" not in ids
    rook = storage.get_roster_slot(ws, "00-rook-keep")
    assert rook is not None
    assert int(rook["contract"]["years_remaining"]) == 1


def test_delete_sandbox_leaves_source_intact(hub_db):
    seeded = _seed_source_league()
    result = start_mock_draft(
        seeded["comm_sub"],
        mode="keeper_sandbox",
        source_league_id=seeded["league_id"],
        auto_start=False,
    )
    sandbox_id = result["league_id"]
    storage.delete_league(sandbox_id)
    assert storage.get_league(sandbox_id) is None

    src_by_team = storage.list_league_rosters_by_team(seeded["league_id"])
    src_ids = {r["player_id"] for rows in src_by_team.values() for r in rows}
    assert src_ids == {
        "00-rook-keep",
        "00-vet-expire",
        "00-other-keep",
    }


def _add_over_cap_keeper(seeded: dict) -> None:
    storage.add_roster_slot(
        seeded["ws_id"],
        {
            "player_id": "00-over-keep",
            "player_name": "Over Cap Keeper",
            "team": "MIA",
            "position": "WR",
            "salary": 250,
            "contract_years": 2,
            "contract": build_veteran_contract(250, 2),
            "source": "sheet",
        },
        team_id=seeded["comm_team_id"],
    )


def _sandbox_comm_team(sandbox_id: str) -> dict:
    return next(t for t in storage.list_league_teams(sandbox_id) if t.get("is_commissioner"))


def test_over_cap_sandbox_blocks_nominate_until_limits_relaxed(hub_db, monkeypatch):
    seeded = _seed_source_league()
    _add_over_cap_keeper(seeded)
    result = start_mock_draft(
        seeded["comm_sub"],
        mode="keeper_sandbox",
        source_league_id=seeded["league_id"],
        auto_start=False,
    )
    sandbox_id = result["league_id"]
    comm = _sandbox_comm_team(sandbox_id)
    rules = LeagueRules.model_validate(storage.get_league(sandbox_id)["rules"])
    roster = storage.list_team_roster(sandbox_id, comm["id"])
    assert computed_auction_budget(rules, roster) < 0
    assert float(storage.get_team(comm["id"])["budget_remaining"]) < 0
    assert rules.relax_salary_roster_limits is False

    start_draft(sandbox_id, seeded["comm_sub"])
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
            sandbox_id,
            seeded["comm_sub"],
            {"player_id": "fa-wr", "player_name": "FA WR", "position": "WR"},
        )


def test_relaxed_sandbox_gives_full_cap_and_allows_nominate(hub_db, monkeypatch):
    seeded = _seed_source_league()
    _add_over_cap_keeper(seeded)
    result = start_mock_draft(
        seeded["comm_sub"],
        mode="keeper_sandbox",
        source_league_id=seeded["league_id"],
        auto_start=False,
        relax_salary_roster_limits=True,
    )
    sandbox_id = result["league_id"]
    comm = _sandbox_comm_team(sandbox_id)
    rules = LeagueRules.model_validate(storage.get_league(sandbox_id)["rules"])
    assert rules.relax_salary_roster_limits is True
    roster = storage.list_team_roster(sandbox_id, comm["id"])
    assert computed_auction_budget(rules, roster) == float(rules.salary_cap)
    assert float(storage.get_team(comm["id"])["budget_remaining"]) == float(rules.salary_cap)
    assert get_room_state(sandbox_id, seeded["comm_sub"])["limits_relaxed"] is True

    start_draft(sandbox_id, seeded["comm_sub"])
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: {
            "player_id": "fa-wr",
            "player_name": "FA WR",
            "team": "DAL",
            "position": "WR",
        },
    )
    nominate(
        sandbox_id,
        seeded["comm_sub"],
        {"player_id": "fa-wr", "player_name": "FA WR", "position": "WR"},
    )


def test_sandbox_can_toggle_relaxed_limits_and_resync_budgets(hub_db):
    seeded = _seed_source_league()
    _add_over_cap_keeper(seeded)
    result = start_mock_draft(
        seeded["comm_sub"],
        mode="keeper_sandbox",
        source_league_id=seeded["league_id"],
        auto_start=False,
    )
    sandbox_id = result["league_id"]
    comm = _sandbox_comm_team(sandbox_id)
    assert float(storage.get_team(comm["id"])["budget_remaining"]) < 0

    state = update_auction_rules(
        sandbox_id,
        seeded["comm_sub"],
        {"relax_salary_roster_limits": True},
    )
    assert state["limits_relaxed"] is True
    rules = LeagueRules.model_validate(storage.get_league(sandbox_id)["rules"])
    assert rules.relax_salary_roster_limits is True
    assert float(storage.get_team(comm["id"])["budget_remaining"]) == float(rules.salary_cap)


def test_live_league_cannot_relax_salary_roster_limits(hub_db):
    seeded = _seed_source_league()
    with pytest.raises(ValueError, match="practice sandbox"):
        update_auction_rules(
            seeded["league_id"],
            seeded["comm_sub"],
            {"relax_salary_roster_limits": True},
        )
    storage.update_league_rules(
        seeded["league_id"],
        seeded["rules"].model_copy(update={"relax_salary_roster_limits": True}),
    )
    live_rules = LeagueRules.model_validate(storage.get_league(seeded["league_id"])["rules"])
    assert live_rules.relax_salary_roster_limits is False

