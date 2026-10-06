"""Cache-only player identity for competitive roster writes and kickoff locks."""
from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any

import pandas as pd

from src.config import DRAFT_POOL_DIR
from src.core.team_codes import normalize_team_for_match
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.player_name_match import roster_name_key

NFL_TEAMS = frozenset("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LA LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split())
POSITIONS = frozenset({"QB", "RB", "WR", "TE", "K", "DEF"})
_GSIS = re.compile(r"^00-\d{7}$")
_LOCK = threading.RLock()
_INDEX: dict[tuple, dict[str, dict[str, Any] | None]] = {}


class PlayerIdentityError(ValueError):
    """An acquisition cannot establish one trusted player identity."""


def _text(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _stamp(path: Path) -> tuple[str, int, int]:
    try:
        stat = path.stat()
        return str(path), stat.st_mtime_ns, stat.st_size
    except OSError:
        return str(path), 0, 0


def _identity(pid: str, name: str, team: str, position: str, *, sid="", gsis="") -> dict[str, Any] | None:
    team = normalize_team_for_match(team)
    position = normalize_position(position)
    if team == "FREE_AGENT":
        team = "FA"
    if position not in POSITIONS or team not in NFL_TEAMS | {"FA"} or (position == "DEF" and team not in NFL_TEAMS):
        return None
    aliases = {pid}
    if sid:
        aliases.update({sid, f"sleeper-{sid}"})
    if _GSIS.fullmatch(gsis):
        aliases.add(gsis)
    if position == "DEF":
        canonical = team
        team_aliases = {team, "LAR" if team == "LA" else team,
                        "WSH" if team == "WAS" else team,
                        "JAC" if team == "JAX" else team,
                        "OAK" if team == "LV" else team}
        for code in team_aliases:
            aliases.update({code, f"sleeper-{code}", f"def-{code}", f"DEF-{code}"})
        sid = sid or team
    else:
        canonical = gsis if _GSIS.fullmatch(gsis) else pid
        if canonical.startswith("sleeper-"):
            canonical = canonical[8:]
        sid = sid or (canonical if canonical.isdigit() else "")
    if sid:
        aliases.update({sid, f"sleeper-{sid}"})
    aliases.add(canonical)
    return {"player_id": canonical, "player_name": name or (f"{team} DEF" if position == "DEF" else pid),
            "team": team, "position": position, "sleeper_player_id": sid or None,
            "aliases": tuple(sorted(a for a in aliases if a))}


def _put(index: dict[str, dict[str, Any] | None], identity: dict[str, Any]) -> None:
    for alias in identity["aliases"]:
        prior = index.get(alias)
        if alias in index and (prior is None or prior["player_id"] != identity["player_id"]):
            index[alias] = None
        else:
            index[alias] = identity


def _cached_index(season: int | None) -> dict[str, dict[str, Any] | None]:
    from src.integrations.sleeper import PLAYERS_CACHE

    pool_path = DRAFT_POOL_DIR / f"pool_{int(season)}.parquet" if season is not None else None
    stamp = (_stamp(PLAYERS_CACHE), _stamp(pool_path) if pool_path else None)
    with _LOCK:
        if stamp in _INDEX:
            return _INDEX[stamp]
        index: dict[str, dict[str, Any] | None] = {}
        try:
            raw = json.loads(PLAYERS_CACHE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = {}
        for sid, info in raw.items() if isinstance(raw, dict) else []:
            if not isinstance(info, dict):
                continue
            name = _text(info.get("full_name")) or " ".join(
                _text(info.get(k)) for k in ("first_name", "last_name")).strip()
            identity = _identity(str(sid), name, _text(info.get("team")) or "FA",
                                 _text(info.get("position")), sid=str(sid), gsis=_text(info.get("gsis_id")))
            if identity:
                _put(index, identity)
        if pool_path and pool_path.exists():
            try:
                rows = pd.read_parquet(pool_path).to_dict(orient="records")
            except (OSError, ValueError, ImportError):
                rows = []
            by_name: dict[tuple[str, str], list[dict[str, Any]]] = {}
            unique = {identity["player_id"]: identity for identity in index.values() if identity}
            for identity in unique.values():
                by_name.setdefault((roster_name_key(identity["player_name"]), identity["position"]), []).append(identity)
            for row in rows:
                pid = _text(row.get("player_id"))
                if not pid or pid in index:
                    continue  # Current cached provider identity wins over frozen pool labels.
                name = _text(row.get("Player") or row.get("player_name") or row.get("player"))
                position = normalize_position(row.get("Position") or row.get("position"))
                matches = by_name.get((roster_name_key(name), position), [])
                if len(matches) == 1:
                    # Both names come from server caches. A unique name/position
                    # joins a pool GSIS ID when Sleeper omitted that crosswalk.
                    previous = matches[0]
                    if _GSIS.fullmatch(pid) and _GSIS.fullmatch(previous["player_id"]) and pid != previous["player_id"]:
                        continue  # A frozen pool cannot replace a known provider ID.
                    canonical = pid if _GSIS.fullmatch(pid) else previous["player_id"]
                    identity = {**previous, "player_id": canonical,
                                "aliases": tuple(sorted(set(previous["aliases"]) | {pid, canonical}))}
                    for alias in previous["aliases"]:
                        if index.get(alias) and index[alias]["player_id"] == previous["player_id"]:
                            index[alias] = identity
                    matches[0] = identity
                    _put(index, identity)
                    continue
                if len(matches) > 1:
                    continue  # Ambiguous crosswalk cannot authorize another identity.
                identity = _identity(pid, name,
                                     _text(row.get("Team") or row.get("team")),
                                     position,
                                     sid=_text(row.get("sleeper_player_id")),
                                     gsis=pid if _GSIS.fullmatch(pid) else "")
                if identity:
                    _put(index, identity)
        # A defense is the NFL team itself; it does not depend on a player crosswalk.
        for team in NFL_TEAMS:
            identity = _identity(team, f"{team} DEF", team, "DEF", sid=team)
            if team not in index:
                _put(index, identity)
        _INDEX.clear()
        _INDEX[stamp] = index
        return index


def cached_player_identity(player_id: str, *, season: int | None = None,
                           sleeper_player_id: str | None = None) -> dict[str, Any] | None:
    """Resolve trusted IDs without a model call, provider request, or artifact write."""
    index = _cached_index(season)
    pid = _text(player_id)
    sid = _text(sleeper_player_id)
    primary = index.get(pid)
    linked = index.get(sid) if sid else None
    if primary and sid and (linked is None or linked["player_id"] != primary["player_id"]):
        raise PlayerIdentityError("The Sleeper player id does not match this player.")
    if pid in index and primary is None:
        raise PlayerIdentityError("The cached player identity is ambiguous.")
    identity = primary or linked
    return dict(identity) if identity else None



def cached_unique_name_identity(name: str, position: str, *, season: int | None = None) -> dict[str, Any] | None:
    """Join an exact provider full name to one cached canonical player only.

    Current NFL team is deliberately excluded: participation proof must retain
    its historical event team. Aliases of one player do not create a collision,
    but two canonical players with the same full name and position do.
    """
    key = re.sub(r"[^a-z0-9]", "", str(name or "").casefold())
    position = normalize_position(position)
    if not key or position not in POSITIONS:
        return None
    matches = {
        identity["player_id"]: identity
        for identity in _cached_index(season).values()
        if identity and identity["position"] == position
        and re.sub(r"[^a-z0-9]", "", str(identity["player_name"] or "").casefold()) == key
    }
    return dict(next(iter(matches.values()))) if len(matches) == 1 else None


def resolve_acquisition_identity(row: dict[str, Any], *, season: int) -> dict[str, Any]:
    """Validate position/IDs and normalize names and stale NFL teams to trusted metadata."""
    identity = cached_player_identity(row.get("player_id"), season=season,
                                      sleeper_player_id=row.get("sleeper_player_id"))
    if not identity or _text(row.get("player_id")) not in identity["aliases"]:
        raise PlayerIdentityError("Player identity is unavailable. Refresh available players and try again.")
    if normalize_position(row.get("position")) != identity["position"]:
        raise PlayerIdentityError("The submitted position does not match this player.")
    return {**row, **{k: identity[k] for k in ("player_id", "player_name", "team", "position", "sleeper_player_id")}}


def player_identity_aliases(row: dict[str, Any], *, season: int | None = None) -> set[str]:
    """Expand known aliases; literal IDs still protect manual/legacy unknown players."""
    pid, sid = _text(row.get("player_id")), _text(row.get("sleeper_player_id"))
    identity = cached_player_identity(pid, season=season, sleeper_player_id=sid)
    aliases = set(identity["aliases"]) if identity else set()
    for value in (pid, sid):
        if value:
            aliases.add(value)
            if value.startswith("sleeper-"):
                aliases.add(value[8:])
            elif value.isdigit():
                aliases.add(f"sleeper-{value}")
    return aliases


def canonical_roster_metadata(rows: list[dict[str, Any]], *, season: int | None = None) -> list[dict[str, Any]]:
    """Trusted position/team for validation; retain stored IDs and all financial state."""
    result = []
    for row in rows:
        identity = cached_player_identity(row.get("player_id"), season=season,
                                          sleeper_player_id=row.get("sleeper_player_id"))
        if identity:
            row = {**row, "position": identity["position"], "team": identity["team"]}
            if "nfl_team" in row:
                row["nfl_team"] = identity["team"]
        else:
            row = dict(row)
        result.append(row)
    return result


def clear_player_identity_cache() -> None:
    with _LOCK:
        _INDEX.clear()
