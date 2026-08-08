"""Read-only preview of who expires before draft vs who is retained as keepers."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.pre_draft_cap import (
    expires_before_draft,
    retained_through_draft,
    years_remaining,
)


def _brief(row: dict[str, Any], team: dict[str, Any] | None) -> dict[str, Any]:
    contract = row.get("contract") or {}
    return {
        "player_id": row.get("player_id"),
        "player_name": row.get("player_name"),
        "position": row.get("position"),
        "team_id": row.get("team_id") or (team or {}).get("id"),
        "team_name": (team or {}).get("name"),
        "salary": row.get("salary"),
        "years_remaining": years_remaining(row),
        "contract_type": contract.get("contract_type") or "veteran",
        "source": row.get("source"),
        "roster_status": row.get("roster_status") or "active",
        "acquisition_type": (contract.get("acquisition_type") or row.get("acquisition_type")),
    }


def build_draft_expire_preview(league_id: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    draft_completed = bool(league.get("draft_completed"))
    teams = {str(t["id"]): t for t in storage.list_league_teams(league_id)}
    by_team = storage.list_league_rosters_by_team(league_id)

    retained: list[dict[str, Any]] = []
    expire: list[dict[str, Any]] = []
    other: list[dict[str, Any]] = []

    for tid, rows in by_team.items():
        team = teams.get(str(tid))
        for row in rows:
            brief = _brief(row, team)
            if retained_through_draft(row, draft_completed=draft_completed):
                retained.append(brief)
            elif expires_before_draft(row, draft_completed=draft_completed):
                expire.append(brief)
            else:
                # Cuts / inactive — not keepers and not nominatable expirees in the usual sense.
                other.append(brief)

    nominatable = list(expire)
    return {
        "league_id": league_id,
        "draft_completed": draft_completed,
        "retained_count": len(retained),
        "expire_count": len(expire),
        "other_count": len(other),
        "nominatable_count": len(nominatable),
        "retained": retained,
        "expire": expire,
        "other": other,
        "note": (
            "Expire / FA-contract players are eligible to nominate once the draft starts. "
            "They stay on the roster row until End draft ticks years (0 → removed) or you cut them."
        ),
    }
