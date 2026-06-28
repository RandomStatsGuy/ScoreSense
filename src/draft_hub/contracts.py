"""Multi-year contracts with step-ups, rookie deals, and one-time renewals."""

from __future__ import annotations

from typing import Any

from src.draft_hub.schemas import ContractRules, LeagueRules


def _valid_gsis(player_id: str) -> bool:
    pid = str(player_id or "").strip()
    return pid.startswith("00-") and len(pid) >= 6


def contract_rules(rules: LeagueRules) -> ContractRules:
    return rules.contracts


def build_rookie_contract(base_salary: float, years: int = 2) -> dict[str, Any]:
    yrs = max(1, min(years, 2))
    schedule = [{"year_offset": i, "salary": round(float(base_salary), 2)} for i in range(yrs)]
    return {
        "contract_type": "rookie",
        "base_salary": round(float(base_salary), 2),
        "years_total": yrs,
        "years_remaining": yrs,
        "renewal_used": False,
        "schedule": schedule,
        "current_salary": round(float(base_salary), 2),
    }


def build_extension_contract(
    rules: LeagueRules,
    *,
    start_salary: float,
    years: int,
    step_up: float | None = None,
) -> dict[str, Any]:
    cr = contract_rules(rules)
    yrs = max(1, min(int(years), int(cr.max_years)))
    step = float(step_up if step_up is not None else cr.extension_step_up)
    base = round(float(start_salary), 2)
    schedule = [{"year_offset": i, "salary": round(base + step * i, 2)} for i in range(yrs)]
    return {
        "contract_type": "extension",
        "base_salary": base,
        "years_total": yrs,
        "years_remaining": yrs,
        "renewal_used": True,
        "step_up_per_year": step,
        "schedule": schedule,
        "current_salary": schedule[0]["salary"],
    }


def build_veteran_contract(base_salary: float, years: int = 1) -> dict[str, Any]:
    yrs = max(1, years)
    sal = round(float(base_salary), 2)
    schedule = [{"year_offset": i, "salary": sal} for i in range(yrs)]
    return {
        "contract_type": "veteran",
        "base_salary": sal,
        "years_total": yrs,
        "years_remaining": yrs,
        "renewal_used": False,
        "schedule": schedule,
        "current_salary": sal,
    }


def salary_for_year(contract: dict[str, Any] | None, year_offset: int = 0) -> float:
    if not contract:
        return 0.0
    schedule = contract.get("schedule") or []
    for row in schedule:
        if int(row.get("year_offset", -1)) == year_offset:
            return float(row.get("salary") or 0)
    if year_offset == 0:
        return float(contract.get("current_salary") or contract.get("base_salary") or 0)
    return 0.0


def cap_hit(row: dict[str, Any], year_offset: int = 0) -> float:
    contract = row.get("contract")
    if contract:
        yrs_rem = int(contract.get("years_remaining") or 0)
        if yrs_rem > 0 and year_offset >= yrs_rem:
            return 0.0
        hit = salary_for_year(contract, year_offset)
        if hit > 0:
            return hit
        if year_offset == 0:
            return float(contract.get("current_salary") or contract.get("base_salary") or row.get("salary") or 0)
        return 0.0
    yrs = int(row.get("contract_years") or 1)
    if year_offset >= yrs:
        return 0.0
    return float(row.get("salary") or 0)


def schedule_preview(contract: dict[str, Any] | None) -> list[float]:
    if not contract:
        return []
    schedule = contract.get("schedule") or []
    yrs = int(contract.get("years_remaining") or len(schedule) or 0)
    out: list[float] = []
    for i in range(yrs):
        sal = salary_for_year(contract, i)
        if sal > 0:
            out.append(round(sal, 2))
    return out


def build_contract_from_roster_edit(
    rules: LeagueRules,
    *,
    current_salary: float,
    years_remaining: int,
    existing: dict[str, Any] | None = None,
    step_up: float | None = None,
    salary_schedule: list[float] | None = None,
    contract_type: str | None = None,
) -> dict[str, Any]:
    """Build or refresh contract_json from cap hit + years remaining."""
    cr = contract_rules(rules)
    yrs = max(1, min(int(years_remaining), int(cr.max_years)))
    base = round(float(current_salary), 2)
    prior = existing or {}
    ctype = contract_type or prior.get("contract_type") or "veteran"

    if salary_schedule:
        amounts = [round(float(s), 2) for s in salary_schedule if s is not None][:yrs]
        if not amounts:
            amounts = [base]
        while len(amounts) < yrs:
            step = float(step_up if step_up is not None else cr.extension_step_up)
            amounts.append(round(amounts[-1] + step, 2))
    elif prior.get("schedule") and int(prior.get("years_remaining") or 0) == yrs:
        amounts = schedule_preview(prior)[:yrs]
        if amounts and amounts[0] != base:
            amounts[0] = base
    else:
        step = float(step_up if step_up is not None else cr.extension_step_up)
        if ctype == "extension" or step > 0:
            amounts = [round(base + step * i, 2) for i in range(yrs)]
        else:
            amounts = [base for _ in range(yrs)]

    schedule = [{"year_offset": i, "salary": amounts[i]} for i in range(len(amounts))]
    years_total = int(prior.get("years_total") or max(yrs, len(amounts)))
    return {
        "contract_type": ctype,
        "base_salary": base,
        "years_total": years_total,
        "years_remaining": yrs,
        "renewal_used": bool(prior.get("renewal_used")),
        "step_up_per_year": float(step_up if step_up is not None else cr.extension_step_up),
        "schedule": schedule,
        "current_salary": schedule[0]["salary"],
    }


