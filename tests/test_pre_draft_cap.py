"""Pre-draft cap planning tests."""

from src.draft_hub.contracts import build_rookie_contract, can_renew, renew_player_contract
from src.draft_hub.pre_draft_cap import (
    ROSTER_CUT_BEFORE_DRAFT,
    cap_summary_for_phase,
    pre_draft_cap_summary,
    pre_draft_cut_dead_cap_at_offset,
    retained_through_draft,
)
from src.draft_hub.presets import load_preset
from src.draft_hub.rules_engine import multi_year_cap_plan
from src.draft_hub.schemas import LeagueRules


def _row(pid: str, salary: float, years: int = 1, status: str = "active", *, contract_type: str = "veteran") -> dict:
    if contract_type == "rookie":
        contract = build_rookie_contract(salary, max(years, 2))
        contract["years_remaining"] = years
        contract["schedule"] = [{"year_offset": i, "salary": salary} for i in range(years)]
    else:
        contract = {
            "contract_type": contract_type,
            "years_remaining": years,
            "current_salary": salary,
            "renewal_used": contract_type == "extension",
            "schedule": [{"year_offset": i, "salary": salary} for i in range(years)],
        }
    if status == ROSTER_CUT_BEFORE_DRAFT:
        contract["cut_dead_cap_years"] = years
    return {
        "player_id": pid,
        "player_name": pid,
        "position": "WR",
        "salary": salary,
        "contract_years": years,
        "roster_status": status,
        "contract": contract,
    }


def test_pre_draft_excludes_cuts_from_committed():
    rules = LeagueRules(salary_cap=200)
    roster = [
        _row("a", 50, 2),
        _row("b", 30, 1, ROSTER_CUT_BEFORE_DRAFT),
    ]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert summary is not None
    assert summary["season_committed"] == 50
    assert summary["dead_cap"] == 15
    assert summary["draft_budget_available"] == 135
    assert len(summary["pending_cuts"]) == 1
    assert summary["pending_cuts"][0]["player_id"] == "b"
    assert summary["pending_cuts"][0]["cap_freed"] == 15


def test_pre_draft_cut_one_year_still_incurs_pct_dead_cap():
    rules = LeagueRules(salary_cap=200, contracts={"cut_refund_pct": 0.5})
    roster = [_row("b", 80, 1, ROSTER_CUT_BEFORE_DRAFT)]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert summary["dead_cap"] == 40
    assert summary["pending_cuts"][0]["cap_freed"] == 40
    assert summary["pending_cuts"][0]["dead_cap_years"] == 1


def test_pre_draft_cut_multi_year_incurs_pct_dead_cap():
    rules = LeagueRules(salary_cap=200, contracts={"cut_refund_pct": 0.5})
    roster = [
        _row("a", 50, 2),
        _row("b", 80, 2, ROSTER_CUT_BEFORE_DRAFT),
    ]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert summary["season_committed"] == 50
    assert summary["dead_cap"] == 40
    assert summary["draft_budget_available"] == 110
    assert summary["pending_cuts"][0]["dead_cap"] == 40
    assert summary["pending_cuts"][0]["cap_freed"] == 40
    assert summary["pending_cuts"][0]["dead_cap_years"] == 2


def test_pre_draft_cut_dead_cap_persists_in_multi_year_plan():
    rules = LeagueRules(salary_cap=200, contracts={"cut_refund_pct": 0.5})
    roster = [_row("b", 80, 3, ROSTER_CUT_BEFORE_DRAFT)]
    plan = multi_year_cap_plan(rules, roster, seasons_ahead=3, draft_completed=False)
    assert len(plan) == 3
    assert plan[0]["dead_cap"] == 40
    assert plan[1]["dead_cap"] == 40
    assert plan[2]["dead_cap"] == 40
    assert pre_draft_cut_dead_cap_at_offset(rules, roster[0], 2) == 40
    assert pre_draft_cut_dead_cap_at_offset(rules, roster[0], 3) == 0


def test_expiring_veteran_drops_before_draft_and_frees_cap():
    rules = LeagueRules(salary_cap=200)
    roster = [
        _row("kept", 50, 2),
        _row("gone", 40, 1, contract_type="veteran"),
    ]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert summary["season_committed"] == 50
    assert summary["draft_budget_available"] == 150
    assert len(summary["dropping_at_draft"]) == 1
    assert summary["dropping_at_draft"][0]["player_id"] == "gone"
    assert summary["must_extend"] == []
    assert not retained_through_draft(roster[1], draft_completed=False)

    phase = cap_summary_for_phase(rules, roster, draft_completed=False)
    assert phase["spent"] == 50
    assert phase["roster_size"] == 1


def test_expiring_rookie_must_extend_not_in_committed():
    rules = LeagueRules(salary_cap=200)
    roster = [_row("rook", 10, 1, contract_type="rookie")]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert summary["season_committed"] == 0
    assert len(summary["must_extend"]) == 1
    assert summary["must_extend"][0]["can_extend"] is True
    assert summary["dropping_at_draft"] == []
    ok, _ = can_renew(roster[0], rules)
    assert ok


def test_extension_cannot_renew_at_expiry():
    rules = LeagueRules(salary_cap=200)
    roster = [_row("ext", 25, 1, contract_type="extension")]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert len(summary["dropping_at_draft"]) == 1
    ok, msg = can_renew(roster[0], rules)
    assert not ok
    assert "free agent" in msg.lower() or "extension" in msg.lower()


def test_rookie_mid_deal_not_yet_extendable():
    rules = load_preset("salary_cap_auction_v1")
    row = _row("rook", 10, 2, contract_type="rookie")
    ok, msg = can_renew(row, rules)
    assert not ok
    assert "final year" in msg.lower()
    assert retained_through_draft(row, draft_completed=False)


def test_rookie_final_year_can_extend():
    rules = load_preset("salary_cap_auction_v1")
    row = {
        "player_id": "00-0000001",
        "player_name": "Fernando Mendoza",
        "salary": 10,
        "contract_years": 1,
        "contract": {
            **build_rookie_contract(10, 2),
            "years_remaining": 1,
            "schedule": [{"year_offset": 0, "salary": 10}],
        },
    }
    ext = renew_player_contract(row, rules, extension_years=3, start_salary=10)
    salaries = [y["salary"] for y in ext["schedule"]]
    assert salaries == [15, 20, 25]


def test_draft_acquired_one_year_still_retained():
    rules = LeagueRules(salary_cap=200)
    row = _row("newbie", 12, 1, contract_type="veteran")
    row["source"] = "draft"
    assert retained_through_draft(row, draft_completed=False)
    summary = pre_draft_cap_summary(rules, [row], draft_completed=False)
    assert summary["season_committed"] == 12
    assert summary["dropping_at_draft"] == []
    assert summary["must_extend"] == []


def test_no_pre_draft_when_draft_completed():
    rules = LeagueRules(salary_cap=200)
    roster = [_row("a", 50, 1, ROSTER_CUT_BEFORE_DRAFT)]
    assert pre_draft_cap_summary(rules, roster, draft_completed=True) is None


def test_cap_summary_for_phase_respects_cuts():
    rules = LeagueRules(salary_cap=200, contracts={"cut_refund_pct": 0.5})
    roster = [_row("a", 60, 2), _row("b", 40, 2, ROSTER_CUT_BEFORE_DRAFT)]
    summary = cap_summary_for_phase(rules, roster, draft_completed=False)
    assert summary["spent"] == 60
    assert summary["dead_cap"] == 20
    assert summary["remaining"] == 120
