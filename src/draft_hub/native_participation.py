"""Explicit completed-game inactive proof for actual-scoring writes only.

Sleeper omits some inactive players entirely. ESPN's historical event roster can
establish a real DNP; current injury status and absence from a box score cannot.
Presentation reads and the pure stat resolver never call this provider fallback.
"""
from __future__ import annotations

import copy
import hashlib
import json
import threading
import time
from collections import OrderedDict
from typing import Any
from urllib.parse import urlsplit

from src.draft_hub import native_stats, player_identity
from src.draft_hub.rules_engine import normalize_position

_HOST = "sports.core.api.espn.com"
_BASE = f"https://{_HOST}/v2/sports/football/leagues/nfl"
_VERSION = 1
_CACHE: OrderedDict[str, dict[str, Any]] = OrderedDict()
_LOCK = threading.RLock()
_CACHE_LIMIT = 256
_REQUEST_LIMIT = 8
_CANDIDATE_LIMIT = 4
_fetch_json = native_stats._fetch_json


def _reference(value: Any, path: str) -> bool:
    if not isinstance(value, dict) or not isinstance(value.get("$ref"), str):
        return False
    try:
        url = urlsplit(value["$ref"])
    except ValueError:
        return False
    return (url.scheme in {"http", "https"} and url.netloc == _HOST
            and url.path == f"/v2/sports/football/leagues/nfl{path}" and not url.fragment)


def _cached_json(key: str, url: str, validate, budget: list[int], *, ttl: int) -> dict[str, Any]:
    """Coalesce bounded provider requests, including failures, across leagues."""
    with _LOCK:
        stamp = time.time()
        entry = _CACHE.get(key)
        path = native_stats.NATIVE_STATS_DIR / "participation" / (hashlib.sha256(key.encode()).hexdigest() + ".json")
        if entry is None:
            try:
                entry = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                entry = None
        if entry and entry.get("version") == _VERSION and entry.get("expires_at", 0) > stamp:
            if entry.get("error"):
                raise native_stats.NativeStatsUnavailable("Historical participation proof is temporarily unavailable.")
            payload = entry.get("payload")
            validate(payload)
            _CACHE[key] = entry
            _CACHE.move_to_end(key)
            while len(_CACHE) > _CACHE_LIMIT:
                _CACHE.popitem(last=False)
            return copy.deepcopy(payload)
        if budget[0] <= 0:
            raise native_stats.NativeStatsUnavailable("Historical participation proof request limit reached; retry is required.")
        budget[0] -= 1
        try:
            payload = _fetch_json(url)
            validate(payload)
        except Exception as exc:
            _CACHE[key] = {"version": _VERSION, "expires_at": stamp + 60, "error": True}
            while len(_CACHE) > _CACHE_LIMIT:
                _CACHE.popitem(last=False)
            raise native_stats.NativeStatsUnavailable("Historical participation proof could not be verified.") from exc
        entry = {"version": _VERSION, "expires_at": stamp + ttl, "payload": payload}
        _CACHE[key] = entry
        _CACHE.move_to_end(key)
        while len(_CACHE) > _CACHE_LIMIT:
            _CACHE.popitem(last=False)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(entry, separators=(",", ":")), encoding="utf-8")
            temporary.replace(path)
        except OSError:
            pass  # Verified in-memory evidence remains usable if disk caching fails.
        return copy.deepcopy(payload)


def _roster(season: int, state: dict[str, Any], budget: list[int]) -> dict[str, Any]:
    game, competition, competitor = (str(state.get(field) or "")
                                    for field in ("game_id", "competition_id", "competitor_id"))
    if not all(value.isdigit() for value in (game, competition, competitor)):
        raise native_stats.NativeStatsUnavailable("Historical game participation identity is unavailable.")
    path = f"/events/{game}/competitions/{competition}/competitors/{competitor}/roster"
    def validate(payload):
        if (not isinstance(payload, dict) or not _reference(payload, path)
                or not _reference(payload.get("competition"), f"/events/{game}/competitions/{competition}")
                or not _reference(payload.get("team"), f"/seasons/{season}/teams/{competitor}")
                or not isinstance(payload.get("entries"), list)):
            raise native_stats.NativeStatsUnavailable("Historical game roster does not match the requested event and team.")
    return _cached_json(f"roster:{season}:{game}:{competition}:{competitor}", _BASE + path,
                        validate, budget, ttl=3600)


def _athlete(season: int, entry: dict[str, Any], budget: list[int]) -> dict[str, Any]:
    aid = str(entry.get("playerId") or "")
    path = f"/seasons/{season}/athletes/{aid}"
    if not aid.isdigit() or not _reference(entry.get("athlete"), path):
        raise native_stats.NativeStatsUnavailable("Historical athlete reference cannot be verified.")
    def validate(payload):
        if (not isinstance(payload, dict) or str(payload.get("id")) != aid or not _reference(payload, path)
                or not isinstance(payload.get("position"), dict)):
            raise native_stats.NativeStatsUnavailable("Historical athlete identity does not match its roster reference.")
    return _cached_json(f"athlete:{season}:{aid}", _BASE + path, validate, budget, ttl=86400)


def _candidate(entry: dict[str, Any], name: str) -> bool:
    """Abbreviations only bound profile requests; they never establish identity."""
    words = name.split()
    if len(words) < 2:
        return False
    short = native_stats._name(entry.get("displayName"))
    surname = native_stats._name(" ".join(words[1:]))
    return short in {native_stats._name(name), surname, native_stats._name(words[0][:1]) + surname}


