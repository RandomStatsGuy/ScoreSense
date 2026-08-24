"""League-wide Sleeper sync — merge rosters and move contracts on trades."""

from __future__ import annotations

import time
from typing import Any

from src.draft_hub import storage
from src.draft_hub.contract_typing import apply_type_to_contract, infer_contract_type, suggested_rookie_years_pre_draft
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.years_exp_lookup import years_exp_for_player
from src.integrations.sleeper_league import fetch_all_linked_rosters, fetch_linked_roster, list_league_teams


def _default_contract_for_sleeper_player(
    player: dict[str, Any],
    rules: LeagueRules,
    *,
    season: int,
    draft_completed: bool,
) -> dict[str, Any]:
    exp = years_exp_for_player(row=player)
    ctype = infer_contract_type(
        None,
        rules,
        years_exp=exp,
        season=season,
    )
    yrs = 1
    if ctype == "rookie" and not draft_completed:
        suggested = suggested_rookie_years_pre_draft(rules, years_exp=exp)
        if suggested is not None:
            yrs = suggested
        else:
            yrs = int(rules.contracts.rookie_years)
    elif ctype == "rookie":
        yrs = max(1, int(rules.contracts.rookie_years) - int(exp or 0))
    return apply_type_to_contract(
        rules,
        {"salary": 1, "contract_years": yrs, "contract": {}},
        contract_type=ctype,
        years_remaining=yrs,
        salary=1.0,
        years_exp=exp,
        manual=False,
    )

_ALLOWLIST_CACHE: dict[tuple[str, str], tuple[float, set[str]]] = {}
_SNAPSHOT_CACHE: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
_ALLOWLIST_TTL_SEC = 300
_NAME_REFRESH_AT: dict[str, float] = {}
_NAME_REFRESH_TTL_SEC = 60


def apply_sleeper_display_name(team_id: str, sleeper_name: str) -> bool:
    """Keep Hub team.name in sync with the live Sleeper label, including claimed teams."""
    name = str(sleeper_name or "").strip()
    team = storage.get_team(team_id)
    if not team or not name:
        return False
    old = str(team.get("name") or "").strip()
    changed = old != name
    if str(team.get("sleeper_team_name") or "") != name:
        storage.update_team_sleeper_link(team_id, sleeper_team_name=name)
    if changed:
        storage.update_team_display_name(team_id, name)
        league_id = str(team.get("league_id") or "")
        league = storage.get_league(league_id) if league_id else None
        season = int((league or {}).get("season") or 0)
        if league_id and season and old:
            storage.retarget_owner_season_map_team_name(league_id, season, old, name)
    return changed


def refresh_sleeper_display_names(league_id: str) -> int:
    """Best-effort name-only refresh from Sleeper metadata (no roster overwrite)."""
    now = time.time()
    last = _NAME_REFRESH_AT.get(str(league_id))
    if last and now - last < _NAME_REFRESH_TTL_SEC:
        return 0
    sleeper_lid = resolve_sleeper_league_id(league_id)
    if not sleeper_lid:
        return 0
    try:
        meta = list_league_teams(sleeper_lid)
    except Exception:
        return 0
    _NAME_REFRESH_AT[str(league_id)] = now
    by_roster = {str(t.get("roster_id")): t for t in meta.get("teams") or []}
    updated = 0
    for team in storage.list_league_teams(league_id):
        rid = str(team.get("sleeper_roster_id") or "")
        if not rid:
            continue
        st = by_roster.get(rid)
        if not st:
            continue
        new_name = str(st.get("team_name") or "").strip()
        if new_name and apply_sleeper_display_name(str(team["id"]), new_name):
            updated += 1
    return updated


