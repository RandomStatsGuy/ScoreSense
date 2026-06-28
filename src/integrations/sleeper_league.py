"""Map Sleeper league rosters to ScoreSense player IDs (strict GSIS matching)."""

from __future__ import annotations

import re
from typing import Any

import requests

from src.integrations.external_projections import _normalize_name
from src.integrations.sleeper import players_dataframe

SLEEPER_API = "https://api.sleeper.app/v1"
_GSIS_RE = re.compile(r"^00-\d{7}$")
_CAP_SKILL_POSITIONS = frozenset({"QB", "RB", "WR", "TE", "FB"})
_SLEEPER_ROW_MAP: tuple[float, dict[str, Any]] | None = None


def _normalize_skill_position(pos: str) -> str:
    p = str(pos or "").strip().upper()
    if p == "FB":
        return "RB"
    return p


def _valid_gsis(gsis: str) -> bool:
    return bool(_GSIS_RE.match(str(gsis or "").strip()))


def _sleeper_row_map(players_df=None) -> dict[str, Any]:
    """Cached sleeper_id → dataframe row; rebuilding per player was pathologically slow."""
    global _SLEEPER_ROW_MAP
    from src.integrations.sleeper import PLAYERS_CACHE

    mtime = PLAYERS_CACHE.stat().st_mtime if PLAYERS_CACHE.exists() else 0.0
    if _SLEEPER_ROW_MAP and _SLEEPER_ROW_MAP[0] == mtime:
        return _SLEEPER_ROW_MAP[1]

    df = players_df if players_df is not None else players_dataframe()
    row_map = {str(p["sleeper_id"]): p for _, p in df.iterrows()}
    _SLEEPER_ROW_MAP = (mtime, row_map)
    return row_map


