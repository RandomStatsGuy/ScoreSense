"""Resolve whether a user operates in solo prep mode or a shared Draft Hub league."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.acquisition_window import attach_acquisition_window
from src.draft_hub.schemas import LeagueRules

_MAX_TEAM_ROSTER_BEFORE_RECONCILE = 28


def _maybe_reattach_league_orphans(ctx: dict[str, Any]) -> None:
    if ctx.get("mode") != "league" or not ctx.get("league_id"):
        return
    ws_id = str(ctx["workspace_id"])
    if not storage.list_orphan_roster_slots(ws_id):
        return
    from src.draft_hub.league_sleeper_sync import reattach_league_roster_slots

    reattach_league_roster_slots(str(ctx["league_id"]))


def _maybe_reconcile_league_rosters(ctx: dict[str, Any]) -> None:
    if ctx.get("mode") != "league" or not ctx.get("league_id"):
        return
    ws_id = str(ctx["workspace_id"])
    league_id = str(ctx["league_id"])
    team_id = str(ctx.get("team_id") or "")
    needs_reconcile = False
    if team_id and len(storage.list_roster(ws_id, team_id)) > _MAX_TEAM_ROSTER_BEFORE_RECONCILE:
        needs_reconcile = True
    else:
        for team in storage.list_league_teams(league_id):
            if len(storage.list_roster(ws_id, str(team["id"]))) > _MAX_TEAM_ROSTER_BEFORE_RECONCILE:
                needs_reconcile = True
                break
    if not needs_reconcile:
        return
    from src.draft_hub.league_sleeper_sync import reconcile_league_roster_assignments

    reconcile_league_roster_assignments(league_id)


def _filter_roster_to_team_membership(
    ctx: dict[str, Any],
    roster: list[dict[str, Any]],
    *,
    use_live_allowlist: bool = False,
) -> list[dict[str, Any]]:
    """Hide Sleeper rows that belong on another manager's team snapshot."""
    if ctx.get("mode") != "league" or not ctx.get("team_id"):
        return roster
    team = storage.get_team(str(ctx["team_id"]))
    if not team:
        return roster
    live_allowlist = None
    if use_live_allowlist and ctx.get("league_id"):
        from src.draft_hub.league_sleeper_sync import team_sleeper_allowlist

        try:
            live_allowlist = team_sleeper_allowlist(str(ctx["league_id"]), str(ctx["team_id"]))
        except Exception:
            live_allowlist = None
    return filter_team_sleeper_roster(team, roster, live_allowlist=live_allowlist)


def filter_team_sleeper_roster(
    team: dict[str, Any],
    roster: list[dict[str, Any]],
    *,
    live_allowlist: set[str] | None = None,
) -> list[dict[str, Any]]:
    stored = {str(pid) for pid in (team.get("sleeper_player_ids") or []) if pid}
    if live_allowlist is not None:
        allowed = set(live_allowlist)
    elif team.get("sleeper_roster_id") and len(stored) <= _MAX_TEAM_ROSTER_BEFORE_RECONCILE:
        allowed = stored
    elif team.get("sleeper_roster_id"):
        allowed = set()
    else:
        allowed = stored

    if not team.get("sleeper_roster_id") and not allowed:
        return roster

    if team.get("sleeper_roster_id") and not allowed:
        return [r for r in roster if str(r.get("source") or "") != "sleeper"]

    filtered: list[dict[str, Any]] = []
    for row in roster:
        source = str(row.get("source") or "")
        if source != "sleeper":
            filtered.append(row)
            continue
        pid = str(row.get("player_id") or "")
        spid = str(row.get("sleeper_player_id") or "")
        if pid in allowed or spid in allowed:
            filtered.append(row)
    return filtered


