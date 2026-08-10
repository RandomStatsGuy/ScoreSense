"""Contract type inference and draft-complete year clock."""

from __future__ import annotations

from typing import Any

from src.draft_hub.contracts import (
    build_contract_from_roster_edit,
    build_rookie_contract,
    build_veteran_contract,
    contract_rules,
)
from src.draft_hub.schemas import LeagueRules

CONTRACT_TYPES = ("rookie", "veteran", "extension")


def nfl_years_exp(row: dict[str, Any] | None = None, *, years_exp: int | None = None) -> int | None:
    if years_exp is not None:
        try:
            return max(0, int(years_exp))
        except (TypeError, ValueError):
            return None
    if not row:
        return None
    for key in ("years_exp", "nfl_years_exp"):
        if row.get(key) is not None:
            try:
                return max(0, int(row[key]))
            except (TypeError, ValueError):
                return None
    contract = row.get("contract") or {}
    if contract.get("years_exp") is not None:
        try:
            return max(0, int(contract["years_exp"]))
        except (TypeError, ValueError):
            return None
    return None


def in_nfl_rookie_window(
    rules: LeagueRules,
    *,
    years_exp: int | None = None,
    original_draft_year: int | None = None,
    season: int | None = None,
) -> bool:
    cr = contract_rules(rules)
    limit = int(cr.rookie_years)
    if years_exp is not None:
        return years_exp < limit
    if original_draft_year is not None and season is not None:
        return max(0, int(season) - int(original_draft_year)) < limit
    return False


def infer_contract_type(
    existing: dict[str, Any] | None,
    rules: LeagueRules,
    *,
    years_exp: int | None = None,
    original_draft_year: int | None = None,
    season: int | None = None,
    explicit: str | None = None,
) -> str:
    """Resolve contract_type without clobbering extensions / renewals."""
    prior = existing or {}
    if explicit in CONTRACT_TYPES:
        return explicit
    if prior.get("renewal_used") or prior.get("contract_type") == "extension":
        return "extension"
    if prior.get("contract_type_manual"):
        ctype = str(prior.get("contract_type") or "veteran")
        return ctype if ctype in CONTRACT_TYPES else "veteran"
    if in_nfl_rookie_window(
        rules,
        years_exp=years_exp,
        original_draft_year=original_draft_year,
        season=season,
    ):
        return "rookie"
    ctype = str(prior.get("contract_type") or "")
    if ctype in CONTRACT_TYPES:
        return ctype
    return "veteran"


def suggested_rookie_years_pre_draft(
    rules: LeagueRules,
    *,
    years_exp: int | None,
) -> int | None:
    """Years left including upcoming season (pre-draft), from NFL experience."""
    if years_exp is None:
        return None
    cr = contract_rules(rules)
    limit = int(cr.rookie_years)
    if years_exp >= limit:
        return None
    # years_exp seasons already played; upcoming season has not ticked yet.
    if years_exp <= 0:
        return limit
    return max(1, limit - years_exp + 1)


def apply_type_to_contract(
    rules: LeagueRules,
    row: dict[str, Any],
    *,
    contract_type: str,
    years_remaining: int | None = None,
    salary: float | None = None,
    manual: bool = False,
    years_exp: int | None = None,
    clear_pending: bool = False,
) -> dict[str, Any]:
    existing = dict(row.get("contract") or {})
    sal = float(salary if salary is not None else existing.get("current_salary") or row.get("salary") or 1)
    yrs = int(
        years_remaining
        if years_remaining is not None
        else existing.get("years_remaining")
        or row.get("contract_years")
        or 1
    )
    ctype = contract_type if contract_type in CONTRACT_TYPES else "veteran"
    if ctype == "rookie":
        # Always flat — never inherit a stepped schedule from a prior mistype.
        contract = build_rookie_contract(sal, min(yrs, int(rules.contracts.rookie_years)))
        contract["years_remaining"] = yrs
        contract["schedule"] = [{"year_offset": i, "salary": sal} for i in range(yrs)]
        contract["current_salary"] = sal
        contract["step_up_per_year"] = 0.0
    elif ctype == "veteran" and not existing.get("step_up_per_year") and yrs == 1:
        contract = build_veteran_contract(sal, yrs)
    else:
        contract = build_contract_from_roster_edit(
            rules,
            current_salary=sal,
            years_remaining=yrs,
            existing=existing,
            contract_type=ctype,
        )
    contract["contract_type"] = ctype
    if ctype == "extension":
        contract["renewal_used"] = True
    if manual:
        contract["contract_type_manual"] = True
        contract.pop("inferred_from", None)
    elif years_exp is not None:
        contract["inferred_from"] = f"nfl_yr_{years_exp}"
        contract["years_exp"] = years_exp
        contract.pop("contract_type_manual", None)
    if clear_pending:
        contract.pop("pending_type", None)
        contract.pop("pending_type_by", None)
        contract.pop("pending_type_at", None)
    return contract


