"""Pre-draft cap planning — cuts, expiring deals, and draft budget."""

from __future__ import annotations

from typing import Any

from src.draft_hub.contracts import cap_hit
from src.draft_hub.rules_engine import cap_relevant_roster, cut_refund, normalize_position
from src.draft_hub.schemas import LeagueRules

ROSTER_ACTIVE = "active"
ROSTER_CUT_BEFORE_DRAFT = "cut_before_draft"


def roster_status(row: dict[str, Any]) -> str:
    return str(row.get("roster_status") or ROSTER_ACTIVE)


def is_active_for_pre_draft(row: dict[str, Any]) -> bool:
    return roster_status(row) == ROSTER_ACTIVE


def years_remaining(row: dict[str, Any]) -> int:
    contract = row.get("contract") or {}
    return int(contract.get("years_remaining") or row.get("contract_years") or 1)


def cut_obligation_years(row: dict[str, Any]) -> int:
    """Contract years remaining when the player was cut (includes current season)."""
    if roster_status(row) != ROSTER_CUT_BEFORE_DRAFT:
        return 0
    contract = row.get("contract") or {}
    return int(
        contract.get("cut_dead_cap_years")
        or contract.get("years_remaining")
        or row.get("contract_years")
        or 1
    )


def pre_draft_cut_dead_cap_at_offset(
    rules: LeagueRules,
    row: dict[str, Any],
    year_offset: int = 0,
) -> float:
    """Dead cap for a pre-draft cut: (1 - cut_refund_pct) of that year's cap hit until contract ends."""
    if roster_status(row) != ROSTER_CUT_BEFORE_DRAFT:
        return 0.0
    yrs = cut_obligation_years(row)
    if year_offset < 0 or year_offset >= yrs:
        return 0.0
    sal = cap_hit(row, year_offset)
    if sal <= 0:
        return 0.0
    return round(float(sal) - cut_refund(rules, sal), 2)


def pre_draft_cut_cap_freed(rules: LeagueRules, row: dict[str, Any]) -> float:
    """Cap freed this season when a player is marked cut before the draft."""
    return cut_refund(rules, cap_hit(row, 0))


def total_pre_draft_dead_cap(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    year_offset: int = 0,
) -> float:
    return round(
        sum(
            pre_draft_cut_dead_cap_at_offset(rules, row, year_offset)
            for row in roster
            if roster_status(row) == ROSTER_CUT_BEFORE_DRAFT
        ),
        2,
    )


def contract_on_cut_status_change(
    existing: dict[str, Any],
    *,
    roster_status: str,
) -> dict[str, Any] | None:
    """Snapshot or clear cut obligation years on the stored contract."""
    contract = dict(existing.get("contract") or {})
    if roster_status == ROSTER_CUT_BEFORE_DRAFT:
        contract["cut_dead_cap_years"] = years_remaining(existing)
        return contract
    if roster_status == ROSTER_ACTIVE:
        contract.pop("cut_dead_cap_years", None)
        return contract
    return None


def expires_after_draft(row: dict[str, Any], *, draft_completed: bool) -> bool:
    if draft_completed:
        return False
    return is_active_for_pre_draft(row) and years_remaining(row) <= 1


def pre_draft_cap_summary(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    draft_completed: bool = False,
) -> dict[str, Any] | None:
    if draft_completed:
        return None

    cap = float(rules.salary_cap)
    scoped = cap_relevant_roster(rules, roster)
    active = [r for r in scoped if is_active_for_pre_draft(r)]
    cuts = [r for r in scoped if roster_status(r) == ROSTER_CUT_BEFORE_DRAFT]

    committed = round(sum(cap_hit(r, 0) for r in active), 2)
    dead_cap = total_pre_draft_dead_cap(rules, scoped, year_offset=0)
    cap_freed_from_cuts = round(sum(pre_draft_cut_cap_freed(rules, r) for r in cuts), 2)
    draft_budget = round(cap - committed - dead_cap, 2)

    expiring = []
    for row in active:
        if expires_after_draft(row, draft_completed=False):
            sal = cap_hit(row, 0)
            expiring.append(
                {
                    "player_id": row.get("player_id"),
                    "player_name": row.get("player_name"),
                    "position": normalize_position(row.get("position")),
                    "salary": sal,
                    "years_remaining": years_remaining(row),
                }
            )

    pending_cuts = []
    for row in cuts:
        sal = cap_hit(row, 0)
        dead = pre_draft_cut_dead_cap_at_offset(rules, row, 0)
        obligation_years = cut_obligation_years(row)
        refund_pct = float(rules.contracts.cut_refund_pct)
        pending_cuts.append(
            {
                "player_id": row.get("player_id"),
                "player_name": row.get("player_name"),
                "position": normalize_position(row.get("position")),
                "salary": sal,
                "dead_cap": round(dead, 2),
                "cap_freed": pre_draft_cut_cap_freed(rules, row),
                "dead_cap_years": obligation_years,
                "cut_refund_pct": refund_pct,
            }
        )

    after_draft_committed = round(sum(cap_hit(r, 1) for r in active), 2)
    after_draft_dead = total_pre_draft_dead_cap(rules, scoped, year_offset=1)
    after_draft_budget = round(cap - after_draft_committed - after_draft_dead, 2)

    return {
        "draft_completed": False,
        "salary_cap": cap,
        "season_committed": committed,
        "dead_cap": dead_cap,
        "draft_budget_available": draft_budget,
        "cap_freed_from_cuts": cap_freed_from_cuts,
        "expiring_after_draft": expiring,
        "pending_cuts": pending_cuts,
        "after_draft_projection": {
            "committed": after_draft_committed,
            "dead_cap": after_draft_dead,
            "budget_available": after_draft_budget,
            "note": "Assumes no new signings; expiring contracts drop off after the draft.",
        },
    }


def cap_summary_for_phase(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    draft_completed: bool = False,
) -> dict[str, Any]:
    """Cap totals respecting pre-draft cuts when the draft has not completed."""
    scoped = cap_relevant_roster(rules, roster)
    if draft_completed:
        pool = scoped
    else:
        pool = [r for r in scoped if is_active_for_pre_draft(r)]

    cap = float(rules.salary_cap)
    spent = round(sum(cap_hit(r, 0) for r in pool), 2)
    dead_cap = 0.0 if draft_completed else total_pre_draft_dead_cap(rules, scoped, year_offset=0)
    return {
        "salary_cap": cap,
        "spent": spent,
        "dead_cap": dead_cap,
        "remaining": round(cap - spent - dead_cap, 2),
        "roster_size": len(pool),
        "draft_completed": draft_completed,
    }