def can_renew(row: dict[str, Any], rules: LeagueRules) -> tuple[bool, str]:
    contract = row.get("contract") or {}
    ctype = contract.get("contract_type") or "veteran"
    if contract.get("renewal_used"):
        return False, "Renewal already used — player becomes a free agent after this deal."
    cr = contract_rules(rules)
    if ctype == "rookie":
        return True, "Eligible for one post-rookie extension."
    if ctype == "extension":
        return False, "Already on an extension."
    if cr.allow_veteran_renewal:
        return True, "Eligible for renewal."
    return False, "Veteran renewals disabled in league rules."


def renew_player_contract(
    row: dict[str, Any],
    rules: LeagueRules,
    *,
    extension_years: int,
    start_salary: float | None = None,
) -> dict[str, Any]:
    ok, msg = can_renew(row, rules)
    if not ok:
        raise ValueError(msg)
    contract = row.get("contract") or build_veteran_contract(row.get("salary") or 1, 1)
    cr = contract_rules(rules)
    base = float(start_salary if start_salary is not None else contract.get("current_salary") or row.get("salary") or 1)
    if contract.get("contract_type") == "rookie":
        # Mendoza example: $10 rookie -> extension starts at base + step (default +5) each year
        ext_base = base + float(cr.extension_step_up)
    else:
        ext_base = base + float(cr.extension_step_up)
    new_contract = build_extension_contract(rules, start_salary=ext_base, years=extension_years)
    return new_contract


def swap_contracts(row_a: dict[str, Any], row_b: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Trade helper — swap contract payloads between two roster rows."""
    a = dict(row_a)
    b = dict(row_b)
    a["contract"], b["contract"] = b.get("contract"), a.get("contract")
    a["salary"] = cap_hit(a, 0)
    b["salary"] = cap_hit(b, 0)
    a["contract_years"] = int((a.get("contract") or {}).get("years_remaining") or a.get("contract_years") or 1)
    b["contract_years"] = int((b.get("contract") or {}).get("years_remaining") or b.get("contract_years") or 1)
    return a, b


def multi_year_cap_plan(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    seasons_ahead: int = 4,
) -> list[dict[str, Any]]:
    cap = float(rules.salary_cap)
    plan: list[dict[str, Any]] = []
    for offset in range(seasons_ahead):
        hits = []
        total = 0.0
        for row in roster:
            sal = cap_hit(row, offset)
            if sal <= 0:
                continue
            hits.append({"player": row.get("player_name"), "salary": sal, "player_id": row.get("player_id")})
            total += sal
        plan.append(
            {
                "season_offset": offset,
                "label": "Current" if offset == 0 else f"Y+{offset}",
                "cap_hits": hits,
                "total_committed": round(total, 2),
                "cap_remaining": round(cap - total, 2),
            }
        )
    return plan


def roster_row_from_import(
    *,
    player_id: str,
    player_name: str,
    team: str,
    position: str,
    salary: float,
    contract_type: str = "veteran",
    years: int = 1,
    step_up: float | None = None,
    rules: LeagueRules | None = None,
) -> dict[str, Any]:
    if not _valid_gsis(player_id):
        raise ValueError(f"Invalid player id for {player_name}: {player_id}")
    rules = rules or LeagueRules()
    if contract_type == "rookie":
        contract = build_rookie_contract(salary, years)
    elif contract_type == "extension":
        contract = build_extension_contract(rules, start_salary=salary, years=years, step_up=step_up)
    else:
        contract = build_veteran_contract(salary, years)
    return {
        "player_id": player_id,
        "player_name": player_name,
        "team": team,
        "position": position,
        "salary": contract["current_salary"],
        "contract_years": contract["years_remaining"],
        "contract": contract,
    }
