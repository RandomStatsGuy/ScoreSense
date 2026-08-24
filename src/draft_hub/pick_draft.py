"""Snake / linear pick-draft helpers. Auction leagues keep the bid state machine."""

from __future__ import annotations

from typing import Any, Literal

from src.draft_hub.draft_budgets import occupying_roster, total_roster_slots
from src.draft_hub.schemas import LeagueRules

DraftType = Literal["auction", "snake", "linear"]


def draft_type_of(rules: LeagueRules | None) -> DraftType:
    raw = str(getattr(rules, "draft_type", None) or "auction").strip().lower()
    if raw in ("snake", "serpentine"):
        return "snake"
    if raw in ("linear", "straight"):
        return "linear"
    return "auction"


def is_pick_draft(rules: LeagueRules | None) -> bool:
    return draft_type_of(rules) in ("snake", "linear")


def is_salary_draft(rules: LeagueRules | None) -> bool:
    return not is_pick_draft(rules)


def team_at_pick_index(order: list[str], pick_index: int, draft_type: str) -> str | None:
    n = len(order)
    if n == 0:
        return None
    rnd = int(pick_index) // n
    slot = int(pick_index) % n
    if str(draft_type) == "snake" and rnd % 2 == 1:
        slot = n - 1 - slot
    return str(order[slot])


def pick_clock(session: dict[str, Any] | None, rules: LeagueRules | None) -> dict[str, Any]:
    session = session or {}
    order = list(session.get("nomination_order") or [])
    idx = int(session.get("nominator_index") or 0)
    n = max(1, len(order))
    dtype = draft_type_of(rules)
    rnd = idx // n
    slot = idx % n
    return {
        "overall": idx + 1,
        "round": rnd + 1,
        "slot": slot + 1,
        "team_id": team_at_pick_index(order, idx, dtype),
        "draft_type": dtype,
        "team_count": len(order),
    }


def team_roster_is_full(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    draft_completed: bool = False,
) -> bool:
    cap = total_roster_slots(rules)
    if cap <= 0:
        return False
    used = len(occupying_roster(rules, roster, draft_completed=draft_completed))
    return used >= cap


def all_rosters_full(league_id: str, rules: LeagueRules) -> bool:
    from src.draft_hub import storage

    cap = total_roster_slots(rules)
    if cap <= 0:
        return False
    for team in storage.list_league_teams(league_id):
        roster = storage.list_team_roster(league_id, team["id"])
        if len(occupying_roster(rules, roster, draft_completed=False)) < cap:
            return False
    return True
