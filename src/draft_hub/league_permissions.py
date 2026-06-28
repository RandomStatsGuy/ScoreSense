"""Commissioner vs member permissions for shared leagues."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException


def is_commissioner(ctx: dict[str, Any]) -> bool:
    return bool(ctx.get("mode") == "league" and ctx.get("is_commissioner"))


def is_league_member(ctx: dict[str, Any]) -> bool:
    return bool(ctx.get("mode") == "league" and ctx.get("team_id"))


def require_commissioner(ctx: dict[str, Any]) -> None:
    if not is_commissioner(ctx):
        raise HTTPException(status_code=403, detail="Only the league commissioner can do this")


def require_league_member(ctx: dict[str, Any]) -> None:
    if not is_league_member(ctx):
        raise HTTPException(status_code=403, detail="Join a league first")


def can_edit_roster(ctx: dict[str, Any], *, player_team_id: str | None = None) -> bool:
    """Commissioner edits all contracts; members only their team."""
    if ctx.get("mode") != "league":
        return True
    if is_commissioner(ctx):
        return True
    my_team = ctx.get("team_id")
    if not my_team:
        return False
    if player_team_id is None:
        return True
    return str(player_team_id) == str(my_team)


def can_edit_league_rules(ctx: dict[str, Any]) -> bool:
    if ctx.get("mode") != "league":
        return True
    return is_commissioner(ctx)


def can_import_league_sheet(ctx: dict[str, Any]) -> bool:
    return can_edit_league_rules(ctx)
