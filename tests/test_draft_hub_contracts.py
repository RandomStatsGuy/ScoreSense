"""Contract step-up and renewal tests."""

from src.draft_hub.contracts import (
    build_extension_contract,
    build_rookie_contract,
    renew_player_contract,
)
from src.draft_hub.presets import load_preset


def test_rookie_contract_flat_years():
    c = build_rookie_contract(10, 2)
    assert c["schedule"][0]["salary"] == 10
    assert c["schedule"][1]["salary"] == 10


def test_roster_edit_rookie_stays_flat_extension_steps():
    from src.draft_hub.contracts import build_contract_from_roster_edit

    rules = load_preset("salary_cap_auction_v1")
    rook = build_contract_from_roster_edit(
        rules, current_salary=10, years_remaining=2, contract_type="rookie", step_up=5
    )
    assert [y["salary"] for y in rook["schedule"]] == [10, 10]
    assert float(rook.get("step_up_per_year") or 0) == 0

    vet = build_contract_from_roster_edit(
        rules, current_salary=12, years_remaining=2, contract_type="veteran", step_up=5
    )
    assert [y["salary"] for y in vet["schedule"]] == [12, 12]

    ext = build_contract_from_roster_edit(
        rules, current_salary=15, years_remaining=3, contract_type="extension"
    )
    assert [y["salary"] for y in ext["schedule"]] == [15, 20, 25]


def test_mendoza_extension_step_up():
    rules = load_preset("salary_cap_auction_v1")
    contract = build_rookie_contract(10, 2)
    contract["years_remaining"] = 1
    contract["schedule"] = [{"year_offset": 0, "salary": 10}]
    row = {
        "player_id": "00-0000001",
        "player_name": "Fernando Mendoza",
        "salary": 10,
        "contract_years": 1,
        "contract": contract,
    }
    ext = renew_player_contract(row, rules, extension_years=3, start_salary=10)
    salaries = [y["salary"] for y in ext["schedule"]]
    assert salaries == [15, 20, 25]


def test_extension_build():
    rules = load_preset("salary_cap_auction_v1")
    c = build_extension_contract(rules, start_salary=15, years=3)
    assert [y["salary"] for y in c["schedule"]] == [15, 20, 25]
