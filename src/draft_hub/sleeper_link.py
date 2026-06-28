"""Workspace / league Sleeper link — persist team metadata and sync roster snapshots."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.contracts import build_veteran_contract
from src.draft_hub.hub_context import resolve_hub_context, roster_scope
from src.draft_hub.league_sleeper_sync import (
    connect_sleeper_league,
    merge_sleeper_team_roster,
    reattach_league_roster_slots,
    sync_league_from_sleeper,
    sync_team_sleeper_to_league,
)
from src.integrations.sleeper_league import fetch_linked_roster, list_league_teams


def link_sleeper_team(
    user_sub: str,
    *,
    sleeper_league_id: str,
    sleeper_roster_id: str,
    sleeper_team_name: str | None = None,
    import_to_hub: bool = True,
) -> dict[str, Any]:
    ctx = resolve_hub_context(user_sub)
    snapshot = fetch_linked_roster(sleeper_league_id, sleeper_roster_id)
    team_name = sleeper_team_name or snapshot["team_name"]

    if ctx.get("mode") == "league" and ctx.get("league_id") and ctx.get("team_id"):
        league_id = str(ctx["league_id"])
        team_id = str(ctx["team_id"])
        league = storage.get_league(league_id)
        if not league:
            raise ValueError("League not found")

        league_sl = league.get("sleeper_league_id")
        if league_sl and str(league_sl) != str(sleeper_league_id):
            raise ValueError(
                "This Draft Hub league is tied to a different Sleeper league. "
                "All managers must link the same Sleeper league."
            )
        if not league_sl:
            storage.update_league_sleeper_id(league_id, str(sleeper_league_id))

        storage.update_team_sleeper_link(
            team_id,
            sleeper_roster_id=str(sleeper_roster_id),
            sleeper_team_name=team_name,
            sleeper_player_ids=snapshot["player_ids"],
        )
        # Keep personal workspace link in sync for value-sheet highlighting.
        storage.update_sleeper_link(
            user_sub,
            sleeper_league_id=str(sleeper_league_id),
            sleeper_roster_id=str(sleeper_roster_id),
            sleeper_team_name=team_name,
            sleeper_player_ids=snapshot["player_ids"],
            sleeper_mapping=snapshot.get("mapping") or snapshot["players"],
        )

        imported = 0
        trades = 0
        teams_synced = 0
        full_league_import = False
        if import_to_hub:
            if ctx.get("is_commissioner"):
                sl_meta = list_league_teams(str(sleeper_league_id))
                sleeper_team_count = len(sl_meta.get("teams") or [])
                hub_teams = storage.list_league_teams(league_id)
                linked_count = sum(1 for t in hub_teams if t.get("sleeper_roster_id"))
                if linked_count < sleeper_team_count:
                    from src.draft_hub.league_sleeper_sync import ensure_sleeper_team_links

                    full = ensure_sleeper_team_links(league_id)
                    teams_synced = int(full.get("teams_synced") or 0)
                    imported = sum(int(t.get("player_count") or 0) for t in full.get("teams") or [])
                    trades = int(full.get("trade_count") or 0)
                    full_league_import = True
                else:
                    result = sync_team_sleeper_to_league(league_id, team_id, run_league_trade_scan=True)
                    imported = len(snapshot.get("players") or [])
                    trades = int(result.get("trade_count") or 0)
            else:
                result = sync_team_sleeper_to_league(league_id, team_id, run_league_trade_scan=True)
                imported = len(snapshot.get("players") or [])
                trades = int(result.get("trade_count") or 0)
        return {
            "mode": "league",
            "league_id": league_id,
            "team_id": team_id,
            "imported_to_hub": imported,
            "trade_count": trades,
            "teams_synced": teams_synced,
            "full_league_import": full_league_import,
            "snapshot": snapshot,
            "hub_context": resolve_hub_context(user_sub),
        }

    ws = storage.update_sleeper_link(
        user_sub,
        sleeper_league_id=str(sleeper_league_id),
        sleeper_roster_id=str(sleeper_roster_id),
        sleeper_team_name=team_name,
        sleeper_player_ids=snapshot["player_ids"],
        sleeper_native_ids=snapshot.get("sleeper_player_ids") or [],
        sleeper_mapping=snapshot.get("mapping") or snapshot["players"],
    )
    imported = 0
    if import_to_hub:
        result = sync_sleeper_roster(user_sub, import_to_hub=True)
        imported = int(result.get("imported_to_hub") or 0)
        ws = result.get("workspace") or ws
    return {"mode": "solo", "workspace": ws, "imported_to_hub": imported, "snapshot": snapshot}


def get_sleeper_context(user_sub: str) -> dict[str, Any]:
    ctx = resolve_hub_context(user_sub)
    if ctx.get("mode") == "league":
        linked = bool(ctx.get("sleeper_roster_id"))
        return {
            "linked": linked,
            "mode": "league",
            "league_id": ctx.get("league_id"),
            "league_name": ctx.get("league_name"),
            "team_id": ctx.get("team_id"),
            "team_name": ctx.get("team_name"),
            "sleeper_league_id": ctx.get("sleeper_league_id"),
            "sleeper_roster_id": ctx.get("sleeper_roster_id"),
            "sleeper_team_name": ctx.get("sleeper_team_name"),
            "is_commissioner": ctx.get("is_commissioner"),
        }
    ws = storage.get_or_create_workspace(user_sub)
    link = storage.sleeper_link_from_workspace(ws)
    if not link.get("sleeper_league_id") or not link.get("sleeper_roster_id"):
        return {"linked": False, "mode": "solo", **link}
    return {"linked": True, "mode": "solo", **link}


def sync_sleeper_roster(user_sub: str, *, import_to_hub: bool = False) -> dict[str, Any]:
    ctx = resolve_hub_context(user_sub)
    if ctx.get("mode") == "league" and ctx.get("league_id") and ctx.get("team_id"):
        league_id = str(ctx["league_id"])
        team_id = str(ctx["team_id"])
        team = storage.get_team(team_id)
        if not team or not team.get("sleeper_roster_id"):
            raise ValueError("Link your Sleeper team to this Draft Hub league first.")
        if import_to_hub:
            league = storage.get_league(league_id)
            sleeper_league_id = str((league or {}).get("sleeper_league_id") or ctx.get("sleeper_league_id") or "")
            if ctx.get("is_commissioner") and sleeper_league_id:
                sl_meta = list_league_teams(sleeper_league_id)
                sleeper_team_count = len(sl_meta.get("teams") or [])
                hub_teams = storage.list_league_teams(league_id)
                linked_count = sum(1 for t in hub_teams if t.get("sleeper_roster_id"))
                if linked_count < sleeper_team_count:
                    from src.draft_hub.league_sleeper_sync import ensure_sleeper_team_links

                    full = ensure_sleeper_team_links(league_id)
                    return {
                        "mode": "league",
                        "hub_context": resolve_hub_context(user_sub),
                        "trade_count": int(full.get("trade_count") or 0),
                        "trades_applied": full.get("trades_applied", []),
                        "teams_synced": int(full.get("teams_synced") or 0),
                        "full_league_import": True,
                        "imported_to_hub": sum(int(t.get("player_count") or 0) for t in full.get("teams") or []),
                        "message": full.get("message"),
                    }
            result = sync_team_sleeper_to_league(league_id, team_id, run_league_trade_scan=True)
            return {
                "mode": "league",
                "hub_context": resolve_hub_context(user_sub),
                "trade_count": result.get("trade_count", 0),
                "trades_applied": result.get("trades_applied", []),
                "snapshot": result.get("snapshot"),
                "imported_to_hub": len((result.get("snapshot") or {}).get("players") or []),
            }
        snapshot = fetch_linked_roster(
            str(ctx.get("sleeper_league_id") or ""),
            str(team["sleeper_roster_id"]),
        )
        storage.update_team_sleeper_link(
            team_id,
            sleeper_player_ids=snapshot["player_ids"],
            sleeper_team_name=snapshot["team_name"],
        )
        return {"mode": "league", "snapshot": snapshot, "imported_to_hub": 0}

    ws = storage.get_or_create_workspace(user_sub)
    link = storage.sleeper_link_from_workspace(ws)
    league_id = link.get("sleeper_league_id")
    roster_id = link.get("sleeper_roster_id")
    if not league_id or not roster_id:
        raise ValueError("Link a Sleeper league and team first.")

    snapshot = fetch_linked_roster(league_id, roster_id)
    updated = storage.update_sleeper_link(
        user_sub,
        sleeper_player_ids=snapshot["player_ids"],
        sleeper_native_ids=snapshot.get("sleeper_player_ids") or [],
        sleeper_mapping=snapshot.get("mapping") or snapshot["players"],
        sleeper_team_name=snapshot["team_name"],
    )
    imported = 0
    pruned = 0
    if import_to_hub:
        ws_id, team_id = roster_scope(ctx)
        pruned = storage.prune_solo_roster_junk(ws_id)
        if not team_id:
            pruned += storage.remove_solo_placeholder_imports(
                ws_id,
                preserve_player_ids=set(snapshot["player_ids"]),
            )
        players = snapshot.get("players") or []
        if team_id:
            stats = merge_sleeper_team_roster(ws_id, team_id, players)
            imported = stats["added"] + stats["updated"]
        else:
            rows = []
            for p in players:
                contract = build_veteran_contract(1, 1)
                rows.append(
                    {
                        "player_id": p["player_id"],
                        "player_name": p["player_name"],
                        "team": p["team"],
                        "position": p["position"],
                        "salary": contract["current_salary"],
                        "contract_years": 1,
                        "sleeper_player_id": p["sleeper_player_id"],
                        "source": "sleeper",
                        "contract": contract,
                    }
                )
            imported = storage.import_roster_snapshot(ws_id, None, rows, replace_source="sleeper")

    return {
        "mode": "solo",
        "workspace": updated,
        "snapshot": snapshot,
        "imported_to_hub": imported,
        "pruned_junk": pruned,
    }


def sync_league_sleeper(league_id: str, user_sub: str) -> dict[str, Any]:
    """Full league sync — any member can trigger; requires all teams linked for best results."""
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    team = storage.get_team_by_user(league_id, user_sub)
    if not team:
        raise ValueError("You are not in this league")
    return sync_league_from_sleeper(league_id)


def sleeper_player_id_set(user_sub: str) -> set[str]:
    ctx = get_sleeper_context(user_sub)
    if not ctx.get("linked"):
        return set()
    if ctx.get("mode") == "league":
        team = storage.get_team(str(ctx.get("team_id")))
        return set((team or {}).get("sleeper_player_ids") or [])
    return set(ctx.get("sleeper_player_ids") or [])


def discover_teams(sleeper_league_id: str) -> dict[str, Any]:
    return list_league_teams(sleeper_league_id)


def repair_solo_roster(user_sub: str) -> dict[str, Any]:
    """Drop bad solo rows left by legacy Sleeper imports; reattach orphans in league mode."""
    ctx = resolve_hub_context(user_sub)
    if ctx.get("mode") == "league" and ctx.get("league_id"):
        league_id = str(ctx["league_id"])
        ws_id, team_id = roster_scope(ctx)
        reattach = reattach_league_roster_slots(league_id)
        synced = None
        league = storage.get_league(league_id)
        if league and league.get("sleeper_league_id"):
            try:
                synced = sync_league_from_sleeper(league_id)
            except ValueError:
                synced = None
        roster = storage.list_roster(ws_id, team_id)
        return {
            "mode": "league",
            "pruned_junk": 0,
            "removed_sleeper": 0,
            "reattach": reattach,
            "sync": synced,
            "roster_count": len(roster),
            "sleeper": get_sleeper_context(user_sub),
        }
    ws = storage.get_or_create_workspace(user_sub)
    link_ctx = get_sleeper_context(user_sub)
    preserve = set(link_ctx.get("sleeper_player_ids") or []) if link_ctx.get("linked") else set()
    pruned = storage.prune_solo_roster_junk(ws["id"])
    pruned += storage.remove_solo_placeholder_imports(ws["id"], preserve_player_ids=preserve)
    removed_sleeper = storage.remove_roster_by_source(ws["id"], "sleeper")
    return {
        "mode": "solo",
        "pruned_junk": pruned,
        "removed_sleeper": removed_sleeper,
        "sleeper": get_sleeper_context(user_sub),
    }
