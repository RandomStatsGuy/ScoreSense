"""Read-only team presentation, owner nicknames, and revocable room links."""
from __future__ import annotations

import json
import copy
import secrets
import time
from typing import Any

from src.draft_hub import storage


def _table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS team_room_settings (
        team_id TEXT PRIMARY KEY, share_token TEXT UNIQUE,
        nicknames_json TEXT NOT NULL DEFAULT '{}')""")


def settings(team_id: str) -> dict:
    with storage.get_conn() as conn:
        _table(conn)
        row = conn.execute("SELECT * FROM team_room_settings WHERE team_id=?", (team_id,)).fetchone()
    return dict(row) if row else {"team_id": team_id, "share_token": None, "nicknames_json": "{}"}


def projection_snapshot(league_id, season, week, player_id, value, *, started):
    """Never substitute a post-kickoff estimate for a missing pregame baseline."""
    with storage.get_conn() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS team_room_projection (
            league_id TEXT, season INTEGER, week INTEGER, player_id TEXT, projection REAL,
            PRIMARY KEY(league_id,season,week,player_id))""")
        key = (league_id, season, week, player_id)
        if not started and value is not None:
            import math
            try:
                number = float(value)
                if math.isfinite(number):
                    conn.execute("INSERT OR REPLACE INTO team_room_projection VALUES (?,?,?,?,?)", (*key, number))
            except (ValueError, TypeError):
                pass
        row = conn.execute("SELECT projection FROM team_room_projection WHERE league_id=? AND season=? AND week=? AND player_id=?", key).fetchone()
    return row[0] if row else None


def share(team_id: str, enabled: bool) -> str | None:
    with storage.get_conn() as conn:
        _table(conn)
        conn.execute("INSERT OR IGNORE INTO team_room_settings(team_id) VALUES (?)", (team_id,))
        current = conn.execute("SELECT share_token FROM team_room_settings WHERE team_id=?", (team_id,)).fetchone()[0]
        token = (current or secrets.token_urlsafe(32)) if enabled else None
        conn.execute("UPDATE team_room_settings SET share_token=? WHERE team_id=?", (token, team_id))
    return token


def shared_team(token: str) -> dict | None:
    if not 30 <= len(token) <= 64:
        return None
    with storage.get_conn() as conn:
        _table(conn)
        row = conn.execute("SELECT team_id FROM team_room_settings WHERE share_token=?", (token,)).fetchone()
    return storage.get_team(row[0]) if row else None


def nickname(team_id: str, player_id: str, value: str | None) -> None:
    with storage.get_conn() as conn:
        _table(conn)
        conn.execute("INSERT OR IGNORE INTO team_room_settings(team_id) VALUES (?)", (team_id,))
        names = json.loads(conn.execute("SELECT nicknames_json FROM team_room_settings WHERE team_id=?", (team_id,)).fetchone()[0])
        if value is None:
            names.pop(player_id, None)
        else:
            names[player_id] = value.strip()
        conn.execute("UPDATE team_room_settings SET nicknames_json=? WHERE team_id=?", (json.dumps(names), team_id))


_nickname_cache: dict[str, tuple[float, list]] = {}


def sleeper_nicknames(league_id: str, roster_id: str) -> dict:
    """Optional provider metadata; absent nicknames never block the room."""
    if not league_id:
        return {}
    from src.draft_hub.league_live_scoring import _fetch_json, SLEEPER_API
    try:
        cached = _nickname_cache.get(league_id)
        if cached and time.monotonic() - cached[0] < 300:
            rows = cached[1]
        else:
            rows = _fetch_json(f"{SLEEPER_API}/league/{league_id}/rosters")
            rows = rows if isinstance(rows, list) else []
            if len(_nickname_cache) > 100:
                _nickname_cache.clear()
            _nickname_cache[league_id] = (time.monotonic(), rows)
        row = next((r for r in rows if str(r.get("roster_id")) == str(roster_id)), {})
        return {str(k)[9:]: str(v)[:40] for k, v in (row.get("metadata") or {}).items()
                if str(k).startswith("nickname_") and isinstance(v, str)}
    except Exception:
        return {}