def backfill_row_contract(
    rules: LeagueRules,
    row: dict[str, Any],
    *,
    season: int,
    draft_completed: bool,
    years_exp: int | None = None,
    original_draft_year: int | None = None,
) -> dict[str, Any] | None:
    """Return updated contract if type/years should be fixed; else None."""
    existing = dict(row.get("contract") or {})
    if existing.get("contract_type_manual"):
        return None
    exp = nfl_years_exp(row, years_exp=years_exp)
    draft_yr = original_draft_year
    if draft_yr is None:
        try:
            draft_yr = int(row.get("original_draft_year")) if row.get("original_draft_year") is not None else None
        except (TypeError, ValueError):
            draft_yr = None

    inferred = infer_contract_type(
        existing,
        rules,
        years_exp=exp,
        original_draft_year=draft_yr,
        season=season,
    )
    cur_type = str(existing.get("contract_type") or "veteran")
    cur_yrs = int(existing.get("years_remaining") or row.get("contract_years") or 1)
    new_yrs = cur_yrs
    if (
        not draft_completed
        and inferred == "rookie"
        and exp is not None
        and exp < int(rules.contracts.rookie_years)
    ):
        suggested = suggested_rookie_years_pre_draft(rules, years_exp=exp)
        if suggested is not None and suggested > cur_yrs:
            new_yrs = suggested

    if inferred == cur_type and new_yrs == cur_yrs and existing.get("contract_type"):
        return None

    return apply_type_to_contract(
        rules,
        row,
        contract_type=inferred,
        years_remaining=new_yrs,
        years_exp=exp,
        manual=False,
        clear_pending=False,
    )


def advance_contract_year(contract: dict[str, Any] | None, row: dict[str, Any]) -> dict[str, Any] | None:
    """Burn one year after draft completes. Returns None if player expires (0 years left)."""
    existing = dict(contract or {})
    yrs = int(existing.get("years_remaining") or row.get("contract_years") or 1)
    sal = float(existing.get("current_salary") or existing.get("base_salary") or row.get("salary") or 0)
    new_yrs = yrs - 1
    if new_yrs <= 0:
        return None
    schedule = list(existing.get("schedule") or [])
    # Shift schedule forward one year (drop offset 0, reindex).
    shifted: list[dict[str, Any]] = []
    for entry in schedule:
        off = int(entry.get("year_offset", -1))
        if off <= 0:
            continue
        shifted.append({"year_offset": off - 1, "salary": float(entry.get("salary") or sal)})
    if not shifted:
        step = float(existing.get("step_up_per_year") or 0)
        ctype = str(existing.get("contract_type") or "veteran")
        if ctype == "extension" and step:
            shifted = [{"year_offset": i, "salary": round(sal + step * (i + 1), 2)} for i in range(new_yrs)]
            # After burning year 0, current salary is old year-1.
            sal = float(shifted[0]["salary"])
        else:
            shifted = [{"year_offset": i, "salary": sal} for i in range(new_yrs)]
    else:
        sal = float(shifted[0].get("salary") or sal)

    out = {
        **existing,
        "years_remaining": new_yrs,
        "schedule": shifted[:new_yrs],
        "current_salary": sal,
        "base_salary": sal,
    }
    return out


def advance_roster_contracts_for_draft_complete(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
) -> dict[str, Any]:
    """Apply year tick to active rows. Caller persists updates.

    Returns summary + list of {player_id, contract|None, expired}.
    """
    updates: list[dict[str, Any]] = []
    expired = 0
    advanced = 0
    for row in roster:
        status = str(row.get("roster_status") or "active")
        if status != "active":
            continue
        # Fresh auction awards are for the upcoming season — do not burn a year
        # on the same draft-complete tick that keepers advance on.
        if str(row.get("source") or "") == "draft":
            continue
        new_contract = advance_contract_year(row.get("contract"), row)
        if new_contract is None:
            expired += 1
            updates.append({"player_id": row["player_id"], "contract": None, "expired": True})
        else:
            advanced += 1
            updates.append({"player_id": row["player_id"], "contract": new_contract, "expired": False})
    return {
        "advanced": advanced,
        "expired": expired,
        "updates": updates,
        "note": "Contract year started — years left dropped by 1.",
    }


def rewind_contract_year(contract: dict[str, Any] | None, row: dict[str, Any]) -> dict[str, Any]:
    """Undo one draft-complete year tick (best-effort). Cannot restore deleted expired players."""
    existing = dict(contract or {})
    yrs = int(existing.get("years_remaining") or row.get("contract_years") or 1)
    sal = float(existing.get("current_salary") or existing.get("base_salary") or row.get("salary") or 0)
    new_yrs = yrs + 1
    schedule = list(existing.get("schedule") or [])
    shifted: list[dict[str, Any]] = [{"year_offset": 0, "salary": sal}]
    for entry in schedule:
        off = int(entry.get("year_offset", 0))
        shifted.append({
            "year_offset": off + 1,
            "salary": float(entry.get("salary") or sal),
        })
    # If schedule was empty, fill remaining years at flat salary.
    while len(shifted) < new_yrs:
        shifted.append({"year_offset": len(shifted), "salary": sal})
    return {
        **existing,
        "years_remaining": new_yrs,
        "schedule": shifted[:new_yrs],
        "current_salary": sal,
        "base_salary": sal,
    }


def rewind_roster_contracts_after_draft_reset(
    roster: list[dict[str, Any]],
) -> dict[str, Any]:
    """Reverse year tick for active keepers still on the roster."""
    updates: list[dict[str, Any]] = []
    for row in roster:
        status = str(row.get("roster_status") or "active")
        if status != "active":
            continue
        # Draft awards are removed separately; only rewind keepers / imports.
        if str(row.get("source") or "") == "draft":
            continue
        contract = rewind_contract_year(row.get("contract"), row)
        updates.append({"player_id": row["player_id"], "contract": contract})
    return {
        "rewound": len(updates),
        "updates": updates,
        "note": (
            "Years left +1 for remaining keepers. "
            "Players who expired when draft was marked complete are not restored — re-sync sheets/Sleeper if needed."
        ),
    }
