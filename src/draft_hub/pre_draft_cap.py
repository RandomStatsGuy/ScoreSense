"""Pre-draft cap planning — cuts, contract expiry before draft, and draft budget."""

from __future__ import annotations

from typing import Any

from src.draft_hub.contracts import can_renew, cap_hit
from src.draft_hub.rules_engine import cap_relevant_roster, cut_refund, normalize_position
from src.draft_hub.schemas import LeagueRules

ROSTER_ACTIVE = "active"
ROSTER_CUT_BEFORE_DRAFT = "cut_before_draft"
ROSTER_EXPIRED = "expired"  # SCORE-45: archived after draft-complete year tick


def roster_status(row: dict[str, Any]) -> str:
    return str(row.get("roster_status") or ROSTER_ACTIVE)


def is_active_for_pre_draft(row: dict[str, Any]) -> bool:
    return roster_status(row) == ROSTER_ACTIVE


def years_remaining(row: dict[str, Any]) -> int:
    contract = row.get("contract") or {}
    if isinstance(contract, dict) and contract.get("years_remaining") is not None:
        return int(contract["years_remaining"])
    if row.get("years_remaining") is not None:
        return int(row["years_remaining"])
    if row.get("contract_years") is not None:
        return int(row["contract_years"])
    return 1


def contract_type(row: dict[str, Any]) -> str:
    return str((row.get("contract") or {}).get("contract_type") or "veteran")


def cut_obligation_years(row: dict[str, Any]) -> int:
    """Dead cap lasts the cut season only — later years are gone."""
    if roster_status(row) != ROSTER_CUT_BEFORE_DRAFT:
        return 0
    return 1


def pre_draft_cut_dead_cap_at_offset(
    rules: LeagueRules,
    row: dict[str, Any],
    year_offset: int = 0,
) -> float:
    """Dead cap is this season only: (1 - cut_refund_pct) of the cut year's cap hit."""
    if roster_status(row) != ROSTER_CUT_BEFORE_DRAFT:
        return 0.0
    if year_offset != 0:
        return 0.0
    sal = cap_hit(row, 0)
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
        contract["cut_dead_cap_years"] = 1
        return contract
    if roster_status == ROSTER_ACTIVE:
        contract.pop("cut_dead_cap_years", None)
        return contract
    return None


def expires_before_draft(row: dict[str, Any], *, draft_completed: bool) -> bool:
    """Final year of a pre-draft deal — leaves the roster before this draft unless extended.

    Players acquired in the current auction (source draft/auction) keep a valid 1-year
    deal for this season and are not treated as expired keepers.

    FA contract ($1) always expires before the next draft even if still on Sleeper.
    """
    if draft_completed:
        return False
    if not is_active_for_pre_draft(row):
        return False
    from src.draft_hub.acquisition_semantics import is_current_auction_award, is_fa_contract
    from src.draft_hub.contracts import has_pending_extension

    if is_fa_contract(row):
        return True
    # Queued extension activates after draft-complete tick — keep them for this draft.
    if has_pending_extension(row):
        return False
    if years_remaining(row) > 1:
        return False
    if is_current_auction_award(row):
        return False
    return True


# Back-compat alias used by older call sites / tests.
expires_after_draft = expires_before_draft


def retained_through_draft(row: dict[str, Any], *, draft_completed: bool) -> bool:
    """Still under contract for this draft season (counts toward cap / blocks nomination)."""
    if not is_active_for_pre_draft(row):
        return False
    from src.draft_hub.acquisition_semantics import is_current_auction_award, is_fa_contract
    from src.draft_hub.contracts import has_pending_extension

    if is_fa_contract(row):
        return False
    yrs = years_remaining(row)
    if yrs < 1:
        return False
    if draft_completed:
        return True
    if yrs > 1:
        return True
    if has_pending_extension(row):
        return True
    # 1-year auction acquisitions for the upcoming season.
    return is_current_auction_award(row)


