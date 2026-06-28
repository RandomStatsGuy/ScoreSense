"""Sleeper scoring history and in-app player ownership timeline."""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from src.draft_hub import storage
from src.draft_hub.rules_engine import normalize_position

SLEEPER_API = "https://api.sleeper.app/v1"
_SCORING_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 900
SCORING_DB_MAX_AGE_HOURS = 24
OWNERSHIP_DB_MAX_AGE_HOURS = 168


def _scoring_cache_is_fresh(synced_at: str, max_age_hours: int) -> bool:
    try:
        ts = datetime.fromisoformat(str(synced_at).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - ts
        return age <= timedelta(hours=max_age_hours)
    except (ValueError, TypeError):
        return False


def get_sleeper_scoring_history(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    refresh: bool = False,
    max_age_hours: int = SCORING_DB_MAX_AGE_HOURS,
    max_weeks: int = 18,
    scoring_season: str | None = None,
) -> dict[str, Any]:
    """Serve scoring from SQLite cache when fresh; live Sleeper only on refresh or miss."""
    if not sleeper_league_id:
        return {
            "available": False,
            "reason": "no_sleeper_league",
            "hint": "Link your Sleeper league on Setup or All teams to pull weekly fantasy points.",
        }

    chain = sleeper_league_season_chain(sleeper_league_id)
    resolved_id = sleeper_league_id
    if scoring_season:
        match = next((c for c in chain if str(c.get("season")) == str(scoring_season)), None)
        if match:
            resolved_id = str(match["league_id"])
        else:
            return {
                "available": False,
                "reason": "season_not_found",
                "season": scoring_season,
                "available_seasons": [c["season"] for c in chain],
                "hint": f"No Sleeper league in chain for {scoring_season}. Available: {', '.join(c['season'] for c in chain) or 'none'}.",
            }

    cache_key = f"{resolved_id}:{scoring_season or 'current'}"

    if not refresh:
        cached = storage.get_sleeper_scoring_cache(resolved_id)
        if cached and _scoring_cache_is_fresh(cached["synced_at"], max_age_hours):
            payload = dict(cached["payload"])
            if hub_teams:
                payload = _attach_hub_team_names(payload, hub_teams)
            payload["cached"] = True
            payload["synced_at"] = cached["synced_at"]
            payload["available_seasons"] = [c["season"] for c in chain]
            payload["requested_season"] = scoring_season or payload.get("season")
            if scoring_season:
                payload["season"] = str(scoring_season)
            return payload

    payload = build_sleeper_scoring_history(
        resolved_id,
        hub_teams=hub_teams,
        max_weeks=max_weeks,
    )
    if payload.get("available"):
        storage.upsert_sleeper_scoring_cache(resolved_id, payload)
    payload["available_seasons"] = [c["season"] for c in chain]
    payload["requested_season"] = scoring_season or payload.get("season")
    if scoring_season:
        payload["season"] = str(scoring_season)
    return payload


def _attach_scoring_awards(payload: dict[str, Any]) -> dict[str, Any]:
    """Deprecated — awards are enriched in hub routes with owner labels."""
    return dict(payload)


def refresh_sleeper_scoring_cache(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    max_weeks: int = 18,
) -> dict[str, Any]:
    """Force live Sleeper fetch and persist scoring history."""
    payload = build_sleeper_scoring_history(
        sleeper_league_id,
        hub_teams=hub_teams,
        max_weeks=max_weeks,
    )
    if payload.get("available"):
        storage.upsert_sleeper_scoring_cache(sleeper_league_id, payload)
    return payload


def _fetch_json(url: str, timeout: int = 25) -> Any:
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def build_sleeper_scoring_history(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    max_weeks: int = 18,
) -> dict[str, Any]:
    """
    Pull fantasy points by week from Sleeper matchups.

    Maps Sleeper roster_id → hub team when sleeper_roster_id is linked.
    """
    if not sleeper_league_id:
        return {
            "available": False,
            "reason": "no_sleeper_league",
            "hint": "Link your Sleeper league on Setup or All teams to pull weekly fantasy points.",
        }

    cache_key = str(sleeper_league_id)
    now = time.time()
    cached = _SCORING_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _CACHE_TTL:
        payload = cached[1]
        if hub_teams:
            payload = _attach_hub_team_names(payload, hub_teams)
        return payload

    try:
        league = _fetch_json(f"{SLEEPER_API}/league/{sleeper_league_id}")
    except Exception as exc:
        return {
            "available": False,
            "reason": "fetch_failed",
            "error": str(exc),
            "hint": "Could not reach Sleeper — try again in a moment or refresh this tab.",
        }

    season = str(league.get("season") or "")
    status = league.get("status") or ""
    settings = league.get("settings") or {}
    playoff_week_start = int(settings.get("playoff_week_start") or 15)

    roster_to_label: dict[str, str] = {}
    if hub_teams:
        for t in hub_teams:
            rid = str(t.get("sleeper_roster_id") or "")
            if rid:
                roster_to_label[rid] = t.get("name") or t.get("team_name") or "Team"

    weekly: list[dict[str, Any]] = []
    team_totals: dict[str, float] = {}
    team_weeks: dict[str, list[float]] = {}

    for week in range(1, max_weeks + 1):
        try:
            matchups = _fetch_json(f"{SLEEPER_API}/league/{sleeper_league_id}/matchups/{week}")
        except Exception:
            break
        if not matchups:
            break
        week_rows: list[dict[str, Any]] = []
        week_has_points = False
        for m in matchups:
            rid = str(m.get("roster_id") or "")
            pts = float(m.get("points") or 0)
            if pts > 0:
                week_has_points = True
            label = roster_to_label.get(rid) or f"Roster {rid}"
            week_rows.append({"roster_id": rid, "team_name": label, "points": round(pts, 2)})
            team_totals[label] = team_totals.get(label, 0.0) + pts
            team_weeks.setdefault(label, []).append(pts)
        weekly.append(
            {
                "week": week,
                "is_playoff": week >= playoff_week_start,
                "teams": sorted(week_rows, key=lambda r: -r["points"]),
            }
        )
        if not week_has_points and week > 1 and status in ("pre_draft", "drafting"):
            break

    if not weekly:
        preseason = _preseason_scoring_from_rosters(
            sleeper_league_id,
            hub_teams=hub_teams,
            season=season,
            status=status,
        )
        if preseason:
            _SCORING_CACHE[cache_key] = (now, preseason)
            if hub_teams:
                preseason = _attach_hub_team_names(preseason, hub_teams)
            return preseason
        return {
            "available": False,
            "reason": "no_matchups",
            "season": season,
            "status": status,
            "hint": "No scored weeks yet — points appear once your Sleeper league has played games.",
        }

    all_zero = all(
        all(float(t.get("points") or 0) == 0 for t in (wk.get("teams") or []))
        for wk in weekly
    )

    standings = []
    for name, total in sorted(team_totals.items(), key=lambda x: -x[1]):
        pts = team_weeks.get(name) or []
        standings.append(
            {
                "team_name": name,
                "total_points": round(total, 2),
                "avg_points": round(total / max(len(pts), 1), 2),
                "weeks_scored": len(pts),
            }
        )

    payload = {
        "available": True,
        "sleeper_league_id": sleeper_league_id,
        "season": season,
        "status": status,
        "weeks": weekly,
        "standings": standings,
        "preseason": all_zero or status in ("pre_draft", "drafting"),
        "hint": (
            "Season hasn't started — weekly points will fill in after games are played."
            if all_zero
            else None
        ),
    }
    _SCORING_CACHE[cache_key] = (now, payload)
    if hub_teams:
        payload = _attach_hub_team_names(payload, hub_teams)
    return payload


def _preseason_scoring_from_rosters(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None,
    season: str,
    status: str,
) -> dict[str, Any] | None:
    """When matchups are empty (preseason), show linked teams at 0 pts instead of a blank tab."""
    try:
        from src.integrations.sleeper_league import list_league_teams as sleeper_list_teams

        meta = sleeper_list_teams(str(sleeper_league_id))
    except Exception:
        return None
    teams = meta.get("teams") or []
    if not teams:
        return None

    roster_to_label: dict[str, str] = {}
    if hub_teams:
        for t in hub_teams:
            rid = str(t.get("sleeper_roster_id") or "")
            if rid:
                roster_to_label[rid] = t.get("name") or t.get("team_name") or "Team"

    standings = []
    for t in teams:
        rid = str(t.get("roster_id") or "")
        label = roster_to_label.get(rid) or t.get("team_name") or "Team"
        standings.append(
            {
                "team_name": label,
                "total_points": 0.0,
                "avg_points": 0.0,
                "weeks_scored": 0,
            }
        )
    standings.sort(key=lambda row: row["team_name"].lower())

    return {
        "available": True,
        "sleeper_league_id": sleeper_league_id,
        "season": season or str(meta.get("season") or ""),
        "status": status,
        "weeks": [],
        "standings": standings,
        "preseason": True,
        "hint": "Season hasn't started — weekly points will fill in after games are scored in Sleeper.",
    }


def _attach_hub_team_names(payload: dict[str, Any], hub_teams: list[dict[str, Any]]) -> dict[str, Any]:
    roster_to_label = {
        str(t.get("sleeper_roster_id")): t.get("name") or t.get("team_name")
        for t in hub_teams
        if t.get("sleeper_roster_id")
    }
    if not roster_to_label:
        return payload
    out = dict(payload)
    weeks = []
    for wk in payload.get("weeks") or []:
        teams = []
        for row in wk.get("teams") or []:
            rid = str(row.get("roster_id") or "")
            teams.append({**row, "team_name": roster_to_label.get(rid) or row.get("team_name")})
        weeks.append({**wk, "teams": teams})
    out["weeks"] = weeks
    return out


def _hub_roster_labels(hub_teams: list[dict[str, Any]] | None) -> dict[str, str]:
    if not hub_teams:
        return {}
    return {
        str(t.get("sleeper_roster_id")): t.get("name") or t.get("team_name") or "Team"
        for t in hub_teams
        if t.get("sleeper_roster_id")
    }


def build_player_id_aliases(overview: dict[str, Any]) -> dict[str, str]:
    """Map Sleeper ids and aliases to canonical hub player_id."""
    out: dict[str, str] = {}
    for block in overview.get("teams") or []:
        for row in block.get("roster") or []:
            pid = str(row.get("player_id") or "")
            if not pid:
                continue
            out[pid] = pid
            spid = str(row.get("sleeper_player_id") or "")
            if spid:
                out[spid] = pid
                out[f"sleeper-{spid}"] = pid
    return out


def _canonical_player_id(player_id: str, aliases: dict[str, str]) -> str:
    pid = str(player_id or "")
    return aliases.get(pid, pid)


def _ownership_timeline_sort_key(ev: dict[str, Any]) -> tuple[int, int, str]:
    et = ev.get("event_type")
    if et == "season_roster":
        return (int(ev.get("season") or 0), 2, "")
    if et in ("acquired", "cut"):
        at = str(ev.get("at") or "")
        year = int(at[:4]) if len(at) >= 4 and at[:4].isdigit() else 0
        return (year, 1, at)
    if et == "roster":
        return (9999, 3, "")
    return (9999, 9, "")


def build_sleeper_season_ownership_by_player(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    aliases: dict[str, str] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Map player_id → per-season roster events from Sleeper league chain."""
    if not sleeper_league_id:
        return {}

    from src.integrations.sleeper import load_sleeper_players
    from src.integrations.sleeper_league import (
        _roster_player_ids,
        _team_label,
        fetch_league_rosters,
        fetch_league_users,
        resolve_ownership_roster_player,
    )

    alias_map = aliases or {}
    chain = sleeper_league_season_chain(sleeper_league_id)
    if not chain:
        return {}

    current_season = str(chain[0].get("season") or "")
    hub_labels = _hub_roster_labels(hub_teams)
    raw_players = load_sleeper_players()
    by_player: dict[str, list[dict[str, Any]]] = {}

    for entry in sorted(chain, key=lambda c: int(c.get("season") or 0)):
        lid = str(entry["league_id"])
        season = str(entry["season"])
        is_current = season == current_season
        try:
            rosters = fetch_league_rosters(lid)
            users = {u["user_id"]: u for u in fetch_league_users(lid)}
        except Exception:
            continue

        for roster in rosters:
            rid = str(roster.get("roster_id") or "")
            owner = users.get(roster.get("owner_id"), {})
            team_name = _team_label(owner)
            if is_current and rid in hub_labels:
                team_name = hub_labels[rid]

            for sleeper_pid in _roster_player_ids(roster):
                player = resolve_ownership_roster_player(
                    sleeper_pid,
                    raw_players,
                    aliases=alias_map,
                )
                if not player:
                    continue
                pid = str(player.get("player_id") or "")
                if not pid:
                    continue
                by_player.setdefault(pid, []).append(
                    {
                        "event_type": "season_roster",
                        "season": season,
                        "team_name": team_name,
                        "sleeper_roster_id": rid,
                        "player_name": player.get("player_name"),
                        "position": normalize_position(player.get("position")),
                        "note": "Season roster (Sleeper)",
                    }
                )

    return by_player


def get_sleeper_ownership_history(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    overview: dict[str, Any] | None = None,
    refresh: bool = False,
    max_age_hours: int = OWNERSHIP_DB_MAX_AGE_HOURS,
) -> dict[str, Any]:
    """Serve Sleeper season ownership from SQLite cache when fresh."""
    if not sleeper_league_id:
        return {
            "available": False,
            "reason": "no_sleeper_league",
            "by_player": {},
            "available_seasons": [],
        }

    chain = sleeper_league_season_chain(sleeper_league_id)
    available_seasons = [str(c["season"]) for c in chain]

    if not refresh:
        cached = storage.get_sleeper_ownership_cache(sleeper_league_id)
        if cached and _scoring_cache_is_fresh(cached["synced_at"], max_age_hours):
            payload = dict(cached["payload"])
            payload["cached"] = True
            payload["synced_at"] = cached["synced_at"]
            payload["available_seasons"] = available_seasons
            return payload

    aliases = build_player_id_aliases(overview) if overview else {}
    by_player = build_sleeper_season_ownership_by_player(
        sleeper_league_id,
        hub_teams=hub_teams,
        aliases=aliases,
    )
    payload = {
        "available": bool(by_player),
        "by_player": by_player,
        "available_seasons": available_seasons,
        "player_count": len(by_player),
    }
    if by_player:
        storage.upsert_sleeper_ownership_cache(sleeper_league_id, payload)
    return payload


def _timeline_from_parts(
    *,
    season_events: list[dict[str, Any]],
    auction_events: list[dict[str, Any]],
    roster_baselines: list[dict[str, Any]] | None,
    current_owners: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if season_events:
        return sorted(list(season_events) + list(auction_events), key=_ownership_timeline_sort_key)
    if auction_events:
        timeline = sorted(auction_events, key=_ownership_timeline_sort_key)
        if roster_baselines:
            has_acquired = any(e.get("event_type") == "acquired" for e in timeline)
            if not has_acquired:
                timeline = list(roster_baselines) + timeline
        return timeline
    if roster_baselines:
        return list(roster_baselines)
    if current_owners:
        return [
            {
                "event_type": "roster",
                "team_id": o.get("team_id"),
                "team_name": o.get("team_name") or "Team",
                "amount": o.get("salary"),
                "player_name": o.get("player_name"),
                "position": o.get("position"),
                "source": o.get("source"),
                "note": _roster_source_label(str(o.get("source") or "")),
            }
            for o in current_owners
        ]
    return []


def apply_sleeper_ownership_history(
    ownership: dict[str, Any],
    sleeper_payload: dict[str, Any],
) -> dict[str, Any]:
    """Merge cached Sleeper season events into an ownership payload."""
    by_player = sleeper_payload.get("by_player") or {}
    if not by_player:
        return ownership

    player_map = {str(p.get("player_id")): dict(p) for p in ownership.get("players") or []}
    for pid, events in by_player.items():
        if pid not in player_map:
            sample = events[0] if events else {}
            player_map[pid] = {
                "player_id": pid,
                "player_name": sample.get("player_name") or pid,
                "position": sample.get("position"),
                "current_owners": [],
                "timeline": [],
            }

    for pid, player in player_map.items():
        season_events = by_player.get(pid) or []
        existing = player.get("timeline") or []
        auction_events = [e for e in existing if e.get("event_type") in ("acquired", "cut")]
        roster_baselines = [e for e in existing if e.get("event_type") == "roster"]
        player["timeline"] = _timeline_from_parts(
            season_events=season_events,
            auction_events=auction_events,
            roster_baselines=roster_baselines if not season_events else None,
            current_owners=player.get("current_owners") or [],
        )

    players = sorted(player_map.values(), key=lambda p: (p.get("player_name") or "").lower())
    return {
        **ownership,
        "players": players,
        "player_count": len(players),
        "has_sleeper_history": True,
        "available_seasons": sleeper_payload.get("available_seasons") or [],
        "ownership_synced_at": sleeper_payload.get("synced_at"),
        "ownership_cached": sleeper_payload.get("cached", False),
    }


def build_player_ownership_history(
    league_id: str,
    overview: dict[str, Any],
) -> dict[str, Any]:
    """Ownership timeline from auction wins, cuts, and current roster slots."""
    team_names = {
        str((b.get("team") or {}).get("id")): (b.get("team") or {}).get("name")
        for b in overview.get("teams") or []
    }
    current: dict[str, list[dict[str, Any]]] = {}
    roster_baselines: dict[str, list[dict[str, Any]]] = {}
    for block in overview.get("teams") or []:
        team = block.get("team") or {}
        tid = str(team.get("id") or "")
        tname = team.get("name") or "Team"
        for row in block.get("roster") or []:
            pid = str(row.get("player_id") or "")
            if not pid:
                continue
            source = str(row.get("source") or "manual")
            salary = float(row.get("salary") or 0)
            pos = normalize_position(row.get("position"))
            pname = row.get("player_name")
            current.setdefault(pid, []).append(
                {
                    "team_id": tid,
                    "team_name": tname,
                    "salary": salary,
                    "position": pos,
                    "player_name": pname,
                    "source": source,
                    "status": "current",
                }
            )
            roster_baselines.setdefault(pid, []).append(
                {
                    "event_type": "roster",
                    "team_id": tid,
                    "team_name": tname,
                    "amount": salary,
                    "player_name": pname,
                    "position": pos,
                    "source": source,
                    "note": _roster_source_label(source),
                }
            )

    available_seasons: list[str] = []
    sleeper_by_player: dict[str, list[dict[str, Any]]] = {}

    events = storage.list_draft_events(league_id, limit=500)
    by_player: dict[str, list[dict[str, Any]]] = {}

    for ev in events:
        payload = ev.get("payload") or {}
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                payload = {}
        et = ev.get("event_type")
        pid = str(payload.get("player_id") or "")
        if not pid and et != "cut":
            continue
        if et == "win":
            tid = str(payload.get("team_id") or "")
            entry = {
                "event_type": "acquired",
                "at": ev.get("created_at"),
                "team_id": tid,
                "team_name": payload.get("team_name") or team_names.get(tid, "Team"),
                "amount": float(payload.get("amount") or 0),
                "player_name": payload.get("player_name"),
                "position": normalize_position(payload.get("position")),
            }
            by_player.setdefault(pid, []).append(entry)
        elif et == "cut":
            pid = str(payload.get("player_id") or "")
            if not pid:
                continue
            tid = str(payload.get("team_id") or "")
            by_player.setdefault(pid, []).append(
                {
                    "event_type": "cut",
                    "at": ev.get("created_at"),
                    "team_id": tid,
                    "team_name": team_names.get(tid, "Team"),
                    "refund": float(payload.get("refund") or 0),
                    "player_name": payload.get("player_name"),
                }
            )

    players = []
    all_ids = set(current) | set(by_player) | set(sleeper_by_player)
    for pid in all_ids:
        name = None
        pos = None
        cur = current.get(pid) or []
        if cur:
            name = cur[0].get("player_name")
            pos = cur[0].get("position")
        season_events = sleeper_by_player.get(pid) or []
        auction_events = by_player.get(pid) or []
        timeline = _timeline_from_parts(
            season_events=season_events,
            auction_events=auction_events,
            roster_baselines=roster_baselines.get(pid),
            current_owners=cur,
        )
        if not name and timeline:
            for e in timeline:
                if e.get("player_name"):
                    name = e["player_name"]
                    pos = e.get("position")
                    break
        players.append(
            {
                "player_id": pid,
                "player_name": name or pid,
                "position": pos,
                "current_owners": cur,
                "timeline": timeline,
            }
        )

    players.sort(key=lambda p: (p.get("player_name") or "").lower())
    return {
        "player_count": len(players),
        "players": players,
        "event_count": len(events),
        "has_auction_events": any(ev.get("event_type") == "win" for ev in events),
        "has_sleeper_history": bool(sleeper_by_player),
        "available_seasons": available_seasons,
    }


def _roster_source_label(source: str) -> str:
    if source == "sleeper":
        return "On roster (imported from Sleeper)"
    if source == "sheet":
        return "On roster (imported from spreadsheet)"
    return "On roster"


def sleeper_league_season_chain(sleeper_league_id: str, *, max_hops: int = 8) -> list[dict[str, str]]:
    """Walk previous_league_id to list seasons available for this league lineage."""
    from src.integrations.sleeper_league import fetch_league

    seen: set[str] = set()
    chain: list[dict[str, str]] = []
    lid = str(sleeper_league_id or "").strip()
    for _ in range(max_hops):
        if not lid or lid in seen:
            break
        seen.add(lid)
        try:
            league = fetch_league(lid)
        except Exception:
            break
        season = str(league.get("season") or "")
        if season:
            chain.append(
                {
                    "season": season,
                    "league_id": lid,
                    "name": str(league.get("name") or ""),
                    "status": str(league.get("status") or ""),
                }
            )
        prev = league.get("previous_league_id")
        if not prev:
            break
        lid = str(prev)
    return chain
