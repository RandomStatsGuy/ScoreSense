"""Contract typing, year clock, and backfill helpers."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.contract_typing import (
    advance_contract_year,
    advance_roster_contracts_for_draft_complete,
    backfill_row_contract,
    infer_contract_type,
    suggested_rookie_years_pre_draft,
)
from src.draft_hub.pre_draft_cap import pre_draft_cap_summary
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _rules() -> LeagueRules:
    return LeagueRules()


def test_henderson_like_inference_and_years():
    rules = _rules()
    assert suggested_rookie_years_pre_draft(rules, years_exp=1) == 2
    assert infer_contract_type(None, rules, years_exp=1, season=2026) == "rookie"
    row = {
        "player_id": "00-henderson",
        "salary": 12,
        "contract_years": 1,
        "contract": {"contract_type": "veteran", "years_remaining": 1, "current_salary": 12},
        "roster_status": "active",
    }
    updated = backfill_row_contract(rules, row, season=2026, draft_completed=False, years_exp=1)
    assert updated is not None
    assert updated["contract_type"] == "rookie"
    assert updated["years_remaining"] == 2


def test_backfill_does_not_inflate_ticked_rookie_years():
    """After draft-complete tick (2→1), reopening pre-draft for 2026 must keep 1."""
    rules = _rules()
    row = {
        "player_id": "00-henderson",
        "salary": 12,
        "contract_years": 1,
        "contract": {
            "contract_type": "rookie",
            "years_remaining": 1,
            "current_salary": 12,
            "schedule": [{"year_offset": 0, "salary": 12}],
        },
        "roster_status": "active",
    }
    updated = backfill_row_contract(rules, row, season=2026, draft_completed=False, years_exp=1)
    assert updated is None


def test_update_league_season_reopens_predraft_without_rewind(hub_db):
    """Advancing season clears draft_completed but does not touch roster years."""
    league = storage.create_league(
        commissioner_sub="season-advance",
        name="Season Advance",
        season=2025,
        rules=LeagueRules(),
    )
    lid = str(league["id"])
    storage.update_league_settings(lid, draft_completed=True)
    ws_id = storage.roster_workspace_for_league(storage.get_league(lid))
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-advance",
            "player_name": "Keep Years",
            "team": "NE",
            "position": "RB",
            "salary": 10,
            "contract_years": 1,
            "contract": {
                "contract_type": "rookie",
                "years_remaining": 1,
                "current_salary": 10,
                "schedule": [{"year_offset": 0, "salary": 10}],
            },
        },
    )
    updated = storage.update_league_season(lid, 2026)
    assert updated["season"] == 2026
    assert updated["draft_completed"] is False
    row = storage.get_roster_slot(ws_id, "00-advance")
    assert int(row["contract"]["years_remaining"]) == 1
    assert int(row["contract_years"]) == 1


def test_inference_preserves_extension():
    rules = _rules()
    prior = {"contract_type": "extension", "renewal_used": True, "years_remaining": 2}
    assert infer_contract_type(prior, rules, years_exp=0, season=2026) == "extension"


def test_year_clock_advances_and_expires():
    rules = _rules()
    roster = [
        {
            "player_id": "a",
            "roster_status": "active",
            "contract_years": 2,
            "salary": 10,
            "contract": {
                "contract_type": "rookie",
                "years_remaining": 2,
                "current_salary": 10,
                "schedule": [
                    {"year_offset": 0, "salary": 10},
                    {"year_offset": 1, "salary": 10},
                ],
            },
        },
        {
            "player_id": "b",
            "roster_status": "active",
            "contract_years": 1,
            "salary": 5,
            "contract": {
                "contract_type": "veteran",
                "years_remaining": 1,
                "current_salary": 5,
                "schedule": [{"year_offset": 0, "salary": 5}],
            },
        },
    ]
    summary = advance_roster_contracts_for_draft_complete(rules, roster)
    assert summary["advanced"] == 1
    assert summary["expired"] == 1
    kept = next(u for u in summary["updates"] if u["player_id"] == "a")
    assert kept["contract"]["years_remaining"] == 1
    dropped = next(u for u in summary["updates"] if u["player_id"] == "b")
    assert dropped["expired"] is True


def test_pre_draft_henderson_not_expiring_with_two_years():
    rules = _rules()
    roster = [
        {
            "player_id": "00-henderson",
            "player_name": "TreVeyon Henderson",
            "salary": 12,
            "contract_years": 2,
            "roster_status": "active",
            "contract": {
                "contract_type": "rookie",
                "years_remaining": 2,
                "current_salary": 12,
                "schedule": [
                    {"year_offset": 0, "salary": 12},
                    {"year_offset": 1, "salary": 12},
                ],
            },
        }
    ]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert summary["must_extend"] == []
    assert summary["dropping_at_draft"] == []


def test_after_tick_rookie_must_extend_veteran_drops():
    rules = _rules()
    rook = {
        "player_id": "r1",
        "player_name": "Rookie",
        "salary": 10,
        "contract_years": 1,
        "roster_status": "active",
        "contract": {"contract_type": "rookie", "years_remaining": 1, "current_salary": 10},
    }
    vet = {
        "player_id": "v1",
        "player_name": "Vet",
        "salary": 8,
        "contract_years": 1,
        "roster_status": "active",
        "contract": {"contract_type": "veteran", "years_remaining": 1, "current_salary": 8},
    }
    summary = pre_draft_cap_summary(rules, [rook, vet], draft_completed=False)
    assert len(summary["must_extend"]) == 1
    assert summary["must_extend"][0]["player_id"] == "r1"
    assert len(summary["dropping_at_draft"]) == 1
    assert summary["dropping_at_draft"][0]["player_id"] == "v1"


def test_years_edit_preserves_manual_type_meta():
    rules = _rules()
    prior = {
        "contract_type": "rookie",
        "contract_type_manual": True,
        "years_remaining": 2,
        "current_salary": 12,
        "schedule": [
            {"year_offset": 0, "salary": 12},
            {"year_offset": 1, "salary": 12},
        ],
        "renewal_used": False,
        "step_up_per_year": 5,
    }
    from src.draft_hub.contracts import build_contract_from_roster_edit

    updated = build_contract_from_roster_edit(
        rules,
        current_salary=12,
        years_remaining=1,
        existing=prior,
    )
    assert updated["contract_type"] == "rookie"
    assert updated["contract_type_manual"] is True
    assert updated["years_remaining"] == 1
