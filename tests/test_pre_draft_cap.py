"""Pre-draft cap planning tests."""

from src.draft_hub.contracts import build_rookie_contract, can_renew, renew_player_contract
from src.draft_hub.pre_draft_cap import (
    ROSTER_CUT_BEFORE_DRAFT,
    ROSTER_EXPIRED,
    cap_summary_for_phase,
    expires_before_draft,
    pre_draft_cap_summary,
    pre_draft_cut_dead_cap_at_offset,
    retained_through_draft,
    years_remaining,
)
from src.draft_hub.presets import load_preset
from src.draft_hub.roster_overview_enrich import enrich_league_roster_overview
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


def test_pre_draft_cut_dead_cap_floors_odd_salaries():
    rules = LeagueRules(salary_cap=200, contracts={"cut_refund_pct": 0.5})
    dollar = pre_draft_cap_summary(rules, [_row("cheap", 1, 1, ROSTER_CUT_BEFORE_DRAFT)])
    assert dollar["dead_cap"] == 0
    assert dollar["pending_cuts"][0]["cap_freed"] == 1
    seven = pre_draft_cap_summary(rules, [_row("odd", 7, 1, ROSTER_CUT_BEFORE_DRAFT)])
    assert seven["dead_cap"] == 3
    assert seven["pending_cuts"][0]["cap_freed"] == 4


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
    assert summary["pending_cuts"][0]["dead_cap_years"] == 1


def test_cut_dead_cap_hits_only_the_cut_season():
    rules = LeagueRules(salary_cap=200, contracts={"cut_refund_pct": 0.5})
    roster = [_row("b", 80, 3, ROSTER_CUT_BEFORE_DRAFT)]
    plan = multi_year_cap_plan(rules, roster, seasons_ahead=3, draft_completed=False)
    assert len(plan) == 3
    assert plan[0]["dead_cap"] == 40
    assert plan[1].get("dead_cap", 0) == 0
    assert plan[2].get("dead_cap", 0) == 0
    assert pre_draft_cut_dead_cap_at_offset(rules, roster[0], 0) == 40
    assert pre_draft_cut_dead_cap_at_offset(rules, roster[0], 1) == 0
    assert pre_draft_cut_dead_cap_at_offset(rules, roster[0], 2) == 0


def test_after_draft_cut_occupies_this_season_dead_not_salary():
    rules = LeagueRules(salary_cap=200, contracts={"cut_refund_pct": 0.5})
    roster = [
        _row("kept", 50, 2),
        _row("cut", 80, 3, ROSTER_CUT_BEFORE_DRAFT),
    ]
    summary = cap_summary_for_phase(rules, roster, draft_completed=True)
    assert summary["spent"] == 50
    assert summary["dead_cap"] == 40
    assert summary["remaining"] == 110
    plan = multi_year_cap_plan(rules, roster, seasons_ahead=3, draft_completed=True)
    assert plan[0]["dead_cap"] == 40
    assert plan[1].get("dead_cap", 0) == 0


def test_fa_contract_always_expires_before_draft():
    """$1 FA contracts leave before draft even with years_remaining > 1 on the row."""
    row = _row("fac", 1, 2)
    row["acquisition_type"] = "fa_contract"
    assert expires_before_draft(row, draft_completed=False) is True
    assert retained_through_draft(row, draft_completed=False) is False
    summary = pre_draft_cap_summary(LeagueRules(salary_cap=200), [row], draft_completed=False)
    assert summary["season_committed"] == 0
    assert any(p["player_id"] == "fac" for p in summary["dropping_at_draft"])


def test_expiring_veteran_must_extend_and_does_not_occupy_leftover():
    rules = LeagueRules(salary_cap=200)
    roster = [
        _row("kept", 50, 2),
        _row("gone", 40, 1, contract_type="veteran"),
    ]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert summary["season_committed"] == 50
    assert summary["draft_budget_available"] == 150
    assert len(summary["must_extend"]) == 1
    assert summary["must_extend"][0]["player_id"] == "gone"
    assert summary["dropping_at_draft"] == []
    assert not retained_through_draft(roster[1], draft_completed=False)