def resolve_hub_context(user_sub: str) -> dict[str, Any]:
    ws = storage.get_or_create_workspace(user_sub)
    membership = storage.resolve_league_membership(user_sub)
    focus = ws.get("active_league_id")
    hub_focus = "solo" if focus == storage.HUB_FOCUS_SOLO else ("league" if membership else "auto")
    if membership:
        league, team = membership
        league_ws_id = storage.roster_workspace_for_league(league)
        rules = LeagueRules.model_validate(league["rules"])
        is_primary = str(league["commissioner_sub"]) == str(user_sub)
        is_staff = is_primary or bool(team.get("is_commissioner"))
        from src.draft_hub.owner_display import attach_owner_names_to_teams

        attach_owner_names_to_teams(str(league["id"]), [team], season_year=league.get("season"))
        return _with_permissions({
            "mode": "league",
            "hub_focus": hub_focus,
            "workspace_id": league_ws_id,
            "personal_workspace_id": ws["id"],
            "league_id": league["id"],
            "league_name": league["name"],
            "league_room_code": league["room_code"],
            "league_status": league["status"],
            "team_id": team["id"],
            "team_name": team["name"],
            "owner_name": team.get("owner_name"),
            "is_commissioner": is_staff,
            "is_primary_commissioner": is_primary,
            "lock_team_claims": bool(league.get("lock_team_claims", True)),
            "draft_completed": bool(league.get("draft_completed", False)),
            "draft_starts_at": league.get("draft_starts_at"),
            "draft_timezone": league.get("draft_timezone"),
            "rules": rules.model_dump(),
            "season": int(league["season"]),
            "sleeper_league_id": league.get("sleeper_league_id"),
            "sleeper_roster_id": team.get("sleeper_roster_id"),
            "sleeper_team_name": team.get("sleeper_team_name"),
            "atmosphere": (ws.get("prefs") or {}).get("atmosphere") or "none",
            "team_identity": team.get("identity") or {},
        })
    rules = LeagueRules.model_validate(ws["rules"])
    link = storage.sleeper_link_from_workspace(ws)
    return _with_permissions({
        "mode": "solo",
        "hub_focus": hub_focus,
        "workspace_id": ws["id"],
        "personal_workspace_id": ws["id"],
        "league_id": None,
        "is_commissioner": True,
        "is_primary_commissioner": True,
        "draft_completed": False,
        "rules": rules.model_dump(),
        "season": int(ws["season"]),
        "atmosphere": (ws.get("prefs") or {}).get("atmosphere") or "none",
        "team_identity": {},
        **link,
    })


def _with_permissions(ctx: dict[str, Any]) -> dict[str, Any]:
    is_comm = bool(ctx.get("is_commissioner"))
    in_league = ctx.get("mode") == "league"
    ctx["can_edit_salaries"] = (not in_league) or is_comm
    ctx["can_edit_rules"] = (not in_league) or is_comm
    ctx["can_import_league_sheet"] = (not in_league) or is_comm
    ctx["can_invite_members"] = in_league and is_comm
    ctx["can_manage_roster"] = (not in_league) or is_comm
    ctx.setdefault("is_primary_commissioner", is_comm and not in_league)
    return attach_acquisition_window(ctx)


def list_roster_for_context(
    ctx: dict[str, Any],
    *,
    live_sleeper: bool = False,
    sync_maintenance: bool = False,
) -> list[dict[str, Any]]:
    """Roster tab / cap sheet — always the signed-in manager's team, even for commissioners."""
    if sync_maintenance:
        _maybe_reattach_league_orphans(ctx)
        _maybe_reconcile_league_rosters(ctx)

    ws_id = str(ctx["workspace_id"])
    _ws_id, team_id = roster_scope(ctx)
    roster = storage.list_roster(ws_id, team_id)

    if (
        live_sleeper
        and ctx.get("mode") == "league"
        and ctx.get("league_id")
        and team_id
        and ctx.get("sleeper_roster_id")
    ):
        from src.draft_hub.league_sleeper_sync import compose_team_roster_from_live_snapshot

        return compose_team_roster_from_live_snapshot(
            str(ctx["league_id"]),
            str(team_id),
            ws_id,
            roster,
        )

    return _filter_roster_to_team_membership(ctx, roster, use_live_allowlist=live_sleeper)


def roster_scope(ctx: dict[str, Any]) -> tuple[str, str | None]:
    """(workspace_id, team_id) for roster/cap queries."""
    if ctx.get("mode") == "league" and ctx.get("team_id"):
        return str(ctx["workspace_id"]), str(ctx["team_id"])
    return str(ctx["workspace_id"]), None
