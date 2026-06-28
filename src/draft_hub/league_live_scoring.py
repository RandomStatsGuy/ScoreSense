"""Sleeper live weekly matchup scoring — starters, H2H pairs, short-TTL cache."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from src.draft_hub import storage
from src.integrations.sleeper import get_nfl_state, load_sleeper_players

SLEEPER_API = "https://api.sleeper.app/v1"
LIVE_SCORING_MAX_AGE_SECONDS = 60


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _fetch_json(url: str, timeout: int = 25) -> Any:
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def _live_cache_is_fresh(synced_at: str, max_age_seconds: int = LIVE_SCORING_MAX_AGE_SECONDS) -> bool:
    try:
        ts = datetime.fromisoformat(str(synced_at).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - ts
        return age <= timedelta(seconds=max_age_seconds)
    except (ValueError, TypeError):
        return False


def resolve_current_week(
    season: int | str | None = None,
    *,
    week_override: int | None = None,
) -> tuple[int, dict[str, Any]]:
    """NFL week from Sleeper state; optional explicit week for dev/replay."""
    state = get_nfl_state(use_cache=True)
    week = int(week_override if week_override is not None else state.get("week") or 1)
    if season is not None and str(season) != str(state.get("season") or ""):
        pass
    return week, state


def week_picker_meta(
    nfl_state: dict[str, Any],
    league: dict[str, Any] | None = None,
) -> dict[str, int]:
    """UI bounds for week selector — current NFL week through league playoff span."""
    current = int(nfl_state.get("week") or 1)
    settings = (league or {}).get("settings") or {}
    playoff_start = int(settings.get("playoff_week_start") or 15)
    max_week = max(18, playoff_start + 3)
    return {"current_week": current, "max_week": max_week}


def _enrich_starter(
    sleeper_player_id: str,
    players_points: dict[str, Any],
    raw_players: dict[str, Any],
) -> dict[str, Any]:
    sid = str(sleeper_player_id or "")
    if not sid or sid == "0":
        return {
            "sleeper_player_id": sid,
            "player_id": "",
            "name": "Empty",
            "position": "",
            "team": "",
            "points": 0.0,
        }
    pts_raw = players_points.get(sid)
    if pts_raw is None:
        try:
            pts_raw = players_points.get(int(sid))
        except (TypeError, ValueError):
            pts_raw = None
    pts = float(pts_raw or 0)
    info = raw_players.get(sid) or {}
    gsis = str(info.get("gsis_id") or "").strip()
    player_id = gsis if gsis else f"sleeper-{sid}"
    return {
        "sleeper_player_id": sid,
        "player_id": player_id,
        "name": info.get("full_name") or f"Player {sid}",
        "position": str(info.get("position") or ""),
        "team": str(info.get("team") or ""),
        "points": round(pts, 2),
    }


def _team_from_matchup_row(
    row: dict[str, Any],
    *,
    roster_to_label: dict[str, str],
    raw_players: dict[str, Any],
    viewer_roster_id: str | None,
) -> dict[str, Any]:
    rid = str(row.get("roster_id") or "")
    starters = row.get("starters") or []
    players_points = row.get("players_points") or {}
    starter_rows = [
        _enrich_starter(sid, players_points, raw_players) for sid in starters
    ]
    viewer_rid = str(viewer_roster_id or "")
    return {
        "roster_id": rid,
        "team_name": roster_to_label.get(rid) or f"Roster {rid}",
        "points": round(float(row.get("points") or 0), 2),
        "starters": starter_rows,
        "is_viewer": bool(viewer_rid and rid == viewer_rid),
        "is_opponent": False,
    }


def build_sleeper_live_week(
    sleeper_league_id: str,
    week: int,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    viewer_roster_id: str | None = None,
    nfl_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fetch one week of Sleeper matchups with starter-level points."""
    if not sleeper_league_id:
        return {
            "available": False,
            "reason": "no_sleeper_league",
            "hint": "Link your Sleeper league on Setup or All teams to see live scoring.",
        }

    state = nfl_state or get_nfl_state(use_cache=True)
    season_type = str(state.get("season_type") or "regular")
    synced_at = _utcnow_iso()

    try:
        league = _fetch_json(f"{SLEEPER_API}/league/{sleeper_league_id}")
    except Exception as exc:
        return {
            "available": False,
            "reason": "fetch_failed",
            "error": str(exc),
            "hint": "Could not reach Sleeper — try again in a moment.",
            "synced_at": synced_at,
        }

    season = str(league.get("season") or state.get("season") or "")
    status = str(league.get("status") or "")
    preseason = status in ("pre_draft", "drafting") or season_type == "pre"
    week_meta = week_picker_meta(state, league)

    roster_to_label: dict[str, str] = {}
    if hub_teams:
        for t in hub_teams:
            rid = str(t.get("sleeper_roster_id") or "")
            if rid:
                roster_to_label[rid] = (
                    t.get("name") or t.get("team_name") or t.get("sleeper_team_name") or "Team"
                )

    try:
        matchups = _fetch_json(
            f"{SLEEPER_API}/league/{sleeper_league_id}/matchups/{int(week)}"
        )
    except Exception as exc:
        return {
            "available": False,
            "reason": "fetch_failed",
            "error": str(exc),
            "season": season,
            "week": int(week),
            "hint": "Could not load matchups from Sleeper.",
            "synced_at": synced_at,
            **week_meta,
        }

    if not matchups:
        return {
            "available": True,
            "season": season,
            "week": int(week),
            "season_type": season_type,
            "preseason": True,
            "status": status,
            "matchups": [],
            "viewer_matchup_id": None,
            "hint": "No matchups yet — live scoring appears once the NFL week starts.",
            "synced_at": synced_at,
            **week_meta,
        }

    raw_players = load_sleeper_players()
    by_matchup: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in matchups:
        mid = row.get("matchup_id")
        if mid is None:
            continue
        by_matchup[str(mid)].append(row)

    viewer_rid = str(viewer_roster_id or "")
    viewer_matchup_id: str | None = None
    matchup_payloads: list[dict[str, Any]] = []

    for mid, rows in by_matchup.items():
        teams = [
            _team_from_matchup_row(
                row,
                roster_to_label=roster_to_label,
                raw_players=raw_players,
                viewer_roster_id=viewer_roster_id,
            )
            for row in rows
        ]
        if viewer_rid and any(t["roster_id"] == viewer_rid for t in teams):
            viewer_matchup_id = mid
            for t in teams:
                if t["roster_id"] != viewer_rid:
                    t["is_opponent"] = True
        teams.sort(key=lambda t: -t["points"])
        matchup_payloads.append({"matchup_id": mid, "teams": teams})

    matchup_payloads.sort(
        key=lambda m: (
            0 if str(m["matchup_id"]) == str(viewer_matchup_id or "") else 1,
            -sum(t["points"] for t in m["teams"]),
        )
    )

    has_points = any(t["points"] > 0 for m in matchup_payloads for t in m["teams"])
    if preseason or (not has_points and status in ("pre_draft", "drafting")):
        preseason = True

    return {
        "available": True,
        "season": season,
        "week": int(week),
        "season_type": season_type,
        "preseason": preseason,
        "status": status,
        "viewer_matchup_id": viewer_matchup_id,
        "matchups": matchup_payloads,
        "hint": (
            "Season not started — scores update after Week 1."
            if preseason and not has_points
            else None
        ),
        "synced_at": synced_at,
        **week_meta,
    }