def test_expiring_veteran_drops_when_extensions_are_off():
    rules = LeagueRules(
        salary_cap=200,
        contracts=LeagueRules().contracts.model_copy(update={"allow_veteran_renewal": False}),
    )
    roster = [
        _row("kept", 50, 2),
        _row("gone", 40, 1, contract_type="veteran"),
    ]
    summary = pre_draft_cap_summary(rules, roster, draft_completed=False)
    assert len(summary["dropping_at_draft"]) == 1
    assert summary["dropping_at_draft"][0]["player_id"] == "gone"
    assert summary["must_extend"] == []

    phase = cap_summary_for_phase(rules, roster, draft_completed=False)
    assert phase["spent"] == 50
    assert summary["must_extend"] == []

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


def test_pending_extension_retained_not_must_extend():
    from src.draft_hub.contracts import apply_or_queue_extension

    rules = LeagueRules(salary_cap=200)
    row = _row("rook", 10, 1, contract_type="rookie")
    row["contract"] = apply_or_queue_extension(
        row, rules, extension_years=2, start_salary=10, draft_completed=False
    )
    assert retained_through_draft(row, draft_completed=False)
    assert expires_before_draft(row, draft_completed=False) is False
    summary = pre_draft_cap_summary(rules, [row], draft_completed=False)
    assert summary["must_extend"] == []
    assert summary["dropping_at_draft"] == []
    assert len(summary["queued_extensions"]) == 1
    assert summary["queued_extensions"][0]["player_id"] == "rook"
    assert summary["queued_extensions"][0]["queued_years"] == 2
    assert summary["season_committed"] == 10
    ok, msg = can_renew(row, rules)
    assert not ok
    assert "queued" in msg.lower()


def test_years_remaining_honors_explicit_zero():
    row = _row("gone", 16, 0)
    assert years_remaining(row) == 0
    assert retained_through_draft(row, draft_completed=True) is False
    archived = _row("arch", 35, 0, ROSTER_EXPIRED)
    assert years_remaining(archived) == 0
    assert retained_through_draft(archived, draft_completed=True) is False


def test_after_draft_leftover_matches_live_contracts():
    rules = LeagueRules(salary_cap=200)
    roster = [
        _row("kept", 50, 2),
        _row("auction", 74, 1),
        _row("expiree", 35, 0, ROSTER_EXPIRED),
        _row("ticked", 16, 0),
    ]
    roster[1]["source"] = "draft"
    summary = cap_summary_for_phase(rules, roster, draft_completed=True)
    assert summary["spent"] == 124
    assert summary["remaining"] == 76
    overview = {
        "salary_cap": 200,
        "league": {
            "id": "after-draft-leftover",
            "season": 2026,
            "draft_completed": True,
            "rules": rules.model_dump(),
        },
        "teams": [{"team": {"id": "t1", "name": "Alpha"}, "roster": roster}],
    }
    stats = enrich_league_roster_overview(overview, fair_map={})["teams"][0]["stats"]
    assert stats["committed"] == 124
    assert stats["unspent"] == 76


def test_no_pre_draft_when_draft_completed():
    rules = LeagueRules(salary_cap=200)
    roster = [_row("a", 50, 1, ROSTER_CUT_BEFORE_DRAFT)]
    assert pre_draft_cap_summary(rules, roster, draft_completed=True) is None


def test_roster_overview_committed_is_auction_leftover():
    rules = LeagueRules(salary_cap=200)
    overview = {
        "salary_cap": 200,
        "league": {
            "id": "overview-leftover",
            "season": 2026,
            "draft_completed": False,
            "rules": rules.model_dump(),
        },
        "teams": [
            {
                "team": {"id": "t1", "name": "Alpha"},
                "roster": [
                    _row("kept", 50, 2),
                    _row("gone", 40, 1, contract_type="veteran"),
                ],
            }
        ],
    }
    out = enrich_league_roster_overview(overview, fair_map={})
    stats = out["teams"][0]["stats"]
    assert stats["committed"] == 50
    assert stats["unspent"] == 150


def test_cap_summary_for_phase_respects_cuts():
    rules = LeagueRules(salary_cap=200, contracts={"cut_refund_pct": 0.5})
    roster = [_row("a", 60, 2), _row("b", 40, 2, ROSTER_CUT_BEFORE_DRAFT)]
    summary = cap_summary_for_phase(rules, roster, draft_completed=False)
    assert summary["spent"] == 60
    assert summary["dead_cap"] == 20
    assert summary["remaining"] == 120
