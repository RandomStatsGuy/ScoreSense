"""Preview/correct persisted SCORE-38 inflated rookie years.

A pre-fix backfill stored years_exp=1 rookies as 2 years remaining. The live
formula is rookie_years - years_exp (1). Re-running backfill will not lower
an already-typed rookie row — this command does, with an explicit preview.
"""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.contract_typing import apply_type_to_contract, suggested_rookie_years_pre_draft
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.years_exp_lookup import years_exp_for_player


def _years_remaining(row: dict[str, Any]) -> int:
    contract = row.get("contract") or {}
    return int(contract.get("years_remaining") or row.get("contract_years") or 1)


def is_inflated_rookie_year_row(
    rules: LeagueRules,
    row: dict[str, Any],
    *,
    years_exp: int | None = None,
) -> bool:
    contract = dict(row.get("contract") or {})
    if str(contract.get("contract_type") or "") != "rookie":
        return False
    if contract.get("contract_type_manual"):
        return False
    exp = years_exp
    if exp is None:
        exp = years_exp_for_player(row=row)
    inferred = str(contract.get("inferred_from") or "")
    if exp is None and inferred.startswith("nfl_yr_"):
        try:
            exp = int(inferred.removeprefix("nfl_yr_"))
        except ValueError:
            exp = None
    if exp is None:
        return False
    suggested = suggested_rookie_years_pre_draft(rules, years_exp=exp)
    if suggested is None:
        return False
    return _years_remaining(row) > int(suggested)


def preview_inflated_rookie_years(league_id: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    rules = LeagueRules.model_validate(league.get("rules") or {})
    rows: list[dict[str, Any]] = []
    for team_rows in storage.list_league_rosters_by_team(league_id).values():
        rows.extend(team_rows)
    findings: list[dict[str, Any]] = []
    for row in rows:
        exp = years_exp_for_player(row=row)
        if not is_inflated_rookie_year_row(rules, row, years_exp=exp):
            continue
        suggested = suggested_rookie_years_pre_draft(rules, years_exp=exp)
        findings.append(
            {
                "player_id": row.get("player_id"),
                "player_name": row.get("player_name"),
                "team_id": row.get("team_id"),
                "years_exp": exp,
                "years_remaining": _years_remaining(row),
                "suggested_years": suggested,
            }
        )
    return {
        "league_id": league_id,
        "count": len(findings),
        "rows": findings,
    }


def apply_inflated_rookie_year_corrections(
    league_id: str,
    *,
    edited_by_sub: str | None = None,
    player_ids: list[str] | None = None,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    rules = LeagueRules.model_validate(league.get("rules") or {})
    ws_id = storage.roster_workspace_for_league(league)
    preview = preview_inflated_rookie_years(league_id)
    wanted = {str(pid) for pid in (player_ids or [])} if player_ids else None
    updated: list[dict[str, Any]] = []
    for item in preview["rows"]:
        pid = str(item["player_id"])
        if wanted is not None and pid not in wanted:
            continue
        row = storage.get_roster_slot(ws_id, pid)
        if not row:
            continue
        exp = item.get("years_exp")
        suggested = int(item["suggested_years"])
        contract = apply_type_to_contract(
            rules,
            row,
            contract_type="rookie",
            years_remaining=suggested,
            years_exp=exp,
            manual=False,
            clear_pending=False,
        )
        storage.update_roster_slot(
            ws_id,
            pid,
            contract=contract,
            any_team=True,
            edited_by_sub=edited_by_sub,
            note="SCORE-38 inflated rookie year correction",
        )
        updated.append({**item, "years_remaining": suggested})
    return {
        "league_id": league_id,
        "corrected": len(updated),
        "rows": updated,
    }
