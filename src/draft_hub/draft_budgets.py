"""Auction budget invariants: retained hits, dead cap, min-bid reserve, roster size.

SCORE-46: live and sandbox drafts must start from cap − retained − dead cap,
reserve min bid for every remaining slot, and lock teams already over cap.
"""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.pre_draft_cap import (
    ROSTER_CUT_BEFORE_DRAFT,
    pre_draft_cap_summary,
    retained_through_draft,
    roster_status,
    total_pre_draft_dead_cap,
)
from src.draft_hub.rules_engine import roster_limits
from src.draft_hub.schemas import LeagueRules

DEADCAP_PREFIX = "deadcap:"
NON_OCCUPYING_STATUSES = frozenset(
    {ROSTER_CUT_BEFORE_DRAFT, "cut", "waived", "traded"}
)


def is_liability_row(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    pid = str(row.get("player_id") or "")
    if pid.startswith(DEADCAP_PREFIX):
        return True
    return roster_status(row) in NON_OCCUPYING_STATUSES


def deadcap_player_id(player_id: str) -> str:
    pid = str(player_id or "").strip()
    if pid.startswith(DEADCAP_PREFIX):
        return pid
    return f"{DEADCAP_PREFIX}{pid}"


def occupying_roster(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    draft_completed: bool = False,
) -> list[dict[str, Any]]:
    """Rows that consume a roster slot for this draft (keepers + current awards)."""
    allowed = {k.upper() for k in roster_limits(rules)}
    out: list[dict[str, Any]] = []
    for row in roster or []:
        if is_liability_row(row):
            continue
        if allowed:
            from src.draft_hub.rules_engine import normalize_position

            if normalize_position(row.get("position")) not in allowed:
                continue
        if retained_through_draft(row, draft_completed=draft_completed):
            out.append(row)
    return out


def total_roster_slots(rules: LeagueRules) -> int:
    explicit = getattr(rules, "roster_size_max", None)
    if explicit is not None:
        return max(0, int(explicit))
    limits = roster_limits(rules)
    return sum(int(lim.get("max") or 0) for lim in limits.values())


def open_roster_slots(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    draft_completed: bool = False,
) -> int:
    used = len(occupying_roster(rules, roster, draft_completed=draft_completed))
    return max(0, total_roster_slots(rules) - used)


def computed_auction_budget(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    draft_completed: bool = False,
) -> float:
    summary = pre_draft_cap_summary(rules, roster, draft_completed=draft_completed)
    if summary is None:
        from src.draft_hub.contracts import cap_hit

        committed = sum(
            cap_hit(r, 0)
            for r in occupying_roster(rules, roster, draft_completed=draft_completed)
        )
        dead = total_pre_draft_dead_cap(rules, roster, year_offset=0)
        return round(float(rules.salary_cap) - committed - dead, 2)
    return float(summary["draft_budget_available"])


def max_affordable_bid(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    budget_remaining: float,
    *,
    draft_completed: bool = False,
) -> float:
    """Highest legal bid after reserving min_bid for every other open slot."""
    min_bid = float(rules.auction.min_bid)
    budget = float(budget_remaining)
    if budget < min_bid:
        return 0.0
    open_slots = open_roster_slots(rules, roster, draft_completed=draft_completed)
    reserved = min_bid * max(0, open_slots - 1)
    return round(max(0.0, budget - reserved), 2)


def assert_can_afford_auction_bid(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    budget_remaining: float,
    amount: float,
    *,
    draft_completed: bool = False,
) -> None:
    min_bid = float(rules.auction.min_bid)
    bid = float(amount)
    budget = float(budget_remaining)
    if budget <= 0:
        raise ValueError("Team is over cap and cannot bid")
    if bid < min_bid:
        raise ValueError("Bid exceeds budget or below minimum")
    ceiling = max_affordable_bid(
        rules, roster, budget, draft_completed=draft_completed
    )
    if bid > ceiling:
        if bid > budget:
            raise ValueError("Bid exceeds budget or below minimum")
        raise ValueError(
            f"Bid exceeds max ${ceiling:.0f} after reserving ${min_bid:.0f} "
            "for each remaining roster slot"
        )


def team_auction_finance(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    draft_completed: bool = False,
    budget_remaining: float | None = None,
) -> dict[str, Any]:
    draft_budget = computed_auction_budget(
        rules, roster, draft_completed=draft_completed
    )
    budget = float(budget_remaining) if budget_remaining is not None else draft_budget
    occupying = occupying_roster(rules, roster, draft_completed=draft_completed)
    open_slots = open_roster_slots(rules, roster, draft_completed=draft_completed)
    return {
        "draft_budget": draft_budget,
        "over_cap": draft_budget < 0,
        "locked": draft_budget <= 0,
        "open_slots": open_slots,
        "occupying": len(occupying),
        "roster_size_max": total_roster_slots(rules),
        "max_bid": max_affordable_bid(
            rules, roster, budget, draft_completed=draft_completed
        ),
    }


def sync_league_auction_budgets(league_id: str) -> dict[str, float]:
    """Set each team's budget_remaining to cap − retained − dead cap."""
    league = storage.get_league(league_id)
    if not league:
        return {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    draft_completed = bool(league.get("draft_completed"))
    by_team = storage.list_league_rosters_by_team(league_id)
    updated: dict[str, float] = {}
    for team in storage.list_league_teams(league_id):
        tid = str(team["id"])
        budget = computed_auction_budget(
            rules, by_team.get(tid) or [], draft_completed=draft_completed
        )
        storage.update_team_budget(tid, budget)
        updated[tid] = budget
    return updated


def preserve_cut_liability(workspace_id: str, player_id: str) -> dict[str, Any] | None:
    """If player_id is a cut/liability row, rekey it so a new award can own the id."""
    existing = storage.get_roster_slot(workspace_id, player_id)
    if not existing or not is_liability_row(existing):
        return None
    new_id = deadcap_player_id(player_id)
    if str(existing.get("player_id")) == new_id:
        return existing
    if storage.get_roster_slot(workspace_id, new_id):
        storage.remove_roster_slot(workspace_id, new_id)
    contract = dict(existing.get("contract") or {})
    contract["liability_only"] = True
    contract["liability_of"] = str(player_id)
    return storage.rekey_roster_player_id(
        workspace_id,
        player_id,
        new_id,
        contract=contract,
        roster_status=existing.get("roster_status") or ROSTER_CUT_BEFORE_DRAFT,
    )


def slot_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "player_id": row.get("player_id"),
        "player_name": row.get("player_name"),
        "team": row.get("team"),
        "position": row.get("position"),
        "salary": row.get("salary"),
        "contract_years": row.get("contract_years"),
        "sleeper_player_id": row.get("sleeper_player_id"),
        "source": row.get("source"),
        "roster_status": row.get("roster_status") or "active",
        "team_id": row.get("team_id"),
        "contract": dict(row.get("contract") or {}),
    }


def save_sandbox_baseline(league_id: str) -> None:
    league = storage.get_league(league_id)
    if not league:
        return
    by_team = storage.list_league_rosters_by_team(league_id)
    slots: list[dict[str, Any]] = []
    for rows in by_team.values():
        slots.extend(slot_snapshot(row) for row in rows)
    storage.save_sandbox_baseline(
        league_id,
        {
            "kind": "keeper_sandbox_baseline",
            "source_league_id": league.get("id"),
            "slots": slots,
        },
    )


def restore_sandbox_baseline(league_id: str) -> bool:
    """Replace current sandbox rosters with the clone-time keeper snapshot."""
    snap = storage.get_sandbox_baseline(league_id) or {}
    slots = list((snap.get("slots") or []))
    if snap.get("kind") != "keeper_sandbox_baseline":
        return False
    league = storage.get_league(league_id)
    if not league:
        return False
    ws_id = storage.roster_workspace_for_league(league)
    storage.clear_league_team_rosters(league_id)
    for slot in slots:
        pid = slot.get("player_id")
        if not pid:
            continue
        storage.add_roster_slot(
            ws_id,
            {
                "player_id": pid,
                "player_name": slot.get("player_name"),
                "team": slot.get("team"),
                "position": slot.get("position") or "FLEX",
                "salary": float(slot.get("salary") or 1),
                "contract_years": int(slot.get("contract_years") or 1),
                "sleeper_player_id": slot.get("sleeper_player_id"),
                "source": slot.get("source") or "sheet",
                "roster_status": slot.get("roster_status") or "active",
                "contract": dict(slot.get("contract") or {}),
            },
            team_id=slot.get("team_id"),
        )
    return True