def _player_brief(row: dict[str, Any], rules: LeagueRules) -> dict[str, Any]:
    ok, reason = can_renew(row, rules)
    sal = cap_hit(row, 0)
    return {
        "player_id": row.get("player_id"),
        "player_name": row.get("player_name"),
        "position": normalize_position(row.get("position")),
        "salary": sal,
        "years_remaining": years_remaining(row),
        "contract_type": contract_type(row),
        "can_extend": ok,
        "extend_reason": reason,
    }


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
    retained = [r for r in scoped if retained_through_draft(r, draft_completed=False)]
    cuts = [r for r in scoped if roster_status(r) == ROSTER_CUT_BEFORE_DRAFT]

    committed = round(sum(cap_hit(r, 0) for r in retained), 2)
    dead_cap = total_pre_draft_dead_cap(rules, scoped, year_offset=0)
    cap_freed_from_cuts = round(sum(pre_draft_cut_cap_freed(rules, r) for r in cuts), 2)
    draft_budget = round(cap - committed - dead_cap, 2)

    from src.draft_hub.contracts import has_pending_extension

    must_extend: list[dict[str, Any]] = []
    dropping: list[dict[str, Any]] = []
    queued_extensions: list[dict[str, Any]] = []
    for row in scoped:
        if has_pending_extension(row) and is_active_for_pre_draft(row):
            pending = (row.get("contract") or {}).get("pending_extension") or {}
            brief = _player_brief(row, rules)
            brief["queued_years"] = int(pending.get("years") or 0) or None
            brief["queued_start_salary"] = pending.get("start_salary")
            queued_extensions.append(brief)
        if not expires_before_draft(row, draft_completed=False):
            continue
        brief = _player_brief(row, rules)
        if brief["can_extend"]:
            must_extend.append(brief)
        else:
            dropping.append(brief)

    # Combined list for older UI (banner chips, etc.).
    expiring = [*must_extend, *dropping]

    after_draft_committed = round(sum(cap_hit(r, 1) for r in retained), 2)
    after_draft_dead = total_pre_draft_dead_cap(rules, scoped, year_offset=1)
    after_draft_budget = round(cap - after_draft_committed - after_draft_dead, 2)

    return {
        "draft_completed": False,
        "salary_cap": cap,
        "season_committed": committed,
        "dead_cap": dead_cap,
        "draft_budget_available": draft_budget,
        "cap_freed_from_cuts": cap_freed_from_cuts,
        "must_extend": must_extend,
        "queued_extensions": queued_extensions,
        "dropping_at_draft": dropping,
        "expiring_before_draft": expiring,
        # Deprecated alias — same as expiring_before_draft.
        "expiring_after_draft": expiring,
        "pending_cuts": [
            {
                "player_id": row.get("player_id"),
                "player_name": row.get("player_name"),
                "position": normalize_position(row.get("position")),
                "salary": cap_hit(row, 0),
                "dead_cap": round(pre_draft_cut_dead_cap_at_offset(rules, row, 0), 2),
                "cap_freed": pre_draft_cut_cap_freed(rules, row),
                "dead_cap_years": cut_obligation_years(row),
                "cut_refund_pct": float(rules.contracts.cut_refund_pct),
            }
            for row in cuts
        ],
        "after_draft_projection": {
            "committed": after_draft_committed,
            "dead_cap": after_draft_dead,
            "budget_available": after_draft_budget,
            "note": (
                "Expired deals leave before the draft (FA). "
                f"Final-year {'rookie deals and vet deals' if rules.contracts.allow_veteran_renewal else 'rookie deals'} "
                f"can take one 1–{int(rules.contracts.max_years)} year extension "
                "when league rules allow it."
            ),
        },
    }


def cap_summary_for_phase(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    draft_completed: bool = False,
) -> dict[str, Any]:
    """Cap totals respecting pre-draft cuts and contract expiry before draft."""
    from src.draft_hub.rules_engine import cap_summary

    scoped = cap_relevant_roster(rules, roster)
    pool = [r for r in scoped if retained_through_draft(r, draft_completed=draft_completed)]

    base = cap_summary(rules, pool)
    dead_cap = total_pre_draft_dead_cap(rules, scoped, year_offset=0)
    spent = float(base["spent"])
    cap = float(base["salary_cap"])
    return {
        **base,
        "dead_cap": dead_cap,
        "remaining": round(cap - spent - dead_cap, 2),
        "draft_completed": draft_completed,
    }


def roster_for_pre_draft_validation(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    draft_completed: bool,
) -> list[dict[str, Any]]:
    """Roster rows that still count toward position limits before the draft."""
    scoped = cap_relevant_roster(rules, roster)
    return [r for r in scoped if retained_through_draft(r, draft_completed=draft_completed)]
