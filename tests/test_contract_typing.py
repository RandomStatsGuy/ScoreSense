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


def test_suggested_rookie_years_pre_draft_by_exp():
    """years_exp=0 → full 2-year deal; years_exp=1 → 1 year left (no +1 inflate)."""
    rules = _rules()
    assert suggested_rookie_years_pre_draft(rules, years_exp=0) == 2
    assert suggested_rookie_years_pre_draft(rules, years_exp=1) == 1
    assert suggested_rookie_years_pre_draft(rules, years_exp=2) is None
    assert suggested_rookie_years_pre_draft(rules, years_exp=None) is None


def test_mistyped_veteran_years_exp_1_becomes_rookie_without_inflate():
    """Type correction only: mistyped vet with years_exp=1 keeps 1 year, not 2."""
    rules = _rules()
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
    assert updated["years_remaining"] == 1


def test_mistyped_veteran_years_exp_0_corrected_to_two_year_rookie():
    """Actual mistype with NFL years_exp=0 may still inflate 1→2 on backfill."""
    rules = _rules()
    row = {
        "player_id": "00-true-rookie",
        "salary": 5,
        "contract_years": 1,
        "contract": {"contract_type": "veteran", "years_remaining": 1, "current_salary": 5},
        "roster_status": "active",
    }
    updated = backfill_row_contract(rules, row, season=2026, draft_completed=False, years_exp=0)
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


def test_auction_awards_survive_draft_complete_tick():
    """Current auction winners (all acquisition sources) are not year-ticked."""
    from src.draft_hub.acquisition_semantics import CURRENT_AUCTION_SOURCES

    rules = _rules()
    roster = []
    for i, src in enumerate(sorted(CURRENT_AUCTION_SOURCES)):
        roster.append(
            {
                "player_id": f"award-{src}",
                "roster_status": "active",
                "source": src,
                "contract_years": 1,
                "salary": 10 + i,
                "contract": {
                    "contract_type": "veteran",
                    "years_remaining": 1,
                    "current_salary": 10 + i,
                    "schedule": [{"year_offset": 0, "salary": 10 + i}],
                },
            }
        )
    roster.append(
        {
            "player_id": "keeper",
            "roster_status": "active",
            "source": "sheet",
            "contract_years": 2,
            "salary": 8,
            "contract": {
                "contract_type": "rookie",
                "years_remaining": 2,
                "current_salary": 8,
                "schedule": [
                    {"year_offset": 0, "salary": 8},
                    {"year_offset": 1, "salary": 8},
                ],
            },
        }
    )
    summary = advance_roster_contracts_for_draft_complete(rules, roster)
    assert summary["skipped_auction"] == len(CURRENT_AUCTION_SOURCES)
    assert summary["advanced"] == 1
    assert summary["expired"] == 0
    assert {u["player_id"] for u in summary["updates"]} == {"keeper"}
    assert next(u for u in summary["updates"] if u["player_id"] == "keeper")["contract"][
        "years_remaining"
    ] == 1


def test_pending_extensions_activate_after_tick_at_full_duration():
    """1-year and 3-year queued extensions keep chosen duration after draft complete."""
    from src.draft_hub.contracts import apply_or_queue_extension, build_rookie_contract

    rules = _rules()
    one_yr = {
        "player_id": "ext-1",
        "roster_status": "active",
        "source": "sheet",
        "salary": 10,
        "contract_years": 1,
        "contract": {
            **build_rookie_contract(10, 2),
            "years_remaining": 1,
            "schedule": [{"year_offset": 0, "salary": 10}],
        },
    }
    three_yr = {
        "player_id": "ext-3",
        "roster_status": "active",
        "source": "sheet",
        "salary": 12,
        "contract_years": 1,
        "contract": {
            **build_rookie_contract(12, 2),
            "years_remaining": 1,
            "schedule": [{"year_offset": 0, "salary": 12}],
        },
    }
    one_yr["contract"] = apply_or_queue_extension(
        one_yr, rules, extension_years=1, start_salary=10, draft_completed=False
    )
    three_yr["contract"] = apply_or_queue_extension(
        three_yr, rules, extension_years=3, start_salary=12, draft_completed=False
    )
    # Still final-year rookies until tick activates the queue.
    assert one_yr["contract"]["years_remaining"] == 1
    assert one_yr["contract"]["contract_type"] == "rookie"
    assert three_yr["contract"]["pending_extension"]["years"] == 3

    summary = advance_roster_contracts_for_draft_complete(rules, [one_yr, three_yr])
    assert summary["extensions_activated"] == 2
    assert summary["expired"] == 0
    u1 = next(u for u in summary["updates"] if u["player_id"] == "ext-1")
    u3 = next(u for u in summary["updates"] if u["player_id"] == "ext-3")
    assert u1["extension_activated"] is True
    assert u1["contract"]["years_remaining"] == 1
    assert u1["contract"]["contract_type"] == "extension"
    assert "pending_extension" not in u1["contract"]
    assert u3["contract"]["years_remaining"] == 3
    assert [y["salary"] for y in u3["contract"]["schedule"]] == [17, 22, 27]


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
