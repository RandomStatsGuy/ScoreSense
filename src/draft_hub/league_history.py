"""Sleeper scoring history and in-app player ownership timeline."""

from __future__ import annotations

import json
import time
from typing import Any

import requests

from src.draft_hub import storage
from src.draft_hub.rules_engine import normalize_position

SLEEPER_API = "https://api.sleeper.app/v1"
_SCORING_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 900


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
    all_ids = set(current) | set(by_player)
    for pid in all_ids:
        name = None
        pos = None
        cur = current.get(pid) or []
        if cur:
            name = cur[0].get("player_name")
            pos = cur[0].get("position")
        timeline = sorted(by_player.get(pid) or [], key=lambda e: e.get("at") or "")
        if not timeline:
            timeline = list(roster_baselines.get(pid) or [])
        elif roster_baselines.get(pid):
            # Prepend import/sync baseline when no auction win recorded yet
            has_acquired = any(e.get("event_type") == "acquired" for e in timeline)
            if not has_acquired:
                timeline = list(roster_baselines.get(pid) or []) + timeline
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
    }


def _roster_source_label(source: str) -> str:
    if source == "sleeper":
        return "On roster (imported from Sleeper)"
    if source == "sheet":
        return "On roster (imported from spreadsheet)"
    return "On roster"
