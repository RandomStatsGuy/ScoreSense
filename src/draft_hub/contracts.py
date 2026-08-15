"""Multi-year contracts with step-ups, rookie deals, and one-time renewals."""

from __future__ import annotations

from typing import Any

from src.draft_hub.schemas import ContractRules, LeagueRules

PENDING_EXTENSION_KEY = "pending_extension"


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


def build_veteran_contract(
    base_salary: float,
    years: int = 1,
    *,
    step_up: float = 0.0,
) -> dict[str, Any]:
    """Multi-year veteran deals step by ``step_up`` each year (league default $5)."""
    yrs = max(1, years)
    sal = round(float(base_salary), 2)
    step = float(step_up or 0)
    if step and yrs > 1:
        schedule = [{"year_offset": i, "salary": round(sal + step * i, 2)} for i in range(yrs)]
    else:
        schedule = [{"year_offset": i, "salary": sal} for i in range(yrs)]
    return {
        "contract_type": "veteran",
        "base_salary": sal,
        "years_total": yrs,
        "years_remaining": yrs,
        "renewal_used": False,
        "step_up_per_year": step if yrs > 1 else 0.0,
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


def _schedule_step_for_type(
    ctype: str,
    *,
    step_up: float | None,
    cr: ContractRules,
) -> float:
    """Rookie deals are flat; veteran deals and rookie extensions step (+$5 by default).

    Callers often pass the league extension step for every edit — ignore it for rookies.
    """
    kind = str(ctype or "veteran")
    if kind == "rookie":
        return 0.0
    if kind not in ("extension", "veteran"):
        return 0.0
    if step_up is not None:
        return float(step_up)
    return float(cr.extension_step_up)


def repair_flat_deal_schedule(
    contract: dict[str, Any] | None,
    *,
    default_step: float = 5.0,
) -> dict[str, Any] | None:
    """Read-path schedule repair: flatten rookies; ensure multi-year vets/extensions step.

    ``default_step`` should be the league's ``extension_step_up`` when known.
    """
    if not contract:
        return contract
    ctype = str(contract.get("contract_type") or "veteran")
    yrs = int(contract.get("years_remaining") or 0)
    if yrs < 1:
        return contract
    base = float(contract.get("current_salary") or contract.get("base_salary") or 0)
    schedule = contract.get("schedule") or []
    league_step = float(default_step) if float(default_step or 0) > 0 else 5.0

    if ctype == "rookie":
        needs_repair = float(contract.get("step_up_per_year") or 0) != 0
        if not needs_repair:
            for i in range(yrs):
                sal = salary_for_year(contract, i)
                if sal > 0 and abs(sal - base) > 0.001:
                    needs_repair = True
                    break
                if i < len(schedule) and abs(float(schedule[i].get("salary") or 0) - base) > 0.001:
                    needs_repair = True
                    break
        if not needs_repair and len(schedule) >= yrs:
            return contract
        out = dict(contract)
        out["schedule"] = [{"year_offset": i, "salary": round(base, 2)} for i in range(yrs)]
        out["step_up_per_year"] = 0.0
        out["current_salary"] = round(base, 2)
        return out

    if ctype in ("veteran", "extension") and yrs > 1:
        actual: list[float] = []
        for i in range(yrs):
            sal = salary_for_year(contract, i)
            if sal <= 0 and i < len(schedule):
                sal = float(schedule[i].get("salary") or 0)
            actual.append(round(float(sal or 0), 2))
        # Preserve custom stepped schedules; only repair flat / short ones.
        is_flat = len(actual) >= yrs and all(abs(v - base) < 0.001 for v in actual[:yrs])
        incomplete = len(actual) < yrs or any(v <= 0 for v in actual[:yrs])
        stored_step = float(contract.get("step_up_per_year") or 0)
        if not is_flat and not incomplete:
            if stored_step > 0:
                return contract
            # Infer step from first YoY delta when metadata is missing.
            out = dict(contract)
            out["step_up_per_year"] = (
                round(actual[1] - actual[0], 2) if len(actual) > 1 else league_step
            )
            return out
        step = stored_step if stored_step > 0 else league_step
        expected = [round(base + step * i, 2) for i in range(yrs)]
        out = dict(contract)
        out["step_up_per_year"] = step
        out["schedule"] = [{"year_offset": i, "salary": expected[i]} for i in range(yrs)]
        out["current_salary"] = round(base, 2)
        return out
    return contract


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
    step = _schedule_step_for_type(str(ctype), step_up=step_up, cr=cr)

    if ctype == "rookie":
        # Rookie deals stay flat for the full term; +$5 only happens on extension.
        amounts = [base for _ in range(yrs)]
    elif salary_schedule:
        amounts = [round(float(s), 2) for s in salary_schedule if s is not None][:yrs]
        if not amounts:
            amounts = [base]
        while len(amounts) < yrs:
            amounts.append(round(amounts[-1] + step, 2) if step else amounts[-1])
    elif prior.get("schedule") and int(prior.get("years_remaining") or 0) == yrs and ctype == "extension":
        amounts = schedule_preview(prior)[:yrs]
        if amounts and amounts[0] != base:
            amounts[0] = base
        while len(amounts) < yrs:
            amounts.append(round(amounts[-1] + step, 2) if step else amounts[-1])
    else:
        if step:
            amounts = [round(base + step * i, 2) for i in range(yrs)]
        else:
            amounts = [base for _ in range(yrs)]

    schedule = [{"year_offset": i, "salary": amounts[i]} for i in range(len(amounts))]
    years_total = int(prior.get("years_total") or max(yrs, len(amounts)))
    out: dict[str, Any] = {
        "contract_type": ctype,
        "base_salary": base,
        "years_total": years_total,
        "years_remaining": yrs,
        "renewal_used": bool(prior.get("renewal_used")) or ctype == "extension",
        "step_up_per_year": step,
        "schedule": schedule,
        "current_salary": schedule[0]["salary"],
    }
    # Preserve typing / approval metadata across salary & years edits.
    for key in (
        "contract_type_manual",
        "inferred_from",
        "years_exp",
        "pending_type",
        "pending_type_by",
        "pending_type_at",
        PENDING_EXTENSION_KEY,
        "source",
    ):
        if key in prior and prior[key] is not None:
            out[key] = prior[key]
    return out


def has_pending_extension(contract_or_row: dict[str, Any] | None) -> bool:
    if not contract_or_row:
        return False
    contract = contract_or_row.get("contract") if "contract" in contract_or_row else contract_or_row
    if not isinstance(contract, dict):
        return False
    pending = contract.get(PENDING_EXTENSION_KEY)
    return isinstance(pending, dict) and bool(pending)


def can_renew(row: dict[str, Any], rules: LeagueRules) -> tuple[bool, str]:
    """One extension is allowed only at the end of a rookie deal (before draft)."""
    contract = row.get("contract") or {}
    ctype = contract.get("contract_type") or "veteran"
    yrs = int(contract.get("years_remaining") or row.get("contract_years") or 1)
    if yrs > 1:
        return False, "Extension only when the current deal is in its final year."
    if has_pending_extension(contract):
        return False, "Extension already queued — activates when draft is marked complete."
    if contract.get("renewal_used"):
        return False, "Renewal already used — player becomes a free agent."
    cr = contract_rules(rules)
    if ctype == "rookie":
        return True, "Eligible for one post-rookie extension (1–3 years)."
    if ctype == "extension":
        return False, "Already on an extension — expires to free agency."
    if cr.allow_veteran_renewal:
        return True, "Eligible for renewal."
    return False, "Veterans cannot be re-signed — expires to free agency."


def extension_window_open(*, draft_completed: bool) -> bool:
    """Managers may only queue rookie extensions before draft is marked complete."""
    return not bool(draft_completed)


def compute_rookie_extension_start_salary(row: dict[str, Any], rules: LeagueRules) -> float:
    """Server-calculated start: current salary + league extension step-up (default +$5)."""
    contract = row.get("contract") or {}
    cr = contract_rules(rules)
    current = float(contract.get("current_salary") or row.get("salary") or 1)
    return round(current + float(cr.extension_step_up), 2)


def can_manager_rookie_extend(
    row: dict[str, Any],
    rules: LeagueRules,
    *,
    draft_completed: bool = False,
) -> tuple[bool, str]:
    """Eligibility for the manager rookie-extension command (own-team checks are route-level)."""
    if not extension_window_open(draft_completed=draft_completed):
        return False, "Rookie extensions are only available before the draft is marked complete."
    contract = row.get("contract") or {}
    ctype = str(contract.get("contract_type") or "veteran")
    if ctype != "rookie":
        return False, "Only players on a rookie deal can use this extension."
    return can_renew(row, rules)


def _normalize_extension_years(rules: LeagueRules, extension_years: int) -> int:
    cr = contract_rules(rules)
    yrs = int(extension_years)
    max_yrs = int(cr.max_years)
    if yrs < 1 or yrs > max_yrs:
        raise ValueError(f"Extension years must be between 1 and {max_yrs}.")
    return yrs


def renew_player_contract(
    row: dict[str, Any],
    rules: LeagueRules,
    *,
    extension_years: int,
    start_salary: float | None = None,
) -> dict[str, Any]:
    """Build the extension terms (does not attach pending / does not tick).

    ``start_salary`` is ignored — start is always current + league step-up.
    """
    ok, msg = can_renew(row, rules)
    if not ok:
        raise ValueError(msg)
    _ = start_salary  # client-supplied salaries are never trusted
    years = _normalize_extension_years(rules, extension_years)
    ext_base = compute_rookie_extension_start_salary(row, rules)
    return build_extension_contract(rules, start_salary=ext_base, years=years)


def queue_pending_extension(
    row: dict[str, Any],
    rules: LeagueRules,
    *,
    extension_years: int,
    start_salary: float | None = None,
) -> dict[str, Any]:
    """Keep the active deal intact; store extension for activation after draft-complete tick."""
    extension = renew_player_contract(
        row, rules, extension_years=extension_years, start_salary=start_salary
    )
    existing = dict(row.get("contract") or {})
    existing[PENDING_EXTENSION_KEY] = {
        "years": int(extension.get("years_remaining") or extension_years),
        "start_salary": float(extension.get("current_salary") or extension.get("base_salary") or 0),
        "step_up_per_year": float(extension.get("step_up_per_year") or 0),
        "contract": extension,
    }
    return existing


def activate_pending_extension(
    contract: dict[str, Any] | None,
    rules: LeagueRules,
) -> dict[str, Any] | None:
    """Materialize a queued extension at full chosen duration (call after year tick)."""
    existing = dict(contract or {})
    pending = existing.get(PENDING_EXTENSION_KEY)
    if not isinstance(pending, dict):
        return None
    built = pending.get("contract")
    if isinstance(built, dict) and built.get("years_remaining") is not None:
        out = dict(built)
    else:
        years = int(pending.get("years") or 1)
        start = float(pending.get("start_salary") or existing.get("current_salary") or 1)
        step = pending.get("step_up_per_year")
        out = build_extension_contract(
            rules,
            start_salary=start,
            years=years,
            step_up=float(step) if step is not None else None,
        )
    out.pop(PENDING_EXTENSION_KEY, None)
    # Carry identity / provenance fields from the prior deal when present.
    for key in ("years_exp", "inferred_from", "source", "acquisition_type"):
        if key in existing and key not in out:
            out[key] = existing[key]
    return out


def apply_or_queue_extension(
    row: dict[str, Any],
    rules: LeagueRules,
    *,
    extension_years: int,
    start_salary: float | None = None,
    draft_completed: bool = False,
) -> dict[str, Any]:
    """Pre-draft: queue pending. Post-draft: apply extension terms immediately.

    Client ``start_salary`` is ignored; terms are always server-calculated.
    """
    if draft_completed:
        return renew_player_contract(
            row, rules, extension_years=extension_years, start_salary=None
        )
    return queue_pending_extension(
        row, rules, extension_years=extension_years, start_salary=None
    )


def apply_rookie_extension_command(
    row: dict[str, Any],
    rules: LeagueRules,
    *,
    extension_years: int,
    draft_completed: bool = False,
) -> tuple[dict[str, Any], bool]:
    """Idempotent manager rookie-extension: queue pending terms for post-draft activation.

    Returns ``(contract_json, already_applied)``. Re-submitting the same years is a no-op
    success. Outside the pre-draft window, non-rookies, final-year failures, or a conflicting
    queued duration raise ``ValueError``.
    """
    years = _normalize_extension_years(rules, extension_years)
    if not extension_window_open(draft_completed=draft_completed):
        raise ValueError("Rookie extensions are only available before the draft is marked complete.")

    contract = dict(row.get("contract") or {})
    if has_pending_extension(contract):
        pending = contract.get(PENDING_EXTENSION_KEY) or {}
        pending_years = int(pending.get("years") or 0)
        if pending_years == years:
            return contract, True
        raise ValueError(
            f"Extension already queued for {pending_years} year(s) — "
            "cannot change duration after submission."
        )

    ok, msg = can_manager_rookie_extend(row, rules, draft_completed=draft_completed)
    if not ok:
        raise ValueError(msg)

    queued = queue_pending_extension(row, rules, extension_years=years)
    return queued, False


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
