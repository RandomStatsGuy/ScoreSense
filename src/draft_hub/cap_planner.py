"""Read-only Cap planning payloads, using the canonical contract/cap model."""
from copy import deepcopy
from src.draft_hub.contracts import cap_hit, build_extension_contract, can_renew
from src.draft_hub.pre_draft_cap import cap_summary_for_phase, pre_draft_cap_summary, roster_status
from src.draft_hub.rules_engine import multi_year_cap_plan, cap_relevant_roster


def cap_planner_data(rules, roster, *, draft_completed=False):
    scoped = cap_relevant_roster(rules, roster)
    horizon = max(3, max((int((r.get("contract") or {}).get("years_remaining") or r.get("contract_years") or 1) for r in scoped), default=1) + int(rules.contracts.max_years))
    plan = multi_year_cap_plan(rules, scoped, seasons_ahead=horizon, draft_completed=draft_completed)
    rows = []
    for original in scoped:
        row = deepcopy(original)
        row_plan = multi_year_cap_plan(rules, [original], seasons_ahead=horizon, draft_completed=draft_completed)
        hits = [float(y["total_committed"]) for y in row_plan]
        active = roster_status(row) == "active"
        if not active and not any(hits):
            continue
        years = int((row.get("contract") or {}).get("years_remaining") or row.get("contract_years") or 1)
        start = 0 if not draft_completed and years <= 1 else years
        projected = deepcopy(row)
        projected["contract"] = {**(projected.get("contract") or {}), "years_remaining": 1}
        allowed, _ = can_renew(projected, rules)
        row["cap_hits"] = hits
        row["is_active"] = active
        row["extension_start_offset"] = start
        row["extension_eligible_offset"] = max(0, start - 1)
        row["extension_terms"] = []
        if allowed and active:
            last = cap_hit(original, max(0, years - 1))
            for n in range(1, int(rules.contracts.max_years) + 1):
                ext = build_extension_contract(rules, start_salary=last + float(rules.contracts.extension_step_up), years=n)
                row["extension_terms"].append({"years": n, "start_offset": start, "salaries": [cap_hit({"contract": ext}, i) for i in range(n)]})
        rows.append(row)
    return {"summary": cap_summary_for_phase(rules, scoped, draft_completed=draft_completed),
            "multi_year_plan": plan, "pre_draft": pre_draft_cap_summary(rules, scoped, draft_completed=draft_completed), "planning_rows": rows}
