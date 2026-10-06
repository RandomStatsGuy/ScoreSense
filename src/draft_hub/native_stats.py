"""Shared actual-stat feed for native leagues, with explicit game completion.

Sleeper's raw statistics are counts, not its league fantasy-point totals. Native
league weights are applied locally. ESPN supplies independent game states. Both
public endpoints are provider-owned; their payloads are validated because the raw
statistics endpoint is not covered by Sleeper's published API stability contract.
No Fantasy presentation read makes a provider request through this module.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from src.config import (
    CACHE_DIR, NATIVE_SCORING_REFRESH_SECONDS, NATIVE_SCORING_REQUEST_TIMEOUT,
    NATIVE_SCORING_STATS_URL, NATIVE_SCORING_SCOREBOARD_URL,
)
from src.core.team_codes import normalize_team_for_match
from src.draft_hub.schemas import ScoringRules

NATIVE_STATS_DIR = CACHE_DIR / "native_scores"
_MEMORY: dict[tuple[int, int], tuple[float, dict[str, Any]]] = {}
_LOCK = threading.RLock()
SOURCE = "sleeper_raw_stats+espn_status"
SCHEDULE_COVERAGE_VERSION = 1
NFL_TEAMS = frozenset("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LA LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split())


class NativeStatsUnavailable(ValueError):
    """Missing or ambiguous actual statistics; never publish a fabricated zero."""


def _team(value: Any) -> str:
    return normalize_team_for_match(str(value or "").strip().upper())


def _name(value: Any) -> str:
    import re
    return re.sub(r"[^a-z0-9]", "", str(value or "").casefold())


def _number(value: Any) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise NativeStatsUnavailable("The actual-stat feed contains an invalid number.")
    return result


def zero_stats() -> dict[str, float]:
    return {key: 0.0 for key in ScoringRules.model_fields if not key.startswith("def_points_allowed_")}


def normalize_nflverse_stats(raw: dict[str, Any]) -> dict[str, Any]:
    """Explicit compatibility aliases for imported historical actual statistics."""
    out = dict(raw)
    aliases = {
        "passing_interceptions": "interceptions", "fg_made_60_": "fg_made_60_plus",
        "def_tds": "def_touchdowns", "def_safety": "def_safeties",
        "def_fumble_recovery_opp": "def_fumble_recoveries",
    }
    for old, new in aliases.items():
        if old in out and new not in out:
            out[new] = out[old]
    return out


def normalize_sleeper_stats(raw: dict[str, Any], position: str) -> dict[str, float]:
    """Translate a present sparse provider record; omitted counters mean zero.

    A missing record is handled separately by resolve_lineup_stats, and cannot be
    treated as a sparse record. In particular missing points allowed is not zero.
    """
    if not isinstance(raw, dict) or not raw:
        raise NativeStatsUnavailable("The player actual-stat record is unavailable.")
    values = {key: _number(value) for key, value in raw.items() if value is not None}
    out = zero_stats()
    aliases = {
        "passing_yards": "pass_yd", "passing_tds": "pass_td", "interceptions": "pass_int",
        "rushing_yards": "rush_yd", "rushing_tds": "rush_td", "receptions": "rec",
        "receiving_yards": "rec_yd", "receiving_tds": "rec_td", "fumbles_lost": "fum_lost",
        "passing_2pt_conversions": "pass_2pt", "rushing_2pt_conversions": "rush_2pt",
        "receiving_2pt_conversions": "rec_2pt", "pat_made": "xpm", "pat_missed": "xpmiss",
        "fg_made_0_19": "fgm_0_19", "fg_made_20_29": "fgm_20_29",
        "fg_made_30_39": "fgm_30_39", "fg_made_40_49": "fgm_40_49",
        "fg_made_50_59": "fgm_50_59", "fg_made_60_plus": "fgm_60p",
        "fg_missed": "fgmiss", "def_sacks": "sack", "def_interceptions": "int",
        "def_safeties": "safe", "def_blocked_kicks": "blk_kick", "def_2pt_returns": "def_2pt",
    }
    for target, source in aliases.items():
        out[target] = values.get(source, 0.0)
    out["special_teams_tds"] = values.get("st_td", sum(values.get(k, 0.0) for k in ("kr_td", "pr_td", "blk_kick_ret_td", "blk_pr_td")))
    out["def_touchdowns"] = values.get("def_td", 0.0) + values.get("def_st_td", 0.0)
    out["def_fumble_recoveries"] = values.get("fum_rec", 0.0) + values.get("def_st_fum_rec", 0.0)
    if position == "K":
        # Blocked attempts are misses too. The attempt totals are authoritative.
        if "fga" in values:
            out["fg_missed"] = max(0.0, values["fga"] - values.get("fgm", 0.0))
        if "xpa" in values:
            out["pat_missed"] = max(0.0, values["xpa"] - values.get("xpm", 0.0))
        made_bands = sum(out[k] for k in out if k.startswith("fg_made_"))
        if "fgm" in values and made_bands != values["fgm"]:
            raise NativeStatsUnavailable("Kicker field-goal distance statistics are incomplete.")
    if position == "DEF":
        if "pts_allow" not in values:
            raise NativeStatsUnavailable("Defense points-allowed statistics are unavailable.")
        out["def_points_allowed"] = values["pts_allow"]
    return out


def parse_scoreboard(payload: dict[str, Any], season: int, week: int) -> dict[str, dict[str, Any]]:
    """Only explicit final status confirms completion, including rescheduled games."""
    if int((payload.get("season") or {}).get("year") or 0) != int(season) or int((payload.get("week") or {}).get("number") or 0) != int(week):
        raise NativeStatsUnavailable("The NFL game-status feed returned a different season or week.")
    if int((payload.get("season") or {}).get("type") or 0) != 2:
        raise NativeStatsUnavailable("The NFL game-status feed did not return the regular season.")
    states: dict[str, dict[str, Any]] = {}
    for event in payload.get("events") or []:
        for competition in event.get("competitions") or []:
            if not event.get("id") or len(competition.get("competitors") or []) != 2:
                raise NativeStatsUnavailable("The NFL game-status feed contains an incomplete matchup.")
            status = (competition.get("status") or event.get("status") or {}).get("type") or {}
            completed = status.get("completed") is True and status.get("state") == "post"
            state = "final" if completed else "live" if status.get("state") == "in" else "pregame" if status.get("state") == "pre" and status.get("name") in {"STATUS_SCHEDULED", "STATUS_DELAYED"} else "unknown"
            for competitor in competition.get("competitors") or []:
                team = _team((competitor.get("team") or {}).get("abbreviation"))
                if team not in NFL_TEAMS or team in states:
                    raise NativeStatsUnavailable("The NFL game-status feed is missing a team identity.")
                states[team] = {"game_state": state, "completed": completed,
                                "kickoff_at": competition.get("date") or event.get("date"),
                                "game_id": str(event.get("id") or "")}
    if not states:
        raise NativeStatsUnavailable("The NFL game-status feed has no games for this week.")
    return states


def parse_sleeper_week(rows: list[dict[str, Any]], season: int, week: int,
                      *, players: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(rows, list) or not rows:
        raise NativeStatsUnavailable("The weekly actual-stat feed is unavailable.")
    index: dict[str, dict[str, float]] = {}
    identities: dict[str, dict[str, Any]] = {}
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    for row in rows:
        if row.get("category") != "stat" or int(row.get("season") or 0) != int(season) or int(row.get("week") or 0) != int(week) or row.get("season_type") != "regular":
            raise NativeStatsUnavailable("The actual-stat feed returned a different scoring period.")
        sid = str(row.get("player_id") or "").strip()
        info = row.get("player") or {}
        known = (players or {}).get(sid) or {}
        position = str(info.get("position") or known.get("position") or "").upper()
        if position in {"D", "DST", "D/ST"}:
            position = "DEF"
        if position not in {"QB", "RB", "WR", "TE", "K", "DEF"} or not sid:
            continue
        name = " ".join(str(info.get(k) or known.get(k) or "").strip() for k in ("first_name", "last_name")).strip()
        raw_stats = row.get("stats")
        played = isinstance(raw_stats, dict) and _number(raw_stats.get("gp") or 0) > 0
        identity = {"sleeper_player_id": sid, "name": name or known.get("full_name") or "",
                    "team": _team(row.get("team")), "position": position,
                    "updated_at": row.get("updated_at"), "game_id": row.get("game_id"), "played": played}
        try:
            stats = normalize_sleeper_stats(row.get("stats"), position)
        except NativeStatsUnavailable as exc:
            errors.append(f"{name or sid}: {exc}")
            records.append({**identity, "stats": None, "error": str(exc)})
            continue
        aliases = {sid, f"sleeper-{sid}"}
        gsis = str(known.get("gsis_id") or info.get("gsis_id") or "").strip()
        if gsis:
            aliases.add(gsis)
        if position == "DEF":
            aliases.update({identity["team"], f"sleeper-{identity['team']}"})
        for alias in aliases:
            if alias:
                index[alias] = stats
                identities[alias] = identity
        records.append({**identity, "stats": stats})
    if not records:
        raise NativeStatsUnavailable("The actual-stat feed contains no supported players.")
    return {"stats": index, "identities": identities, "records": records, "errors": errors}


def resolve_lineup_stats(row: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, float]:
    """Known unstarted/bye players score zero; unavailable started players fail."""
    states = snapshot.get("game_states") or {}
    position = str(row.get("position") or "").upper()
    if position in {"D", "DST", "D/ST"}:
        position = "DEF"
    team = _team(row.get("nfl_team") or row.get("team"))
    sid = str(row.get("sleeper_player_id") or "")
    pid = str(row.get("player_id") or "")
    aliases = [pid, sid, f"sleeper-{sid}" if sid else ""]
    if position == "DEF":
        aliases.extend([team, f"sleeper-{team}"])
    stats = None
    for alias in aliases:
        identity = (snapshot.get("identities") or {}).get(alias)
        if identity and identity.get("position") == position:
            # Historical event-team beats today's NFL team after a trade.
            team = identity.get("team") or team
            stats = (snapshot.get("stats") or {}).get(alias)
            break
    if stats is None:
        name = _name(row.get("player_name") or row.get("name"))
        matches = [r for r in snapshot.get("records") or []
                   if name and _name(r.get("name")) == name and r.get("team") == team
                   and r.get("position") == position]
        if len(matches) == 1:
            stats = matches[0].get("stats")
        elif len(matches) > 1:
            raise NativeStatsUnavailable(f"Actual player identity is ambiguous for {row.get('player_name') or pid}.")
    if team not in NFL_TEAMS:
        raise NativeStatsUnavailable(f"NFL team is unavailable for {row.get('player_name') or pid}.")
    state = states.get(team)
    if state is None and snapshot.get("schedule_complete"):
        return {**zero_stats(), "_native_no_game": 1.0}  # Confirmed bye, not a shutout.
    if state and state.get("game_state") == "pregame":
        return {**zero_stats(), "_native_no_game": 1.0}
    if not state or state.get("game_state") == "unknown":
        raise NativeStatsUnavailable(f"NFL game status is unavailable for {team}.")
    if stats is None:
        raise NativeStatsUnavailable(f"Actual statistics are unavailable for {row.get('player_name') or pid}.")
    # DEF records must be actual played-game rows, never an empty speculative band.
    if position == "DEF" and "def_points_allowed" not in stats:
        raise NativeStatsUnavailable(f"Defense points-allowed statistics are unavailable for {team}.")
    return dict(stats)


def _path(season: int, week: int) -> Path:
    return NATIVE_STATS_DIR / f"{int(season)}_w{int(week)}.json"


def cached_scheduled_games(season: int, week: int) -> set[tuple[str, str]] | None:
    """Corroborate byes against a complete cached season; never fetch schedules."""
    from src.core.schedule_utils import SCHEDULE_CACHE
    if not SCHEDULE_CACHE.exists():
        return None
    try:
        import pandas as pd
        frame = pd.read_parquet(SCHEDULE_CACHE)
        required = {"season", "week", "game_type", "home_team", "away_team"}
        if not required <= set(frame.columns):
            return None
        games = frame[(pd.to_numeric(frame["season"], errors="coerce") == int(season))
                      & (frame["game_type"] == "REG")]
        team_weeks: dict[str, set[int]] = {}
        scheduled = set()
        for row in games.itertuples(index=False):
            game_week = int(row.week)
            if not 1 <= game_week <= 18:
                return None
            home, away = _team(row.home_team), _team(row.away_team)
            if home not in NFL_TEAMS or away not in NFL_TEAMS or home == away:
                return None
            for team in (home, away):
                if game_week in team_weeks.setdefault(team, set()):
                    return None
                team_weeks[team].add(game_week)
            if game_week == int(week):
                scheduled.add(tuple(sorted((home, away))))
        expected_games = 17 if int(season) >= 2021 else 16
        if set(team_weeks) != NFL_TEAMS or any(len(weeks) != expected_games for weeks in team_weeks.values()):
            return None
        return scheduled
    except (OSError, ValueError, TypeError, KeyError):
        return None


def cached_scheduled_teams(season: int, week: int) -> set[str] | None:
    games = cached_scheduled_games(season, week)
    return None if games is None else {team for game in games for team in game}


def _validated_cached_snapshot(data: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(data)
    if result.get("schedule_coverage_version") != SCHEDULE_COVERAGE_VERSION:
        # Old snapshots asserted completeness from an arbitrary event subset.
        # Retain actuals/game locks but never retain that unverified bye claim.
        result.update(schedule_complete=False, complete=False, all_final_since=None,
                      scoring_pending_reason="Cached NFL schedule coverage is unverified; waiting for a refreshed scoring snapshot.")
    return result


def cached_week_snapshot(season: int, week: int) -> dict[str, Any] | None:
    """Read only the last successful shared snapshot; never contact a provider."""
    key = int(season), int(week)
    with _LOCK:
        hit = _MEMORY.get(key)
        if hit:
            return _validated_cached_snapshot(hit[1])
    try:
        data = json.loads(_path(*key).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return _validated_cached_snapshot(data) if data.get("season") == key[0] and data.get("week") == key[1] else None


def _fetch_json(url: str) -> Any:
    response = requests.get(url, timeout=NATIVE_SCORING_REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.json()


def get_week_snapshot(season: int, week: int, *, force_refresh: bool = False) -> dict[str, Any]:
    """One provider refresh shared by every native league in a scoring period."""
    key = int(season), int(week)
    with _LOCK:
        hit = _MEMORY.get(key)
        if hit and not force_refresh and time.monotonic() - hit[0] < NATIVE_SCORING_REFRESH_SECONDS:
            return _validated_cached_snapshot(hit[1])
        try:
            states = parse_scoreboard(_fetch_json(NATIVE_SCORING_SCOREBOARD_URL.format(season=key[0], week=key[1])), *key)
            rows = _fetch_json(NATIVE_SCORING_STATS_URL.format(season=key[0], week=key[1]))
            # The existing integration maintains a shared player cache/crosswalk.
            from src.integrations.sleeper import load_sleeper_players
            if rows == [] and all(state["game_state"] == "pregame" for state in states.values()):
                parsed = {"stats": {}, "identities": {}, "records": [], "errors": []}
            else:
                parsed = parse_sleeper_week(rows, *key, players=load_sleeper_players())
        except NativeStatsUnavailable:
            raise
        except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
            raise NativeStatsUnavailable(f"Native actual statistics could not refresh: {exc}") from exc
        fetched_at = datetime.now(timezone.utc).isoformat()
        previous = cached_week_snapshot(*key)
        # A partial scoreboard must not turn a played/scheduled NFL game into
        # a purported bye. Event identities on raw player/team records provide
        # an independent consistency check without another provider request.
        stats_teams = {r["team"] for r in parsed["records"] if r.get("game_id") and r["team"] in NFL_TEAMS}
        absent_status = sorted(stats_teams - set(states))
        if absent_status:
            raise NativeStatsUnavailable(f"NFL game statuses are unavailable for scheduled teams {', '.join(absent_status)}.")
        expected_games = cached_scheduled_games(*key)
        expected_teams = None if expected_games is None else {team for game in expected_games for team in game}
        if expected_teams is not None and set(states) != expected_teams:
            missing = sorted(expected_teams - set(states))
            unexpected = sorted(set(states) - expected_teams)
            detail = ", ".join(missing or unexpected)
            raise NativeStatsUnavailable(f"NFL game statuses do not match the cached schedule for teams {detail}.")
        if expected_games is not None:
            reported_games: dict[str, set[str]] = {}
            for team, state in states.items():
                reported_games.setdefault(state["game_id"], set()).add(team)
            if {tuple(sorted(teams)) for teams in reported_games.values()} != expected_games:
                raise NativeStatsUnavailable("NFL game matchups do not match the cached season schedule.")
        # A full 32-team slate is independently complete. On bye weeks a
        # missing event/record is indistinguishable from an unplayed game until
        # a complete season schedule corroborates which teams are on bye.
        schedule_complete = expected_teams is not None or set(states) == NFL_TEAMS
        pending_reason = None if schedule_complete else "NFL schedule coverage is unverified; results remain pending until the season schedule is available."
        complete = schedule_complete and bool(states) and all(s["completed"] for s in states.values())
        if complete:
            # A final scoreboard alone cannot establish that a delayed stats
            # feed has supplied every game's actual data. Team defense rows
            # cover every game even for offense-only Fantasy configurations.
            reported = {r["team"] for r in parsed["records"]
                        if r["position"] == "DEF" and r.get("played") and r.get("stats") is not None
                        and "def_points_allowed" in r["stats"]}
            missing = sorted(set(states) - reported)
            if missing:
                raise NativeStatsUnavailable(f"Final NFL team statistics are still unavailable for {', '.join(missing)}.")
        final_since = (previous or {}).get("all_final_since") if complete else None
        canonical = {"stats": parsed["stats"], "game_states": states, "schedule_complete": schedule_complete}
        fingerprint = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
        data = {**parsed, "season": key[0], "week": key[1], "source": SOURCE,
                "game_states": states, "complete": complete, "schedule_complete": schedule_complete,
                "schedule_coverage_version": SCHEDULE_COVERAGE_VERSION,
                "scoring_pending_reason": pending_reason,
                "fetched_at": fetched_at, "fingerprint": fingerprint,
                "all_final_since": final_since or (fetched_at if complete else None)}
        NATIVE_STATS_DIR.mkdir(parents=True, exist_ok=True)
        destination = _path(*key)
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        temporary.replace(destination)
        _MEMORY[key] = time.monotonic(), data
        return copy.deepcopy(data)


def load_native_week_stats(season: int, week: int) -> dict[str, dict[str, float]]:
    return get_week_snapshot(season, week)["stats"]


def clear_native_stats_cache() -> None:
    with _LOCK:
        _MEMORY.clear()