def get_sleeper_live_week(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    week: int | None = None,
    viewer_roster_id: str | None = None,
    refresh: bool = False,
) -> dict[str, Any]:
    """Read-through cache for live week scoring (60s TTL unless refresh)."""
    if not sleeper_league_id:
        return {
            "available": False,
            "reason": "no_sleeper_league",
            "hint": "Link your Sleeper league on Setup or All teams to see live scoring.",
        }

    resolved_week, nfl_state = resolve_current_week(week_override=week)
    cache_key_week = int(resolved_week)

    if not refresh:
        cached = storage.get_sleeper_live_scoring_cache(str(sleeper_league_id), cache_key_week)
        if cached and _live_cache_is_fresh(cached["synced_at"]):
            payload = {**cached["payload"], "synced_at": cached["synced_at"], "cached": True}
            if hub_teams:
                payload = _attach_hub_team_names(payload, hub_teams)
            payload = {**payload, **week_picker_meta(nfl_state)}
            return payload

    payload = build_sleeper_live_week(
        str(sleeper_league_id),
        cache_key_week,
        hub_teams=hub_teams,
        viewer_roster_id=viewer_roster_id,
        nfl_state=nfl_state,
    )
    if payload.get("available"):
        storage.upsert_sleeper_live_scoring_cache(
            str(sleeper_league_id),
            cache_key_week,
            payload,
        )
    payload["cached"] = False
    if "current_week" not in payload:
        payload = {**payload, **week_picker_meta(nfl_state)}
    return payload


def refresh_sleeper_live_scoring_cache(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    week: int | None = None,
    viewer_roster_id: str | None = None,
) -> dict[str, Any]:
    """Force live fetch and persist (used on Sleeper sync)."""
    return get_sleeper_live_week(
        sleeper_league_id,
        hub_teams=hub_teams,
        week=week,
        viewer_roster_id=viewer_roster_id,
        refresh=True,
    )


def _attach_hub_team_names(payload: dict[str, Any], hub_teams: list[dict[str, Any]]) -> dict[str, Any]:
    roster_to_label: dict[str, str] = {}
    for t in hub_teams:
        rid = str(t.get("sleeper_roster_id") or "")
        if rid:
            roster_to_label[rid] = (
                t.get("name") or t.get("team_name") or t.get("sleeper_team_name") or "Team"
            )
    if not roster_to_label:
        return payload
    out = {**payload}
    matchups = []
    for m in out.get("matchups") or []:
        teams = []
        for team in m.get("teams") or []:
            rid = str(team.get("roster_id") or "")
            teams.append(
                {
                    **team,
                    "team_name": roster_to_label.get(rid) or team.get("team_name"),
                }
            )
        matchups.append({**m, "teams": teams})
    out["matchups"] = matchups
    return out