def _snapshot_players(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    return list(snapshot.get("players") or [])


def merge_sleeper_team_roster(
    workspace_id: str,
    team_id: str,
    players: list[dict[str, Any]],
    *,
    rules: LeagueRules | None = None,
    season: int | None = None,
    draft_completed: bool = False,
) -> dict[str, int]:
    """Add new Sleeper pickups; refresh names/teams without overwriting contracts."""
    rules = rules or LeagueRules()
    season = int(season or 2026)
    added = 0
    updated = 0
    for p in players:
        pid = str(p["player_id"])
        existing = storage.get_roster_slot(workspace_id, pid)
        if existing:
            existing_tid = str(existing.get("team_id") or "")
            target_tid = str(team_id)
            if existing_tid != target_tid:
                storage.move_roster_player(workspace_id, pid, target_tid)
            storage.update_roster_metadata(
                workspace_id,
                pid,
                player_name=p.get("player_name"),
                team=p.get("team"),
                position=p.get("position"),
                sleeper_player_id=p.get("sleeper_player_id"),
            )
            updated += 1
            continue
        contract = _default_contract_for_sleeper_player(
            p,
            rules,
            season=season,
            draft_completed=draft_completed,
        )
        storage.add_roster_slot(
            workspace_id,
            {
                "player_id": pid,
                "player_name": p.get("player_name"),
                "team": p.get("team"),
                "position": p.get("position"),
                "salary": contract["current_salary"],
                "contract_years": contract["years_remaining"],
                "sleeper_player_id": p.get("sleeper_player_id"),
                "source": "sleeper",
                "contract": contract,
            },
            team_id=team_id,
        )
        added += 1
    return {"added": added, "updated": updated}


def invalidate_team_allowlist_cache(league_id: str | None = None) -> None:
    if league_id is None:
        _ALLOWLIST_CACHE.clear()
        _SNAPSHOT_CACHE.clear()
        return
    drop = [k for k in _ALLOWLIST_CACHE if k[0] == str(league_id)]
    for key in drop:
        _ALLOWLIST_CACHE.pop(key, None)
    drop_snap = [k for k in _SNAPSHOT_CACHE if k[0] == str(league_id)]
    for key in drop_snap:
        _SNAPSHOT_CACHE.pop(key, None)


def fetch_team_snapshot_cached(league_id: str, team_id: str) -> dict[str, Any] | None:
    """Live Sleeper roster snapshot for one hub team (cached briefly)."""
    league = storage.get_league(league_id)
    team = storage.get_team(team_id)
    if not league or not team:
        return None
    sleeper_league_id = resolve_sleeper_league_id(league_id)
    roster_id = team.get("sleeper_roster_id")
    if not sleeper_league_id or not roster_id:
        return None

    cache_key = (str(league_id), str(team_id))
    now = time.time()
    cached = _SNAPSHOT_CACHE.get(cache_key)
    if cached and now - cached[0] < _ALLOWLIST_TTL_SEC:
        return cached[1]

    snapshot = fetch_linked_roster(str(sleeper_league_id), str(roster_id))
    _SNAPSHOT_CACHE[cache_key] = (now, snapshot)

    allowed: set[str] = set()
    for pid in snapshot.get("player_ids") or []:
        allowed.add(str(pid))
    for player in snapshot.get("players") or []:
        if player.get("player_id"):
            allowed.add(str(player["player_id"]))
        if player.get("sleeper_player_id"):
            allowed.add(str(player["sleeper_player_id"]))
    _ALLOWLIST_CACHE[cache_key] = (now, allowed)

    live_name = snapshot.get("team_name") or team.get("sleeper_team_name")
    storage.update_team_sleeper_link(
        team_id,
        sleeper_player_ids=snapshot.get("player_ids") or [p["player_id"] for p in snapshot.get("players") or []],
        sleeper_team_name=live_name,
    )
    if live_name:
        apply_sleeper_display_name(str(team_id), str(live_name))
    return snapshot


def resolve_sleeper_league_id(league_id: str) -> str | None:
    league = storage.get_league(league_id)
    if not league:
        return None
    sl = league.get("sleeper_league_id")
    if sl:
        return str(sl)
    comm = league.get("commissioner_sub")
    if comm:
        ws = storage.get_or_create_workspace(comm)
        link = storage.sleeper_link_from_workspace(ws)
        sl = link.get("sleeper_league_id")
        if sl:
            storage.update_league_sleeper_id(league_id, str(sl))
            return str(sl)
    for team in storage.list_league_teams(league_id):
        sub = team.get("user_sub")
        if not sub:
            continue
        ws = storage.get_or_create_workspace(sub)
        link = storage.sleeper_link_from_workspace(ws)
        sl = link.get("sleeper_league_id")
        if sl:
            storage.update_league_sleeper_id(league_id, str(sl))
            return str(sl)
    return None


def resolve_hub_team_for_sleeper_roster(
    league_id: str,
    sleeper_roster_id: str,
    sleeper_team_name: str,
    salary_cap: float,
    used_hub_ids: set[str],
) -> dict[str, Any]:
    hub_teams = storage.list_league_teams(league_id)
    for team in hub_teams:
        if team.get("sleeper_roster_id") and str(team["sleeper_roster_id"]) == str(sleeper_roster_id):
            return team

    sname = str(sleeper_team_name or "").strip()
    key = sname.lower()
    hub_by_sl = {
        str(t.get("sleeper_team_name") or "").lower(): t
        for t in hub_teams
        if t.get("sleeper_team_name")
    }
    hub_by_name = {str(t["name"]).lower(): t for t in hub_teams}

    for candidate in (hub_by_sl.get(key), hub_by_name.get(key)):
        if candidate and str(candidate["id"]) not in used_hub_ids:
            return candidate

    label = sname or f"Sleeper team {sleeper_roster_id}"
    return storage.get_or_create_league_team_by_name(league_id, label, salary_cap)


def compose_team_roster_from_live_snapshot(
    league_id: str,
    team_id: str,
    workspace_id: str,
    db_roster: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Roster tab view for a linked league team: manual adds from DB + Sleeper snapshot only.

    Ignores stale Sleeper rows that were incorrectly stacked on this team_id during import.
    """
    from src.draft_hub.hub_context import filter_team_sleeper_roster

    team = storage.get_team(team_id)
    if not team or not team.get("sleeper_roster_id"):
        return filter_team_sleeper_roster(team or {}, db_roster)

    sleeper_league_id = resolve_sleeper_league_id(league_id)
    if not sleeper_league_id:
        return filter_team_sleeper_roster(team, db_roster)

    try:
        snapshot = fetch_team_snapshot_cached(str(league_id), str(team_id))
        if not snapshot:
            return filter_team_sleeper_roster(team, db_roster)
    except Exception:
        live_allowlist = None
        try:
            live_allowlist = team_sleeper_allowlist(league_id, team_id)
        except Exception:
            pass
        return filter_team_sleeper_roster(team, db_roster, live_allowlist=live_allowlist)

    league = storage.get_league(league_id) or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    season = int(league.get("season") or 2026)
    draft_completed = bool(league.get("draft_completed"))

    manual = [r for r in db_roster if str(r.get("source") or "") != "sleeper"]
    live_players = list(snapshot.get("players") or [])
    live_pids = {str(p["player_id"]) for p in live_players if p.get("player_id")}
    live_spids = {str(p["sleeper_player_id"]) for p in live_players if p.get("sleeper_player_id")}

    db_by_pid = {str(r["player_id"]): r for r in db_roster if r.get("player_id")}
    db_by_sleeper: dict[str, dict[str, Any]] = {}
    for row in db_roster:
        spid = str(row.get("sleeper_player_id") or "")
        if spid:
            db_by_sleeper[spid] = row

    sleeper_rows: list[dict[str, Any]] = []
    seen_sleeper: set[str] = set()
    for player in live_players:
        pid = str(player.get("player_id") or "")
        if not pid:
            continue
        spid = str(player.get("sleeper_player_id") or "")
        dedupe_key = spid or pid
        if dedupe_key in seen_sleeper:
            continue
        seen_sleeper.add(dedupe_key)

        row = db_by_pid.get(pid)
        if not row and spid:
            row = db_by_sleeper.get(spid)
        if row:
            sleeper_rows.append(row)
            continue
        contract = _default_contract_for_sleeper_player(
            player,
            rules,
            season=season,
            draft_completed=draft_completed,
        )
        sleeper_rows.append(
            {
                "player_id": pid,
                "player_name": player.get("player_name"),
                "team": player.get("team"),
                "position": player.get("position"),
                "salary": contract["current_salary"],
                "contract_years": contract["years_remaining"],
                "sleeper_player_id": player.get("sleeper_player_id"),
                "source": "sleeper",
                "contract": contract,
                "roster_status": "active",
                "workspace_id": workspace_id,
                "team_id": team_id,
            }
        )

    manual_only = [
        r
        for r in manual
        if str(r.get("player_id") or "") not in live_pids
        and str(r.get("sleeper_player_id") or "") not in live_spids
    ]
    return manual_only + sleeper_rows


def team_sleeper_allowlist(league_id: str, team_id: str) -> set[str] | None:
    """Live Sleeper player ids for one hub team (cached briefly)."""
    cache_key = (str(league_id), str(team_id))
    now = time.time()
    cached = _ALLOWLIST_CACHE.get(cache_key)
    if cached and now - cached[0] < _ALLOWLIST_TTL_SEC:
        return cached[1]

    snapshot = fetch_team_snapshot_cached(league_id, team_id)
    if not snapshot:
        return None

    cached = _ALLOWLIST_CACHE.get(cache_key)
    return cached[1] if cached else None


def _sync_summary_message(
    team_meta: list[dict[str, Any]],
    reconcile: dict[str, Any],
    merge_stats: dict[str, int],
) -> str:
    moved = int((reconcile or {}).get("moved") or 0)
    teams = len(team_meta)
    players = sum(int(t.get("player_count") or 0) for t in team_meta)
    updated = int((merge_stats or {}).get("updated") or 0)
    added = int((merge_stats or {}).get("added") or 0)
    parts = [f"Synced {teams} Sleeper teams ({players} players on rosters)"]
    if moved:
        parts.append(f"moved {moved} contracts to the correct manager")
    if added or updated:
        parts.append(f"updated {updated + added} roster rows")
    return ". ".join(parts) + "."


def ensure_sleeper_team_links(league_id: str) -> dict[str, Any]:
    """
    Map every Sleeper roster to a hub team, merge snapshots, and reconcile assignments.
    Safe for commissioners who previously imported the whole league onto one team.
    """
    league = storage.get_league(league_id)
    if not league or not league.get("workspace_id"):
        raise ValueError("League not found")
    ws_id = str(league["workspace_id"])
    sleeper_league_id = resolve_sleeper_league_id(league_id)
    if not sleeper_league_id:
        raise ValueError(
            "No Sleeper league linked yet. Open Setup, connect your Sleeper team, then try again."
        )

    cap = float(league["rules"]["salary_cap"])
    sleeper_meta = list_league_teams(sleeper_league_id)
    snapshots = fetch_all_linked_rosters(str(sleeper_league_id))
    invalidate_team_allowlist_cache(league_id)

    team_snapshots: dict[str, list[dict[str, Any]]] = {}
    team_meta: list[dict[str, Any]] = []
    used_hub: set[str] = set()

    for st in sleeper_meta.get("teams") or []:
        rid = str(st["roster_id"])
        snapshot = snapshots.get(rid)
        if not snapshot:
            continue
        team = resolve_hub_team_for_sleeper_roster(
            league_id,
            rid,
            str(st.get("team_name") or snapshot.get("team_name") or "Team"),
            cap,
            used_hub,
        )
        used_hub.add(str(team["id"]))
        players = _snapshot_players(snapshot)
        team_snapshots[str(team["id"])] = players
        storage.update_team_sleeper_link(
            str(team["id"]),
            sleeper_roster_id=rid,
            sleeper_team_name=st.get("team_name") or snapshot.get("team_name"),
            sleeper_player_ids=snapshot.get("player_ids") or [p["player_id"] for p in players],
        )
        live_name = str(st.get("team_name") or snapshot.get("team_name") or "").strip()
        if live_name:
            apply_sleeper_display_name(str(team["id"]), live_name)
        team_meta.append(
            {
                "team_id": team["id"],
                "team_name": (storage.get_team(str(team["id"])) or team).get("name"),
                "player_count": len(players),
            }
        )

    if not team_snapshots:
        raise ValueError("Could not load any Sleeper rosters for this league.")

    moves = detect_and_apply_sleeper_trades(ws_id, team_snapshots)
    rules = LeagueRules.model_validate(league.get("rules") or {})
    season = int(league.get("season") or 2026)
    draft_completed = bool(league.get("draft_completed"))
    merge_stats = {"added": 0, "updated": 0}
    for tid, players in team_snapshots.items():
        stats = merge_sleeper_team_roster(
            ws_id,
            tid,
            players,
            rules=rules,
            season=season,
            draft_completed=draft_completed,
        )
        merge_stats["added"] += stats["added"]
        merge_stats["updated"] += stats["updated"]

    reattach = reattach_league_roster_slots(league_id)
    reconcile = reconcile_league_roster_assignments(league_id)
    from src.draft_hub.contract_backfill import backfill_league_contracts

    backfill = backfill_league_contracts(league_id)
    message = _sync_summary_message(team_meta, reconcile, merge_stats)

    return {
        "league_id": league_id,
        "sleeper_league_id": sleeper_league_id,
        "teams_synced": len(team_meta),
        "teams": team_meta,
        "trades_applied": moves,
        "trade_count": len(moves),
        "merge": merge_stats,
        "reattach": reattach,
        "reconcile": reconcile,
        "backfill": backfill,
        "message": message,
    }


def detect_and_apply_sleeper_trades(
    workspace_id: str,
    team_snapshots: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """
    Compare fresh Sleeper rosters to hub assignments.
    When a player moves between linked teams, move their contract row too.
    """
    prev = storage.roster_player_team_map(workspace_id)
    new_map: dict[str, str] = {}
    for team_id, players in team_snapshots.items():
        for p in players:
            new_map[str(p["player_id"])] = str(team_id)

    moves: list[dict[str, Any]] = []
    for pid, new_team in new_map.items():
        old_team = prev.get(pid)
        if old_team and old_team != new_team:
            slot = storage.move_roster_player(workspace_id, pid, new_team)
            if slot:
                moves.append(
                    {
                        "player_id": pid,
                        "player_name": slot.get("player_name"),
                        "from_team_id": old_team,
                        "to_team_id": new_team,
                    }
                )
    return moves


def _sleeper_player_team_map(teams: list[dict[str, Any]]) -> dict[str, str]:
    """Map Sleeper / ScoreSense player ids → hub team id from stored team metadata."""
    out: dict[str, str] = {}
    for team in teams:
        tid = str(team["id"])
        for sid in team.get("sleeper_player_ids") or []:
            out[str(sid)] = tid
    return out


def _resolve_orphan_target(slot: dict[str, Any], sleeper_to_team: dict[str, str]) -> str | None:
    pid = str(slot["player_id"])
    spid = str(slot.get("sleeper_player_id") or "")
    if spid and spid in sleeper_to_team:
        return sleeper_to_team[spid]
    if pid in sleeper_to_team:
        return sleeper_to_team[pid]
    if spid and f"sleeper-{spid}" in sleeper_to_team:
        return sleeper_to_team[f"sleeper-{spid}"]
    return None


def reattach_league_roster_slots(league_id: str) -> dict[str, Any]:
    """
    Assign orphan roster rows (legacy solo imports) to league teams using Sleeper snapshots.
    """
    league = storage.get_league(league_id)
    if not league or not league.get("workspace_id"):
        return {"reattached": 0, "orphans_remaining": 0}
    ws_id = str(league["workspace_id"])
    orphans = storage.list_orphan_roster_slots(ws_id)
    if not orphans:
        return {"reattached": 0, "orphans_remaining": 0}

    teams = storage.list_league_teams(league_id)
    sleeper_to_team = _sleeper_player_team_map(teams)
    unresolved = [slot for slot in orphans if not _resolve_orphan_target(slot, sleeper_to_team)]

    sleeper_league_id = league.get("sleeper_league_id")
    linked = [t for t in teams if t.get("sleeper_roster_id")]
    if unresolved and sleeper_league_id and linked:
        try:
            roster_to_team = {
                str(t["sleeper_roster_id"]): str(t["id"])
                for t in linked
                if t.get("sleeper_roster_id")
            }
            snapshots = fetch_all_linked_rosters(str(sleeper_league_id))
            for roster_id, snapshot in snapshots.items():
                tid = roster_to_team.get(str(roster_id))
                if not tid:
                    continue
                for player in snapshot.get("players") or []:
                    sleeper_to_team[str(player.get("sleeper_player_id") or "")] = tid
                    sleeper_to_team[str(player.get("player_id") or "")] = tid
        except Exception:
            pass

    reattached = 0
    for slot in orphans:
        target = _resolve_orphan_target(slot, sleeper_to_team)
        if target and storage.move_roster_player(ws_id, str(slot["player_id"]), target):
            reattached += 1

    remaining = len(storage.list_orphan_roster_slots(ws_id))
    return {"reattached": reattached, "orphans_remaining": remaining}


def _player_team_map_from_snapshots(
    teams: list[dict[str, Any]],
    snapshots: dict[str, dict[str, Any]],
) -> dict[str, str]:
    roster_to_hub = {
        str(t["sleeper_roster_id"]): str(t["id"])
        for t in teams
        if t.get("sleeper_roster_id")
    }
    player_to_team: dict[str, str] = {}
    for roster_id, snapshot in snapshots.items():
        tid = roster_to_hub.get(str(roster_id))
        if not tid:
            continue
        for player in snapshot.get("players") or []:
            pid = str(player.get("player_id") or "")
            if pid:
                player_to_team[pid] = tid
            spid = str(player.get("sleeper_player_id") or "")
            if spid:
                player_to_team[spid] = tid
    return player_to_team


def reconcile_league_roster_assignments(league_id: str) -> dict[str, Any]:
    """
    Move roster rows onto the hub team that owns them in Sleeper.

    Fixes legacy imports that stacked an entire Sleeper league on one team_id.
    """
    league = storage.get_league(league_id)
    if not league or not league.get("workspace_id"):
        return {"moved": 0, "skipped": "no_workspace"}
    ws_id = str(league["workspace_id"])
    sleeper_league_id = resolve_sleeper_league_id(league_id)
    if not sleeper_league_id:
        return {"moved": 0, "skipped": "sleeper_not_linked"}

    try:
        snapshots = fetch_all_linked_rosters(str(sleeper_league_id))
        sleeper_meta = {
            str(t["roster_id"]): t
            for t in (list_league_teams(str(sleeper_league_id)).get("teams") or [])
        }
    except Exception as exc:
        return {"moved": 0, "skipped": "fetch_failed", "error": str(exc)}

    cap = float(league["rules"]["salary_cap"])
    used_hub: set[str] = set()
    player_to_team: dict[str, str] = {}
    for roster_id, snapshot in snapshots.items():
        st = sleeper_meta.get(str(roster_id)) or {}
        team = resolve_hub_team_for_sleeper_roster(
            league_id,
            str(roster_id),
            str(st.get("team_name") or snapshot.get("team_name") or "Team"),
            cap,
            used_hub,
        )
        used_hub.add(str(team["id"]))
        tid = str(team["id"])
        for player in snapshot.get("players") or []:
            pid = str(player.get("player_id") or "")
            if pid:
                player_to_team[pid] = tid
            spid = str(player.get("sleeper_player_id") or "")
            if spid:
                player_to_team[spid] = tid

    if not player_to_team:
        return {"moved": 0, "skipped": "empty_map"}

    moved = 0
    for slot in storage.list_league_roster(ws_id):
        # Cap-sheet / manual / draft rows are the hub source of truth. Moving them
        # onto Sleeper-name matches swapped Disappointment ↔ Thanks noob noob when
        # those Sleeper display names drifted from manager_team_map.yaml.
        source = str(slot.get("source") or "").strip().lower()
        if source and source != "sleeper":
            continue
        pid = str(slot.get("player_id") or "")
        if not pid:
            continue
        correct = player_to_team.get(pid)
        if not correct:
            spid = str(slot.get("sleeper_player_id") or "")
            correct = player_to_team.get(spid)
        if not correct:
            continue
        current = str(slot.get("team_id") or "")
        if current != correct and storage.move_roster_player(ws_id, pid, correct):
            moved += 1

    return {"moved": moved, "players_mapped": len(player_to_team)}


def connect_sleeper_league(
    league_id: str,
    sleeper_league_id: str,
    *,
    mappings: list[dict[str, Any]] | None = None,
    commissioner_sleeper_roster_id: str | None = None,
) -> dict[str, Any]:
    """
    Link a Sleeper league to a Draft Hub league, map teams, and import all rosters.
    Commissioner-only. Creates hub teams for unmapped Sleeper rosters.
    """
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    ws_id = league.get("workspace_id")
    if not ws_id:
        raise ValueError("League has no shared workspace")

    existing_sl = league.get("sleeper_league_id")
    if existing_sl and str(existing_sl) != str(sleeper_league_id):
        raise ValueError(
            "This Draft Hub league is already tied to a different Sleeper league. "
            "Disconnect teams first or create a new Draft Hub league."
        )

    sleeper_meta = list_league_teams(sleeper_league_id)
    sleeper_teams = {str(t["roster_id"]): t for t in sleeper_meta.get("teams") or []}
    if not sleeper_teams:
        raise ValueError("No teams found in that Sleeper league")

    rules = league["rules"]
    cap = float(rules.get("salary_cap") or 200)
    hub_teams = storage.list_league_teams(league_id)
    comm_team = next((t for t in hub_teams if t.get("is_commissioner")), None)

    resolved: list[tuple[str, dict[str, Any]]] = []
    if mappings:
        for m in mappings:
            rid = str(m.get("sleeper_roster_id") or "")
            if not rid or rid not in sleeper_teams:
                raise ValueError(f"Unknown Sleeper roster: {rid or '?'}")
            hub_id = m.get("hub_team_id")
            if hub_id:
                team = storage.get_team(str(hub_id))
                if not team or team.get("league_id") != league_id:
                    raise ValueError(f"Hub team not in league: {hub_id}")
            else:
                name = str(m.get("team_name") or sleeper_teams[rid]["team_name"])
                team = storage.get_or_create_league_team_by_name(league_id, name, cap)
            resolved.append((rid, team))
    else:
        hub_by_name = {str(t["name"]).lower(): t for t in hub_teams}
        hub_by_sl_name = {
            str(t.get("sleeper_team_name") or "").lower(): t
            for t in hub_teams
            if t.get("sleeper_team_name")
        }
        used_hub: set[str] = set()
        for rid, st in sorted(sleeper_teams.items(), key=lambda x: x[1]["team_name"].lower()):
            sname = str(st["team_name"])
            team = None
            if commissioner_sleeper_roster_id and rid == str(commissioner_sleeper_roster_id) and comm_team:
                team = comm_team
            elif sname.lower() in hub_by_name and str(hub_by_name[sname.lower()]["id"]) not in used_hub:
                team = hub_by_name[sname.lower()]
            elif sname.lower() in hub_by_sl_name and str(hub_by_sl_name[sname.lower()]["id"]) not in used_hub:
                team = hub_by_sl_name[sname.lower()]
            else:
                team = storage.get_or_create_league_team_by_name(league_id, sname, cap)
            used_hub.add(str(team["id"]))
            apply_sleeper_display_name(str(team["id"]), sname)
            resolved.append((rid, team))

    storage.update_league_sleeper_id(league_id, str(sleeper_league_id))

    all_snapshots = fetch_all_linked_rosters(str(sleeper_league_id))
    team_snapshots: dict[str, list[dict[str, Any]]] = {}
    link_results: list[dict[str, Any]] = []
    for rid, team in resolved:
        snapshot = all_snapshots.get(str(rid))
        if not snapshot:
            raise ValueError(f"Sleeper roster not found: {rid}")
        players = _snapshot_players(snapshot)
        storage.update_team_sleeper_link(
            str(team["id"]),
            sleeper_roster_id=rid,
            sleeper_team_name=snapshot.get("team_name") or sleeper_teams[rid]["team_name"],
            sleeper_player_ids=snapshot.get("player_ids") or [p["player_id"] for p in players],
        )
        team_snapshots[str(team["id"])] = players
        link_results.append(
            {
                "hub_team_id": team["id"],
                "hub_team_name": team.get("name"),
                "sleeper_roster_id": rid,
                "sleeper_team_name": snapshot.get("team_name"),
                "player_count": len(players),
                "sleeper_roster_size": snapshot.get("sleeper_roster_size"),
                "unmatched": len(snapshot.get("unmatched") or []),
            }
        )

    moves = detect_and_apply_sleeper_trades(str(ws_id), team_snapshots)
    merge_stats = {"added": 0, "updated": 0}
    for team_id, players in team_snapshots.items():
        stats = merge_sleeper_team_roster(str(ws_id), team_id, players)
        merge_stats["added"] += stats["added"]
        merge_stats["updated"] += stats["updated"]

    reattach = reattach_league_roster_slots(league_id)
    reconcile = reconcile_league_roster_assignments(league_id)

    return {
        "league_id": league_id,
        "sleeper_league_id": str(sleeper_league_id),
        "sleeper_league_name": sleeper_meta.get("league_name"),
        "teams_connected": len(link_results),
        "teams": link_results,
        "merge": merge_stats,
        "reattach": reattach,
        "reconcile": reconcile,
        "trades_applied": moves,
        "trade_count": len(moves),
    }


def sync_league_from_sleeper(league_id: str) -> dict[str, Any]:
    return ensure_sleeper_team_links(league_id)


def sync_team_sleeper_to_league(
    league_id: str,
    team_id: str,
    *,
    run_league_trade_scan: bool = True,
) -> dict[str, Any]:
    """Refresh one manager's Sleeper roster into the shared league workspace."""
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    team = storage.get_team(team_id)
    if not team or team.get("league_id") != league_id:
        raise ValueError("Team not in this league")
    roster_id = team.get("sleeper_roster_id")
    if not roster_id:
        raise ValueError("Link your Sleeper team first")

    sleeper_league_id = league.get("sleeper_league_id")
    if not sleeper_league_id:
        raise ValueError("League Sleeper ID not set — commissioner links first")

    ws_id = league.get("workspace_id")
    if not ws_id:
        raise ValueError("League has no shared workspace")

    snapshot = fetch_linked_roster(sleeper_league_id, str(roster_id))
    players = _snapshot_players(snapshot)
    storage.update_team_sleeper_link(
        team_id,
        sleeper_player_ids=snapshot.get("player_ids") or [p["player_id"] for p in players],
        sleeper_team_name=snapshot.get("team_name") or team.get("sleeper_team_name"),
    )
    live_name = str(snapshot.get("team_name") or team.get("sleeper_team_name") or "").strip()
    if live_name:
        apply_sleeper_display_name(str(team_id), live_name)

    moves: list[dict[str, Any]] = []
    if run_league_trade_scan:
        teams = storage.list_league_teams(league_id)
        team_snapshots: dict[str, list[dict[str, Any]]] = {}
        for t in teams:
            if not t.get("sleeper_roster_id"):
                continue
            if str(t["id"]) == str(team_id):
                team_snapshots[str(t["id"])] = players
            else:
                snap = fetch_linked_roster(sleeper_league_id, str(t["sleeper_roster_id"]))
                team_snapshots[str(t["id"])] = _snapshot_players(snap)
        moves = detect_and_apply_sleeper_trades(ws_id, team_snapshots)
        for tid, plist in team_snapshots.items():
            merge_sleeper_team_roster(ws_id, tid, plist)
    else:
        merge_sleeper_team_roster(ws_id, team_id, players)

    reattach = reattach_league_roster_slots(league_id)
    reconcile = reconcile_league_roster_assignments(league_id)

    return {
        "team_id": team_id,
        "snapshot": snapshot,
        "trades_applied": moves,
        "trade_count": len(moves),
        "reattach": reattach,
        "reconcile": reconcile,
    }