def _proof(row: dict[str, Any], snapshot: dict[str, Any], season: int, week: int,
           budget: list[int]) -> tuple[dict[str, Any], dict[str, Any]] | None:
    pid, sid = str(row.get("player_id") or ""), str(row.get("sleeper_player_id") or "")
    try:
        known = player_identity.cached_player_identity(pid, season=season, sleeper_player_id=sid or None)
    except player_identity.PlayerIdentityError:
        return None
    if not known or pid not in known["aliases"] or known["position"] == "DEF":
        return None
    unique = player_identity.cached_unique_name_identity(known["player_name"], known["position"], season=season)
    if unique is None or unique["player_id"] != known["player_id"]:
        return None
    # Any real record wins, even when its historical team differs from today's
    # catalog or a saved label. Inactive proof never overwrites played zeros.
    if any(alias in snapshot.get("stats", {}) for alias in known["aliases"]):
        return None
    if any(native_stats._name(record.get("name")) == native_stats._name(known["player_name"])
           and record.get("position") == known["position"] and record.get("stats") is not None
           for record in snapshot.get("records") or []):
        return None
    # The saved event-team remains the candidate after a subsequent NFL trade.
    # Its historical roster membership, not the current athlete team, proves it.
    team = native_stats._team(row.get("nfl_team") or row.get("team") or known["team"])
    state = (snapshot.get("game_states") or {}).get(team)
    if (team not in native_stats.NFL_TEAMS or not state or state.get("game_state") != "final"
            or state.get("completed") is not True):
        return None
    roster = _roster(season, state, budget)
    candidates = [entry for entry in roster["entries"] if isinstance(entry, dict)
                  and type(entry.get("period")) is int and entry.get("period") == 0
                  and _candidate(entry, known["player_name"])]
    if (not candidates or len(candidates) > _CANDIDATE_LIMIT
            or any(entry.get("didNotPlay") is not True for entry in candidates)):
        return None
    matches = []
    for entry in candidates:
        profile = _athlete(season, entry, budget)
        position = normalize_position((profile.get("position") or {}).get("abbreviation"))
        position_id = str((profile.get("position") or {}).get("id") or "")
        if (not position_id.isdigit() or not _reference(entry.get("position"), f"/positions/{position_id}")
                or not _reference(profile.get("position"), f"/positions/{position_id}")):
            return None
        if (native_stats._name(profile.get("fullName")) == native_stats._name(known["player_name"])
                and position == known["position"]):
            matches.append(entry)
    if len(matches) != 1 or matches[0].get("didNotPlay") is not True:
        return None
    entry = matches[0]
    if any(str(other.get("playerId")) == str(entry["playerId"]) and other is not entry
           for other in roster["entries"] if isinstance(other, dict)):
        return None
    proof = {"version": _VERSION, "source": "espn_game_roster", "season": int(season), "week": int(week),
             "game_id": str(state["game_id"]), "competition_id": str(state["competition_id"]),
             "competitor_id": str(state["competitor_id"]), "espn_player_id": str(entry["playerId"]),
             "name": known["player_name"], "position": known["position"], "team": team,
             "did_not_play": True}
    return known, proof


def enrich_inactive_players(snapshot: dict[str, Any], rows: list[dict[str, Any]],
                            season: int, week: int) -> dict[str, Any]:
    """Fetch only for actual scoring/corrections, retaining failures as unknown.

    The caller must still resolve all starters and enforce finality/lineup CAS.
    Evidence is copied into this scoring snapshot; the shared raw feed stays
    untouched, and fingerprints depend only on proof relevant to these rows.
    """
    if (snapshot.get("season", int(season)) != int(season)
            or snapshot.get("week", int(week)) != int(week)):
        return snapshot
    result = copy.deepcopy(snapshot)
    proofs = dict(result.get("inactive_proofs") or {})
    warnings = []
    budget = [_REQUEST_LIMIT]
    for row in sorted(rows, key=lambda item: item.get("lineup_role", "bench" if item.get("slot") == "BN" else "starter") != "starter"):
        try:
            native_stats.resolve_lineup_stats(row, result)
            continue
        except native_stats.NativeStatsUnavailable:
            pass
        try:
            verified = _proof(row, result, int(season), int(week), budget)
        except native_stats.NativeStatsUnavailable as exc:
            warnings.append(str(exc))
            continue
        if verified is None:
            continue
        known, proof = verified
        key = str(known["player_id"])
        proofs[key] = proof
        stats = {**native_stats.zero_stats(), "_native_no_game": 1.0, "_native_inactive": 1.0,
                 "_native_inactive_proof": proof}
        identity = {"name": proof["name"], "team": proof["team"], "position": proof["position"],
                    "sleeper_player_id": known.get("sleeper_player_id"), "played": False,
                    "game_id": proof["game_id"], "source": proof["source"]}
        for alias in known["aliases"]:
            # _proof has already rejected any present real alias/record.
            result.setdefault("stats", {})[alias] = stats
            result.setdefault("identities", {})[alias] = identity
        result.setdefault("records", []).append({**identity, "stats": stats})
    if proofs:
        result["inactive_proofs"] = proofs
        base = result.get("raw_stats_fingerprint") or snapshot.get("fingerprint") or ""
        result["raw_stats_fingerprint"] = base
        result["fingerprint"] = hashlib.sha256(json.dumps({"raw": base, "inactive": proofs}, sort_keys=True).encode()).hexdigest()
    if warnings:
        result["participation_warnings"] = sorted(set(warnings))
    return result


def clear_participation_cache() -> None:
    with _LOCK:
        _CACHE.clear()