def resolve_ownership_roster_player(
    sleeper_player_id: str,
    raw_players: dict[str, Any],
    *,
    aliases: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    """Lightweight Sleeper id → hub player row for season ownership history."""
    info = raw_players.get(str(sleeper_player_id))
    if not info:
        return None
    pos = _normalize_skill_position(str(info.get("position") or ""))
    if not _cap_skill_position(str(info.get("position") or "")):
        return None
    gsis = str(info.get("gsis_id") or "").strip()
    if _valid_gsis(gsis):
        player_id = gsis
    else:
        player_id = f"sleeper-{sleeper_player_id}"
    alias_map = aliases or {}
    player_id = (
        alias_map.get(str(sleeper_player_id))
        or alias_map.get(player_id)
        or alias_map.get(f"sleeper-{sleeper_player_id}")
        or player_id
    )
    return {
        "player_id": player_id,
        "player_name": info.get("full_name") or f"Sleeper {sleeper_player_id}",
        "position": pos,
        "sleeper_player_id": str(sleeper_player_id),
    }


def fetch_league(league_id: str) -> dict[str, Any]:
    url = f"{SLEEPER_API}/league/{league_id}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_league_rosters(league_id: str) -> list[dict[str, Any]]:
    url = f"{SLEEPER_API}/league/{league_id}/rosters"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_league_users(league_id: str) -> list[dict[str, Any]]:
    url = f"{SLEEPER_API}/league/{league_id}/users"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_user_by_username(username: str) -> dict[str, Any]:
    handle = str(username or "").strip().lstrip("@")
    if not handle:
        raise ValueError("Enter a Sleeper username")
    url = f"{SLEEPER_API}/user/{handle}"
    resp = requests.get(url, timeout=30)
    if resp.status_code == 404:
        raise ValueError(f"Sleeper user '{handle}' not found")
    resp.raise_for_status()
    return resp.json()


def list_user_leagues(username: str, season: int | str) -> list[dict[str, Any]]:
    """Leagues for a Sleeper user in a given NFL season."""
    user = fetch_user_by_username(username)
    user_id = str(user.get("user_id") or "")
    url = f"{SLEEPER_API}/user/{user_id}/leagues/nfl/{int(season)}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    leagues = resp.json() or []
    out: list[dict[str, Any]] = []
    for lg in leagues:
        if not lg:
            continue
        out.append(
            {
                "league_id": str(lg.get("league_id") or ""),
                "name": lg.get("name") or "",
                "season": str(lg.get("season") or season),
                "status": lg.get("status") or "",
                "total_rosters": lg.get("total_rosters"),
            }
        )
    out.sort(key=lambda x: str(x.get("name") or "").lower())
    return out


def _team_label(owner: dict[str, Any]) -> str:
    meta = owner.get("metadata") or {}
    return meta.get("team_name") or owner.get("display_name") or owner.get("username") or "Team"


def list_league_teams(sleeper_league_id: str) -> dict[str, Any]:
    league = fetch_league(sleeper_league_id)
    rosters = fetch_league_rosters(sleeper_league_id)
    users = {u["user_id"]: u for u in fetch_league_users(sleeper_league_id)}
    out: list[dict[str, Any]] = []
    for roster in rosters:
        owner = users.get(roster.get("owner_id"), {})
        player_ids = roster.get("players") or []
        for key in ("taxi", "reserve"):
            player_ids = list(player_ids) + [p for p in (roster.get(key) or []) if p]
        out.append(
            {
                "roster_id": str(roster.get("roster_id")),
                "user_id": str(roster.get("owner_id") or ""),
                "team_name": _team_label(owner),
                "owner_name": owner.get("display_name") or owner.get("username") or "",
                "player_count": len(set(str(p) for p in player_ids if p)),
            }
        )
    out.sort(key=lambda t: t["team_name"].lower())
    return {
        "league_id": str(sleeper_league_id),
        "league_name": league.get("name") or "",
        "season": league.get("season"),
        "teams": out,
    }


def _resolve_gsis(sp, players_df) -> str | None:
    gsis = str(sp.get("gsis_id") or "").strip()
    if _valid_gsis(gsis):
        return gsis
    team = str(sp.get("team") or "").strip().upper()
    name = str(sp.get("full_name") or "").strip()
    pos = str(sp.get("position") or "").strip().upper()
    if not name or not team:
        return None
    scoped = players_df[
        (players_df["team"].astype(str).str.upper() == team)
        & (players_df["position"].astype(str).str.upper() == pos)
    ]
    exact = scoped[scoped["full_name"].str.lower() == name.lower()]
    if not exact.empty:
        g = str(exact.iloc[0].get("gsis_id") or "").strip()
        return g if _valid_gsis(g) else None
    key = _normalize_name(name)
    for _, row in scoped.iterrows():
        if _normalize_name(row.get("full_name")) == key:
            g = str(row.get("gsis_id") or "").strip()
            if _valid_gsis(g):
                return g
    return None


def sleeper_player_to_scoresense(
    sleeper_player_id: str,
    players_df=None,
    *,
    allow_sleeper_fallback: bool = True,
) -> dict[str, Any] | None:
    """Resolve Sleeper id → ScoreSense player_id (GSIS preferred, sleeper id fallback)."""
    players_df = players_df if players_df is not None else players_dataframe()
    sp = _sleeper_row_map(players_df).get(str(sleeper_player_id))
    if sp is None:
        return None

    pos = str(sp.get("position") or "").strip().upper()
    if not _cap_skill_position(pos):
        return None

    pos = _normalize_skill_position(pos)

    ss_id = _resolve_gsis(sp, players_df)
    match_tier = "gsis"
    if not ss_id:
        if not allow_sleeper_fallback:
            return None
        ss_id = f"sleeper-{sleeper_player_id}"
        match_tier = "sleeper_fallback"

    return {
        "player_id": ss_id,
        "player_name": sp["full_name"],
        "team": sp.get("team") or "",
        "position": pos,
        "sleeper_player_id": str(sleeper_player_id),
        "match_tier": match_tier,
    }


def _cap_skill_position(pos: str) -> bool:
    return str(pos or "").upper() in _CAP_SKILL_POSITIONS


def _player_row_from_sleeper_info(sleeper_player_id: str, info: dict[str, Any], players_df) -> dict[str, Any] | None:
    """Build a hub roster row from Sleeper player metadata."""
    pos = _normalize_skill_position(str(info.get("position") or ""))
    if not _cap_skill_position(str(info.get("position") or "")):
        return None
    sp = {"full_name": info.get("full_name") or "", "team": info.get("team") or "", "position": info.get("position") or "", "gsis_id": info.get("gsis_id") or ""}
    ss_id = _resolve_gsis(sp, players_df)
    match_tier = "gsis"
    if not ss_id:
        ss_id = f"sleeper-{sleeper_player_id}"
        match_tier = "sleeper_fallback"
    return {
        "player_id": ss_id,
        "player_name": sp["full_name"] or f"Sleeper {sleeper_player_id}",
        "team": sp.get("team") or "",
        "position": pos,
        "sleeper_player_id": str(sleeper_player_id),
        "match_tier": match_tier,
    }


def _lookup_sleeper_player(
    sleeper_player_id: str,
    players_df,
    raw_players: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Resolve a Sleeper roster id to a skill-player row, using cache + raw dict."""
    mapped = sleeper_player_to_scoresense(str(sleeper_player_id), players_df)
    if mapped:
        mapped["position"] = _normalize_skill_position(mapped.get("position"))
        return mapped

    hit = players_df[players_df["sleeper_id"].astype(str) == str(sleeper_player_id)]
    if not hit.empty:
        row = hit.iloc[0]
        pos = str(row.get("position") or "").upper()
        if _cap_skill_position(pos):
            return {
                "player_id": f"sleeper-{sleeper_player_id}",
                "player_name": str(row["full_name"]),
                "team": row.get("team") or "",
                "position": _normalize_skill_position(pos),
                "sleeper_player_id": str(sleeper_player_id),
                "match_tier": "sleeper_fallback",
            }

    if raw_players:
        info = raw_players.get(str(sleeper_player_id))
        if info:
            return _player_row_from_sleeper_info(sleeper_player_id, info, players_df)
    return None


def _roster_player_ids(roster: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for key in ("players", "taxi", "reserve"):
        for pid in roster.get(key) or []:
            if pid and str(pid) not in ids:
                ids.append(str(pid))
    return ids


def _build_roster_snapshot(
    *,
    sleeper_league_id: str,
    roster: dict[str, Any],
    users: dict[str, dict[str, Any]],
    players_df,
    raw_players: dict[str, Any],
) -> dict[str, Any]:
    roster_id = str(roster.get("roster_id"))
    owner = users.get(roster.get("owner_id"), {})
    team_name = _team_label(owner)
    players: list[dict[str, Any]] = []
    unmatched: list[dict[str, str]] = []
    roster_player_ids = _roster_player_ids(roster)
    for sleeper_pid in roster_player_ids:
        mapped = _lookup_sleeper_player(str(sleeper_pid), players_df, raw_players)
        if mapped:
            players.append(mapped)
        else:
            unmatched.append({"sleeper_player_id": str(sleeper_pid), "player_name": str(sleeper_pid)})
    return {
        "league_id": str(sleeper_league_id),
        "roster_id": roster_id,
        "team_name": team_name,
        "owner_name": owner.get("display_name") or owner.get("username") or "",
        "players": players,
        "player_ids": [p["player_id"] for p in players],
        "sleeper_player_ids": [p["sleeper_player_id"] for p in players],
        "mapping": players,
        "unmatched": unmatched,
        "count": len(players),
        "sleeper_roster_size": len(roster_player_ids),
    }


def fetch_all_linked_rosters(sleeper_league_id: str) -> dict[str, dict[str, Any]]:
    """Fetch every team snapshot in one Sleeper league (single players cache load)."""
    from src.integrations.sleeper import load_sleeper_players

    rosters = fetch_league_rosters(sleeper_league_id)
    users = {u["user_id"]: u for u in fetch_league_users(sleeper_league_id)}
    players_df = players_dataframe()
    raw_players = load_sleeper_players()
    out: dict[str, dict[str, Any]] = {}
    for roster in rosters:
        snap = _build_roster_snapshot(
            sleeper_league_id=sleeper_league_id,
            roster=roster,
            users=users,
            players_df=players_df,
            raw_players=raw_players,
        )
        out[str(roster.get("roster_id"))] = snap
    return out


def fetch_linked_roster(
    sleeper_league_id: str,
    sleeper_roster_id: str,
) -> dict[str, Any]:
    rosters = fetch_league_rosters(sleeper_league_id)
    users = {u["user_id"]: u for u in fetch_league_users(sleeper_league_id)}
    target = next((r for r in rosters if str(r.get("roster_id")) == str(sleeper_roster_id)), None)
    if not target:
        raise ValueError("Roster not found in Sleeper league")

    from src.integrations.sleeper import load_sleeper_players

    return _build_roster_snapshot(
        sleeper_league_id=sleeper_league_id,
        roster=target,
        users=users,
        players_df=players_dataframe(),
        raw_players=load_sleeper_players(),
    )


def import_sleeper_roster(
    sleeper_league_id: str,
    team_id: str | None = None,
    default_salary: float = 1.0,
) -> list[dict[str, Any]]:
    if not team_id:
        rosters = fetch_league_rosters(sleeper_league_id)
        if len(rosters) == 1:
            team_id = str(rosters[0].get("roster_id"))
        else:
            raise ValueError("Select your Sleeper team (roster_id) before importing.")

    snapshot = fetch_linked_roster(sleeper_league_id, str(team_id))
    out: list[dict[str, Any]] = []
    for p in snapshot["players"]:
        out.append(
            {
                "player_id": p["player_id"],
                "player_name": p["player_name"],
                "team": p["team"],
                "position": p["position"],
                "salary": default_salary,
                "contract_years": 1,
                "sleeper_player_id": p["sleeper_player_id"],
                "sleeper_team": snapshot["team_name"],
                "source": "sleeper",
            }
        )
    return out
