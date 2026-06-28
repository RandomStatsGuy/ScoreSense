"""Pre-draft cap planning tests."""

from src.draft_hub.pre_draft_cap import (
    ROSTER_CUT_BEFORE_DRAFT,
    cap_summary_for_phase,
    pre_draft_cap_summary,
    pre_draft_cut_dead_cap_at_offset,
)
from src.draft_hub.rules_engine import multi_year_cap_plan
from src.draft_hub.schemas import LeagueRules


def _row(pid: str, salary: float, years: int = 1, status: str = "active") -> dict:
    contract = {
        "years_remaining": years,
        "current_salary": salary,
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


def test_expiring_after_draft_one_year_left():
    rules = LeagueRules(salary_cap=200)
    roster = [_row("x", 40, 1)]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert len(summary["expiring_after_draft"]) == 1
    assert summary["after_draft_projection"]["committed"] == 0


def test_no_pre_draft_when_draft_completed():
    rules = LeagueRules(salary_cap=200)
    roster = [_row("a", 50, 1, ROSTER_CUT_BEFORE_DRAFT)]
    assert pre_draft_cap_summary(rules, roster, draft_completed=True) is None


def test_cap_summary_for_phase_respects_cuts():
    rules = LeagueRules(salary_cap=200, contracts={"cut_refund_pct": 0.5})
    roster = [_row("a", 60), _row("b", 40, 2, ROSTER_CUT_BEFORE_DRAFT)]
    pre = cap_summary_for_phase(rules, roster, draft_completed=False)
    post = cap_summary_for_phase(rules, roster, draft_completed=True)
    assert pre["spent"] == 60
    assert pre["dead_cap"] == 20
    assert pre["remaining"] == 120
    assert post["spent"] == 100
