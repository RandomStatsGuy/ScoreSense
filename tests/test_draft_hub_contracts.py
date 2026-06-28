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


def test_mendoza_extension_step_up():
    rules = load_preset("salary_cap_auction_v1")
    row = {
        "player_id": "00-0000001",
        "player_name": "Fernando Mendoza",
        "salary": 10,
        "contract": build_rookie_contract(10, 2),
    }
    ext = renew_player_contract(row, rules, extension_years=3, start_salary=10)
    salaries = [y["salary"] for y in ext["schedule"]]
    assert salaries == [15, 20, 25]


def test_extension_build():
    rules = load_preset("salary_cap_auction_v1")
    c = build_extension_contract(rules, start_salary=15, years=3)
    assert [y["salary"] for y in c["schedule"]] == [15, 20, 25]