def build_room(team: dict, week: int | None = None) -> dict[str, Any]:
    from src.draft_hub.league_live_scoring import get_sleeper_live_week
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id
    from src.draft_hub.hub_scoring import build_hub_live_week, nfl_week_slate_complete, nfl_game_started
    league_id = str(team["league_id"])
    league = storage.get_league(league_id) or {}
    teams = storage.list_league_teams(league_id)
    sleeper_id = resolve_sleeper_league_id(league_id) or ""
    rules = league.get("rules") or {}
    if sleeper_id:
        scoring = get_sleeper_live_week(str(sleeper_id), hub_teams=teams, week=week,
            viewer_roster_id=str(team.get("sleeper_roster_id") or ""),
            viewer_team_id=team["id"], rules=rules,
            hub_pre_draft=not bool(league.get("draft_completed")))
    else:
        scoring = build_hub_live_week(league_id, week=week, viewer_team_id=team["id"], rules=rules)
    scoring = copy.deepcopy(scoring)
    matchup = next((m for m in scoring.get("matchups", []) if any(
        str(t.get("hub_team_id")) == str(team["id"]) or t.get("is_viewer")
        for t in m.get("teams", []))), {})
    mine = next((t for t in matchup.get("teams", []) if str(t.get("hub_team_id")) == str(team["id"]) or t.get("is_viewer")), {})
    opponent = next((t for t in matchup.get("teams", []) if t is not mine), None)
    season = scoring.get("season") or league.get("season")
    current_week = int(scoring.get("week") or 1)
    placeholder = bool(scoring.get("placeholder") or scoring.get("preseason") or not scoring.get("available"))
    state = "pregame"
    if not placeholder:
        try:
            if current_week < int(scoring.get("current_week") or current_week) or nfl_week_slate_complete(int(season), current_week):
                state = "final"
            elif any(nfl_game_started(p.get("team"), int(season), current_week)
                     for t in matchup.get("teams", []) for p in t.get("starters", []) if p.get("team")):
                state = "live"
            elif any(float(t.get("points") or 0) != 0 for t in matchup.get("teams", [])):
                state = "unknown"
        except (ValueError, TypeError):
            state = "unknown"
    roster = storage.list_roster(league.get("workspace_id"), team["id"]) if league.get("workspace_id") else []
    active = [r for r in roster if r.get("roster_status") != "cut_before_draft"]
    by_id = {str(r["player_id"]): r for r in active}
    by_sleeper = {str(r.get("sleeper_player_id")): r for r in active if r.get("sleeper_player_id")}
    prefs = {}
    with storage.get_conn() as conn:
        row = conn.execute("SELECT prefs_json FROM hub_workspace WHERE user_sub=?", (team.get("user_sub"),)).fetchone()
        if row and row[0]:
            prefs = json.loads(row[0])
    saved = settings(team["id"])
    overrides = json.loads(saved["nicknames_json"])
    imported = sleeper_nicknames(str(sleeper_id), str(team.get("sleeper_roster_id") or ""))

    # The existing live-scoring estimates may refresh during a game. Freeze the
    # room's baseline before kickoff; older games without a capture show no delta.
    for p in (mine.get("starters") or []) + (mine.get("bench_players") or []):
        if not p.get("player_id"):
            continue
        p["proj"] = projection_snapshot(league_id, season, current_week, p.get("player_id"), p.get("proj"),
            started=state in ("final", "unknown") or nfl_game_started(p.get("team"), int(season), current_week))

    def player(p, slot=None):
        r = by_id.get(str(p.get("player_id"))) or by_sleeper.get(str(p.get("sleeper_player_id"))) or p
        pid = str(r.get("player_id") or p.get("player_id") or "")
        sid = str(p.get("sleeper_player_id") or r.get("sleeper_player_id") or "")
        return {"player_id": pid, "name": p.get("name") or r.get("player_name") or "Empty slot",
                "team": p.get("team") or r.get("team"), "position": p.get("position") or r.get("position"),
                "slot": slot, "points": None if placeholder or state == "pregame" else p.get("points"),
                "projection": p.get("proj"), "nickname": overrides.get(pid, imported.get(sid, "")),
                "can_manage": pid in by_id,
                "nickname_override": pid in overrides, "sleeper_nickname": imported.get(sid, "")}
    slots = scoring.get("starting_slots") or []
    starters = [player(p, slots[i] if i < len(slots) else p.get("position")) for i,p in enumerate(mine.get("starters") or [])]
    starter_ids = {p["player_id"] for p in starters if p["player_id"]}
    bench_scores = {str(p.get("player_id")): p for p in mine.get("bench_players", [])}
    historical = current_week < int(scoring.get("current_week") or current_week)
    if historical:
        # A past week's bench belongs to that lineup, not today's roster.
        bench = [player(p) for p in mine.get("bench_players", [])]
    else:
        bench = [player({**r, **bench_scores.get(str(r["player_id"]), {})}) for r in active if str(r["player_id"]) not in starter_ids]
    from src.draft_hub.draft_enrichment import build_player_media_batch
    media = build_player_media_batch([{"player_id": p["player_id"], "player_name": p["name"],
        "team": p["team"], "position": p["position"]} for p in starters + bench if p["player_id"]])
    return {"team": {"id": team["id"], "name": team.get("name"), "owner_name": team.get("owner_name")},
            "photo_media_id": (team.get("identity") or {}).get("photo_media_id"),
            "theme": prefs.get("atmosphere", "none"), "state": state, "week": current_week,
            "season": season, "current_week": scoring.get("current_week", current_week),
            "max_week": min(18, scoring.get("max_week", 18)), "synced_at": scoring.get("synced_at"),
            "available": bool(scoring.get("available")), "placeholder": placeholder,
            "starters": starters, "bench": bench, "media": media,
            "score": None if state == "pregame" else mine.get("points"),
            "opponent": {"name": opponent.get("team_name"), "score": None if state == "pregame" else opponent.get("points")} if opponent else None}
