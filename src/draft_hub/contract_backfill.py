"""Persist inferred contract types / pre-draft year fixes for mistagged rows."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.contract_typing import backfill_row_contract
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.years_exp_lookup import years_exp_for_player


def backfill_roster_contracts(
    workspace_id: str,
    rules: LeagueRules,
    *,
    season: int,
    draft_completed: bool,
    roster: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    rows = roster if roster is not None else storage.list_roster(workspace_id)
    fixed = 0
    for row in rows:
        if str(row.get("roster_status") or "active") != "active":
            continue
        exp = years_exp_for_player(row=row)
        updated = backfill_row_contract(
            rules,
            row,
            season=season,
            draft_completed=draft_completed,
            years_exp=exp,
        )
        if not updated:
            continue
        storage.update_roster_slot(
            workspace_id,
            row["player_id"],
            contract=updated,
            any_team=True,
        )
        fixed += 1
    return {"fixed": fixed}


def backfill_league_contracts(league_id: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        return {"fixed": 0}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    ws_id = storage.roster_workspace_for_league(league)
    season = int(league.get("season") or 2026)
    draft_completed = bool(league.get("draft_completed"))
    by_team = storage.list_league_rosters_by_team(league_id)
    roster: list[dict[str, Any]] = []
    for rows in by_team.values():
        roster.extend(rows)
    if not roster:
        roster = storage.list_roster(ws_id)
    return backfill_roster_contracts(
        ws_id,
        rules,
        season=season,
        draft_completed=draft_completed,
        roster=roster,
    )
