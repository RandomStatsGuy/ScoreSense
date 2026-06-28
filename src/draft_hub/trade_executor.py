"""Execute cross-team trades in a shared league workspace."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.rules_engine import validate_roster
from src.draft_hub.schemas import LeagueRules


def execute_league_trade(
    league_id: str,
    *,
    team_a_id: str,
    team_b_id: str,
    send_a: list[str],
    send_b: list[str],
) -> dict[str, Any]:
    if team_a_id == team_b_id:
        raise ValueError("Cannot trade with the same team")
    if not send_a and not send_b:
        raise ValueError("Trade must include at least one player")
    if set(send_a) & set(send_b):
        raise ValueError("Same player cannot be on both sides")

    league = storage.get_league(league_id)
    if not league or not league.get("workspace_id"):
        raise ValueError("League not found")
    ws_id = str(league["workspace_id"])
    rules = LeagueRules.model_validate(league["rules"])
    teams = {t["id"]: t for t in storage.list_league_teams(league_id)}
    if team_a_id not in teams or team_b_id not in teams:
        raise ValueError("Invalid team id")

    roster_a = {str(r["player_id"]): r for r in storage.list_team_roster(league_id, team_a_id)}
    roster_b = {str(r["player_id"]): r for r in storage.list_team_roster(league_id, team_b_id)}

    for pid in send_a:
        if pid not in roster_a:
            raise ValueError(f"Player {pid} not on team A roster")
    for pid in send_b:
        if pid not in roster_b:
            raise ValueError(f"Player {pid} not on team B roster")

    storage.transfer_roster_players(ws_id, send_a, team_a_id, team_b_id)
    storage.transfer_roster_players(ws_id, send_b, team_b_id, team_a_id)

    storage.log_league_trade(
        league_id,
        team_a_id=team_a_id,
        team_b_id=team_b_id,
        send_a=send_a,
        send_b=send_b,
    )

    new_a = storage.list_team_roster(league_id, team_a_id)
    new_b = storage.list_team_roster(league_id, team_b_id)
    errors_a = validate_roster(rules, new_a)
    errors_b = validate_roster(rules, new_b)
    errors = errors_a + errors_b

    return {
        "team_a": {"team_id": team_a_id, "roster": new_a, "validation_errors": errors_a},
        "team_b": {"team_id": team_b_id, "roster": new_b, "validation_errors": errors_b},
        "validation_errors": errors,
    }
