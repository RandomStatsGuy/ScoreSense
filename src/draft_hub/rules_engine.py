"""Cap math, roster validation, and contract rules."""

from __future__ import annotations

from typing import Any

from src.draft_hub.schemas import LeagueRules
from src.draft_hub.contracts import cap_hit, multi_year_cap_plan as contract_cap_plan


def normalize_position(pos: str) -> str:
    p = str(pos or "").upper().strip()
    if p in ("DST", "D/ST", "D"):
        return "DEF"
    if p in ("WR", "TE", "K", "DEF", "QB", "RB"):
        return p
    if p == "REC":
        return "WR"
    return p


def roster_limits(rules: LeagueRules) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for key, val in (rules.roster or {}).items():
        if key == "flex" or not isinstance(val, dict):
            continue
        out[key.lower()] = {
            "min": int(val.get("min") or 0),
            "max": int(val.get("max") or 99),
            "starter": int(val.get("starter") or 0),
        }
    return out


def salary_roster_limits_relaxed(rules: LeagueRules) -> bool:
    """True when a practice room has opted out of cap / position enforcement."""
    return bool(getattr(rules, "relax_salary_roster_limits", False))


def cap_relevant_roster(rules: LeagueRules, roster: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Limit cap math to positions governed by league roster rules (QB/RB/WR/TE)."""
    allowed = {k.upper() for k in roster_limits(rules)}
    if not allowed:
        return roster
    return [r for r in roster if normalize_position(r.get("position")) in allowed]


def cap_summary(rules: LeagueRules, roster: list[dict[str, Any]]) -> dict[str, Any]:
    roster = cap_relevant_roster(rules, roster)
    cap = float(rules.salary_cap)
    spent = sum(cap_hit(r, 0) for r in roster)
    remaining = cap - spent
    by_pos: dict[str, float] = {}
    counts: dict[str, int] = {}
    contract_years: dict[str, list[int]] = {}
    for row in roster:
        pos = normalize_position(row.get("position"))
        sal = cap_hit(row, 0)
        by_pos[pos] = by_pos.get(pos, 0.0) + sal
        counts[pos] = counts.get(pos, 0) + 1
        yrs = int(row.get("contract_years") or 1)
        contract_years.setdefault(str(yrs), []).append(row.get("player_name") or row.get("player_id"))

    return {
        "salary_cap": cap,
        "spent": round(spent, 2),
        "remaining": round(remaining, 2),
        "by_position_spend": {k: round(v, 2) for k, v in sorted(by_pos.items())},
        "by_position_count": counts,
        "contract_summary": {k: len(v) for k, v in sorted(contract_years.items())},
        "roster_size": len(roster),
    }


def validate_roster(rules: LeagueRules, roster: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    roster = cap_relevant_roster(rules, roster)
    summary = cap_summary(rules, roster)
    if summary["remaining"] < 0:
        errors.append(f"Over cap by ${abs(summary['remaining']):.0f}")

    limits = roster_limits(rules)
    counts = summary["by_position_count"]
    for pos, lim in limits.items():
        pos_key = pos.upper()
        count = counts.get(pos_key, 0)
        if count < lim["min"]:
            errors.append(f"Need {lim['min'] - count} more {pos_key} (min {lim['min']})")
        if count > lim["max"]:
            errors.append(f"{count - lim['max']} too many {pos_key} (max {lim['max']})")

    max_years = int(rules.contracts.max_years)
    for row in roster:
        yrs = int(row.get("contract_years") or 1)
        if yrs < 1 or yrs > max_years:
            name = row.get("player_name") or row.get("player_id")
            errors.append(f"{name}: contract years must be 1–{max_years}")

    return errors


def cut_refund(rules: LeagueRules, salary: float) -> float:
    pct = float(rules.contracts.cut_refund_pct)
    return round(float(salary) * pct, 2)


def can_afford_bid(rules: LeagueRules, budget_remaining: float, bid: float) -> bool:
    return bid >= float(rules.auction.min_bid) and bid <= budget_remaining


def _occupying(rules: LeagueRules, roster: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from src.draft_hub.draft_budgets import occupying_roster

    return occupying_roster(rules, roster, draft_completed=False)


def count_at_position(rules: LeagueRules, roster: list[dict[str, Any]], position: str) -> int:
    pos = normalize_position(position)
    return sum(
        1
        for row in _occupying(rules, roster)
        if normalize_position(row.get("position")) == pos
    )


def position_at_max(rules: LeagueRules, roster: list[dict[str, Any]], position: str) -> bool:
    pos_key = normalize_position(position).lower()
    limits = roster_limits(rules)
    lim = limits.get(pos_key)
    if not lim:
        return False
    return count_at_position(rules, roster, position) >= int(lim["max"])


def position_below_min(rules: LeagueRules, roster: list[dict[str, Any]], position: str) -> bool:
    pos_key = normalize_position(position).lower()
    limits = roster_limits(rules)
    lim = limits.get(pos_key)
    if not lim:
        return False
    return count_at_position(rules, roster, position) < int(lim["min"] or 0)


def nomination_sort_key(
    rules: LeagueRules, roster: list[dict[str, Any]], row: dict[str, Any]
) -> tuple[int, float]:
    """Need-aware BPA: unfilled positional mins first, then highest fair value.

    Sort ascending. Tier 0 = this pick fills a league minimum; tier 1 = optional.
    """
    pos = normalize_position(row.get("position"))
    fair = 0.0
    for key in ("fair_value", "model_bid_hint", "season_proj"):
        try:
            fair = float(row.get(key) or 0)
        except (TypeError, ValueError):
            fair = 0.0
        if fair:
            break
    below = 0 if position_below_min(rules, roster, pos) else 1
    return (below, -fair)


def occupying_min_errors(rules: LeagueRules, roster: list[dict[str, Any]]) -> list[str]:
    """Position-min violations for rows that currently occupy a roster slot."""
    if salary_roster_limits_relaxed(rules):
        return []
    from src.draft_hub.draft_budgets import occupying_roster

    occupying = occupying_roster(rules, roster, draft_completed=False)
    errors: list[str] = []
    limits = roster_limits(rules)
    counts: dict[str, int] = {}
    for row in occupying:
        pos = normalize_position(row.get("position"))
        counts[pos] = counts.get(pos, 0) + 1
    for key, lim in limits.items():
        min_n = int(lim.get("min") or 0)
        if min_n <= 0:
            continue
        pos = key.upper()
        count = int(counts.get(pos, 0))
        if count < min_n:
            errors.append(f"Need {min_n - count} more {pos} (min {min_n})")
    return errors


def unmet_minimum_positions(rules: LeagueRules, roster: list[dict[str, Any]]) -> set[str]:
    """Uppercase positions still below league min."""
    from src.draft_hub.draft_budgets import occupying_roster

    occupying = occupying_roster(rules, roster, draft_completed=False)
    limits = roster_limits(rules)
    counts: dict[str, int] = {}
    for row in occupying:
        pos = normalize_position(row.get("position"))
        counts[pos] = counts.get(pos, 0) + 1
    unmet: set[str] = set()
    for key, lim in limits.items():
        min_n = int(lim.get("min") or 0)
        if min_n <= 0:
            continue
        pos = key.upper()
        if int(counts.get(pos, 0)) < min_n:
            unmet.add(pos)
    return unmet


def should_need_bid(rules: LeagueRules, roster: list[dict[str, Any]], position: str) -> bool:
    """If any min is unfilled, only bid/nominate that fills one of those mins."""
    if salary_roster_limits_relaxed(rules):
        return True
    unmet = unmet_minimum_positions(rules, roster)
    if not unmet:
        return True
    return normalize_position(position) in unmet


def assert_can_acquire(rules: LeagueRules, roster: list[dict[str, Any]], position: str) -> None:
    from src.draft_hub.draft_budgets import total_roster_slots

    if salary_roster_limits_relaxed(rules):
        return
    occupying = _occupying(rules, roster)
    total_max = total_roster_slots(rules)
    if total_max and len(occupying) >= total_max:
        raise ValueError(f"Roster at maximum size ({total_max})")
    pos = normalize_position(position)
    pos_key = pos.lower()
    limits = roster_limits(rules)
    lim = limits.get(pos_key)
    if not lim:
        return
    count = count_at_position(rules, roster, pos)
    if count >= int(lim["max"]):
        raise ValueError(f"Roster at {pos} maximum ({lim['max']})")


def roster_capacity(rules: LeagueRules, roster: list[dict[str, Any]]) -> dict[str, Any]:
    from src.draft_hub.draft_budgets import open_roster_slots, total_roster_slots

    limits = roster_limits(rules)
    occupying = _occupying(rules, roster)
    counts: dict[str, int] = {}
    for row in occupying:
        pos = normalize_position(row.get("position"))
        counts[pos] = counts.get(pos, 0) + 1
    by_position: dict[str, dict[str, int | bool]] = {}
    for key, lim in limits.items():
        pos = key.upper()
        count = int(counts.get(pos, 0))
        max_n = int(lim["max"])
        by_position[pos] = {
            "count": count,
            "min": int(lim["min"]),
            "max": max_n,
            "at_max": False if salary_roster_limits_relaxed(rules) else count >= max_n,
            "below_min": False if salary_roster_limits_relaxed(rules) else count < int(lim["min"]),
            "remaining": max(0, max_n - count),
        }
    size_max = total_roster_slots(rules)
    return {
        "by_position": by_position,
        "roster_size": len(occupying),
        "roster_size_max": size_max,
        "remaining": open_roster_slots(rules, roster, draft_completed=False),
    }


def multi_year_cap_plan(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    seasons_ahead: int = 3,
    *,
    draft_completed: bool = False,
) -> list[dict[str, Any]]:
    if draft_completed:
        return contract_cap_plan(rules, roster, seasons_ahead=seasons_ahead)

    from src.draft_hub.pre_draft_cap import (
        pre_draft_cut_dead_cap_at_offset,
        retained_through_draft,
        roster_status,
    )

    scoped = cap_relevant_roster(rules, roster)
    active = [r for r in scoped if retained_through_draft(r, draft_completed=False)]
    plan = contract_cap_plan(rules, active, seasons_ahead=seasons_ahead)
    cap = float(rules.salary_cap)

    for year in plan:
        offset = int(year["season_offset"])
        dead_total = 0.0
        for row in scoped:
            if roster_status(row) != "cut_before_draft":
                continue
            dead = pre_draft_cut_dead_cap_at_offset(rules, row, offset)
            if dead <= 0:
                continue
            dead_total += dead
            year["cap_hits"].append(
                {
                    "player": f"{row.get('player_name')} (dead cap)",
                    "salary": dead,
                    "player_id": row.get("player_id"),
                    "dead_cap": True,
                }
            )
        if dead_total > 0:
            year["dead_cap"] = round(dead_total, 2)
            year["total_committed"] = round(float(year["total_committed"]) + dead_total, 2)
            year["cap_remaining"] = round(cap - float(year["total_committed"]), 2)

    return plan
