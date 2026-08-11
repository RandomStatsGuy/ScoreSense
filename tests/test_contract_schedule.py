"""Multi-year contract schedule and cap planning."""

import pytest

from src.draft_hub import storage
from src.draft_hub.contracts import build_contract_from_roster_edit, cap_hit, multi_year_cap_plan
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_build_contract_step_up_schedule():
    rules = load_preset("salary_cap_auction_v1")
    contract = build_contract_from_roster_edit(
        rules,
        current_salary=17,
        years_remaining=2,
        step_up=5,
        contract_type="extension",
    )
    assert contract["years_remaining"] == 2
    assert contract["schedule"][0]["salary"] == 17
    assert contract["schedule"][1]["salary"] == 22


def test_rookie_ignores_passed_step_up():
    """Salary PATCH historically passed league step_up for every type — rookies must stay flat."""
    rules = load_preset("salary_cap_auction_v1")
    contract = build_contract_from_roster_edit(
        rules,
        current_salary=1,
        years_remaining=2,
        step_up=5,
        contract_type="rookie",
    )
    assert [y["salary"] for y in contract["schedule"]] == [1, 1]
    assert float(contract.get("step_up_per_year") or 0) == 0


def test_cap_hit_zero_after_contract_expires():
    rules = load_preset("salary_cap_auction_v1")
    contract = build_contract_from_roster_edit(
        rules, current_salary=17, years_remaining=1, step_up=5, contract_type="extension"
    )
    row = {"salary": 17, "contract_years": 1, "contract": contract}
    assert cap_hit(row, 0) == 17
    assert cap_hit(row, 1) == 0


def test_multi_year_plan_uses_schedule():
    rules = load_preset("salary_cap_auction_v1")
    contract = build_contract_from_roster_edit(
        rules, current_salary=17, years_remaining=2, step_up=5, contract_type="extension"
    )
    roster = [{"player_name": "J. Williams", "player_id": "p1", "salary": 17, "contract_years": 2, "contract": contract}]
    plan = multi_year_cap_plan(rules, roster, seasons_ahead=3)
    assert plan[0]["total_committed"] == 17
    assert plan[1]["total_committed"] == 22
    assert plan[2]["total_committed"] == 0


def test_update_roster_slot_persists_contract(hub_db):
    from src.draft_hub.contracts import build_contract_from_roster_edit

    ws = storage.get_or_create_workspace("contract-user")
    rules = load_preset("salary_cap_auction_v1")
    contract = build_contract_from_roster_edit(
        rules, current_salary=12, years_remaining=3, step_up=5, contract_type="extension"
    )
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0037238",
            "player_name": "Test Player",
            "team": "DET",
            "position": "WR",
            "salary": contract["current_salary"],
            "contract_years": contract["years_remaining"],
            "contract": contract,
        },
    )
    updated_contract = build_contract_from_roster_edit(
        rules, current_salary=17, years_remaining=2, step_up=5, contract_type="extension"
    )
    slot = storage.update_roster_slot(ws["id"], "00-0037238", contract=updated_contract)
    assert slot["contract"]["schedule"][0]["salary"] == 17
    assert slot["contract"]["schedule"][1]["salary"] == 22
    assert slot["contract_years"] == 2


def test_repair_flat_deal_schedule_fixes_mistyped_rookie():
    from src.draft_hub.contracts import repair_flat_deal_schedule

    bad = {
        "contract_type": "rookie",
        "current_salary": 1,
        "years_remaining": 2,
        "step_up_per_year": 5,
        "schedule": [
            {"year_offset": 0, "salary": 1},
            {"year_offset": 1, "salary": 6},
        ],
    }
    fixed = repair_flat_deal_schedule(bad)
    assert [y["salary"] for y in fixed["schedule"]] == [1, 1]
    assert float(fixed.get("step_up_per_year") or 0) == 0


def test_repair_applies_step_to_flat_multi_year_veteran():
    from src.draft_hub.contracts import repair_flat_deal_schedule

    flat = {
        "contract_type": "veteran",
        "current_salary": 8,
        "years_remaining": 2,
        "step_up_per_year": 0,
        "schedule": [
            {"year_offset": 0, "salary": 8},
            {"year_offset": 1, "salary": 8},
        ],
    }
    fixed = repair_flat_deal_schedule(flat)
    assert [y["salary"] for y in fixed["schedule"]] == [8, 13]
    assert float(fixed.get("step_up_per_year") or 0) == 5
