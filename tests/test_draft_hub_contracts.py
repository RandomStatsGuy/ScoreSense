"""Contract step-up and renewal tests."""

from src.draft_hub.contracts import (
    apply_rookie_extension_command,
    auction_win_is_rookie,
    build_auction_win_contract,
    build_extension_contract,
    build_rookie_contract,
    can_renew,
    renew_player_contract,
)
from src.draft_hub.presets import load_preset


def test_auction_win_contracts_rookie_flat_vet_steps():
    rules = load_preset("salary_cap_auction_v1")
    rook = build_auction_win_contract(rules, 39, is_rookie=True)
    assert rook["contract_type"] == "rookie"
    assert rook["years_remaining"] == 2
    assert [y["salary"] for y in rook["schedule"]] == [39, 39]
    assert float(rook.get("step_up_per_year") or 0) == 0

    vet = build_auction_win_contract(rules, 39, is_rookie=False)
    assert vet["contract_type"] == "veteran"
    assert vet["years_remaining"] == 2
    assert [y["salary"] for y in vet["schedule"]] == [39, 44]
    assert float(vet.get("step_up_per_year") or 0) == 5


def test_auction_win_contracts_follow_commissioner_term_and_rookie_salary_rules():
    rules = load_preset("salary_cap_auction_v1")
    rules = rules.model_copy(update={
        "contracts": rules.contracts.model_copy(update={
            "max_years": 4,
            "rookie_years": 3,
            "veteran_years": 4,
            "rookie_salary_static": False,
            "extension_step_up": 3,
        }),
    })

    rook = build_auction_win_contract(rules, 10, is_rookie=True)
    assert rook["years_remaining"] == 3
    assert rook["rookie_salary_static"] is False
    assert [year["salary"] for year in rook["schedule"]] == [10, 13, 16]

    vet = build_auction_win_contract(rules, 10, is_rookie=False)
    assert vet["years_remaining"] == 4
    assert [year["salary"] for year in vet["schedule"]] == [10, 13, 16, 19]


def test_contract_renewal_permissions_follow_league_rules():
    rules = load_preset("salary_cap_auction_v1")
    rookie = {
        "contract": {
            **build_rookie_contract(10, 1),
            "years_remaining": 1,
        },
    }
    veteran = {
        "contract": {
            "contract_type": "veteran",
            "current_salary": 10,
            "years_remaining": 1,
            "renewal_used": False,
        },
    }

    disabled_rookie_rules = rules.model_copy(update={
        "contracts": rules.contracts.model_copy(update={"one_renewal_after_rookie": False}),
    })
    assert can_renew(rookie, disabled_rookie_rules) == (
        False,
        "Rookie extensions are disabled by league rules.",
    )

    veteran_rules = rules.model_copy(update={
        "contracts": rules.contracts.model_copy(update={"allow_veteran_renewal": True}),
    })
    assert can_renew(veteran, veteran_rules)[0] is True


def test_manager_can_queue_veteran_extension_when_league_allows_it():
    rules = load_preset("salary_cap_auction_v1")
    rules = rules.model_copy(update={
        "contracts": rules.contracts.model_copy(update={"allow_veteran_renewal": True}),
    })
    veteran = {
        "salary": 10,
        "contract": {
            "contract_type": "veteran",
            "current_salary": 10,
            "years_remaining": 1,
            "renewal_used": False,
        },
    }

    queued, already_applied = apply_rookie_extension_command(
        veteran,
        rules,
        extension_years=2,
    )

    assert already_applied is False
    assert queued["pending_extension"]["years"] == 2
    assert queued["pending_extension"]["start_salary"] == 15


def test_auction_win_is_rookie_from_flag_and_years_exp():
    rules = load_preset("salary_cap_auction_v1")
    assert auction_win_is_rookie(rules, {"is_rookie": True}) is True
    assert auction_win_is_rookie(rules, {"is_rookie": False, "years_exp": 4}) is False
    assert auction_win_is_rookie(rules, {"years_exp": 0}) is True
    assert auction_win_is_rookie(rules, {"years_exp": 1}) is True
    assert auction_win_is_rookie(rules, {"years_exp": 2}) is False
    assert auction_win_is_rookie(rules, {"player_id": "unknown-vet"}) is False


def test_rookie_contract_flat_years():
    c = build_rookie_contract(10, 2)
    assert c["schedule"][0]["salary"] == 10
    assert c["schedule"][1]["salary"] == 10


def test_roster_edit_rookie_stays_flat_vet_and_extension_step():
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
    assert [y["salary"] for y in vet["schedule"]] == [12, 17]
    assert float(vet.get("step_up_per_year") or 0) == 5

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
