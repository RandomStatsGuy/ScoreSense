"""Persist contract year tick when a league marks the draft completed."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.contract_typing import (
    advance_roster_contracts_for_draft_complete,
    rewind_roster_contracts_after_draft_reset,
)
from src.draft_hub.schemas import LeagueRules


def tick_contracts_on_draft_complete(league_id: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        return {"advanced": 0, "expired": 0, "updates": []}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    ws_id = storage.roster_workspace_for_league(league)
    by_team = storage.list_league_rosters_by_team(league_id)
    roster: list[dict[str, Any]] = []
    for rows in by_team.values():
        roster.extend(rows)
    if not roster and ws_id:
        roster = storage.list_roster(ws_id)

    summary = advance_roster_contracts_for_draft_complete(rules, roster)
    for item in summary["updates"]:
        pid = item["player_id"]
        if item.get("expired"):
            storage.remove_roster_slot(ws_id, pid)
            continue
        contract = item["contract"]
        storage.update_roster_slot(
            ws_id,
            pid,
            contract=contract,
            any_team=True,
        )
    return summary


def rewind_contracts_on_draft_reset(league_id: str) -> dict[str, Any]:
    """Best-effort undo of tick_contracts_on_draft_complete for keepers still rostered."""
    league = storage.get_league(league_id)
    if not league:
        return {"rewound": 0, "updates": []}
    ws_id = storage.roster_workspace_for_league(league)
    by_team = storage.list_league_rosters_by_team(league_id)
    roster: list[dict[str, Any]] = []
    for rows in by_team.values():
        roster.extend(rows)
    if not roster and ws_id:
        roster = storage.list_roster(ws_id)

    summary = rewind_roster_contracts_after_draft_reset(roster)
    for item in summary["updates"]:
        storage.update_roster_slot(
            ws_id,
            item["player_id"],
            contract=item["contract"],
            any_team=True,
        )
    return summary
