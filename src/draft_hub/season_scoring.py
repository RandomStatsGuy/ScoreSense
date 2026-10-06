"""Materialized player game logs. Page reads never call a scoring host."""
import json
import math
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from collections import defaultdict
from src.draft_hub import storage
from src.draft_hub.roster_identity_match import name_pos_key
from src.draft_hub.rules_engine import normalize_position

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="season-scores")
_pending = set()
_lock = Lock()
_last_attempt = {}


def warm_native(league):
    """Bounded cache recovery for older leagues; HTTP reads stay DB-only."""
    key = str(league["id"])
    with _lock:
        if key in _pending:
            return True
        if len(_pending) >= 2 or time.monotonic() - _last_attempt.get(key, -60) < 60:
            return False
        _pending.add(key)
        if len(_last_attempt) >= 100:
            _last_attempt.pop(next(iter(_last_attempt)))
        _last_attempt[key] = time.monotonic()
    def work():
        try:
            refresh_native_season(league)
        except Exception:
            logging.getLogger(__name__).warning("Season scoring warm failed for %s", key, exc_info=True)
        finally:
            with _lock:
                _pending.discard(key)
    _executor.submit(work)
    return True


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def save_week(source, season, week, players):
    with storage.get_conn() as conn:
        conn.execute("INSERT OR REPLACE INTO player_season_week(source,season,week,payload_json,updated_at) VALUES (?,?,?,?,?)",
                     (source, int(season), int(week), json.dumps(players), str(time.time_ns())))


def native_week(league_id, season, week, lookup, scoring):
    from src.draft_hub.hub_scoring import fantasy_points_from_stats, require_position_stats
    grouped = {}
    for alias, stats in lookup.items():
        if not stats.get("position") or stats.get("_native_no_game") or stats.get("_native_played") is False:
            continue
        key = stats.get("_native_player_key") or id(stats)
        if key not in grouped:
            try:
                require_position_stats(stats["position"], stats, scoring)
            except ValueError:
                continue
            grouped[key] = {"aliases": [], "position": stats["position"],
                            "opponent": stats.get("opponent"),
                            "points": fantasy_points_from_stats(stats, scoring)}
        grouped[key]["aliases"].append(alias)
    if grouped:
        save_week(league_id, season, week, list(grouped.values()))


def sleeper_week(league, week, matchups, fetch, players):
    """Called by the existing explicit league sync, using Sleeper scoring weights."""
    season = int(league["season"])
    from src.draft_hub.hub_scoring import nfl_week_slate_complete
    if not nfl_week_slate_complete(season, week):
        return
    raw = fetch(f"https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}")
    if not isinstance(raw, dict):
        return
    authoritative = {str(pid): pts for m in matchups for pid, pts in (m.get("players_points") or {}).items()}
    weights = league.get("scoring_settings") or {}
    if not weights:
        return
    if callable(players):
        players = players()
    rows = []
    for pid, blob in raw.items():
        stats = blob.get("stats", blob)
        # A zero-valued played game counts; inactive and bye entries do not.
        if not isinstance(stats, dict) or not (number(stats.get("gp")) or 0) > 0:
            continue
        meta = players.get(str(pid)) or {}
        points = number(authoritative.get(str(pid)))
        if points is None:
            points = sum((number(stats.get(k)) or 0) * (number(v) or 0) for k, v in weights.items())
        rows.append({"aliases": [str(pid), f"sleeper-{pid}", str(meta.get("gsis_id") or "")],
                     "position": normalize_position(meta.get("position")), "opponent": blob.get("opponent"), "points": round(points, 2)})
    if rows:
        save_week(str(league["league_id"]), season, week, rows)


def summarize(weeks, roster, projections):
    logs = defaultdict(dict)
    positions = {}
    aliases = {}
    for week, rows in sorted(weeks.items()):
        for row in rows:
            ids = [str(x) for x in row.get("aliases", []) if x]
            points = number(row.get("points"))
            if not ids or points is None:
                continue
            canonical = next((aliases[x] for x in ids if x in aliases), ids[0])
            for alias in ids:
                aliases[alias] = canonical
            positions[canonical] = row.get("position")
            logs[canonical][int(week)] = {"week": int(week), "points": points, "opponent": row.get("opponent")}
    totals = {pid: round(sum(g["points"] for g in games.values()), 2) for pid, games in logs.items()}
    ranks = {}
    by_position = defaultdict(list)
    for pid, points in totals.items():
        by_position[positions.get(pid)].append((pid, points))
    for entries in by_position.values():
        prior = None
        for index, (pid, points) in enumerate(sorted(entries, key=lambda x: -x[1]), 1):
            if points != prior:
                rank = index
            ranks[pid] = rank
            prior = points
    result = {}
    for row in roster:
        pid = str(row["player_id"])
        canonical = next((aliases[x] for x in [pid, str(row.get("sleeper_player_id") or ""),
                        name_pos_key(row)] if x in aliases), None)
        games = sorted(logs.get(canonical, {}).values(), key=lambda g: -g["week"])
        games = [{**g, "projection": number(projections.get((pid, g["week"])))} for g in games]
        total = totals.get(canonical)
        position = positions.get(canonical)
        rank = ranks.get(canonical) if total is not None and position else None
        result[pid] = {"points": total, "ppg": round(total / len(games), 2) if games else None,
                       "games": len(games), "rank": rank, "position": position, "game_log": games}
    return result


def refresh_native_season(league):
    """Backfill completed weeks during explicit sync, not a roster page read."""
    from src.etl.nflverse_etl import load_weekly_player_stats
    from src.draft_hub.hub_scoring import load_week_stat_index, nfl_week_slate_complete, _league_rules
    season = int(league["season"])
    frame = load_weekly_player_stats([season])
    if frame is None or frame.empty:
        return
    for week in sorted(set(int(w) for w in frame["week"] if 1 <= int(w) <= 18)):
        if nfl_week_slate_complete(season, week):
            run = storage.get_week_scoring_run(league["id"], season, week)
            from src.draft_hub.schemas import ScoringRules
            scoring = ScoringRules.model_validate(run["scoring"]) if run else _league_rules(league).scoring
            native_week(league["id"], season, week, load_week_stat_index(season, week, frame=frame), scoring)


def team_scores(team):
    league = storage.get_league(team["league_id"])
    season = int(league["season"])
    source = str(league.get("sleeper_league_id") or league["id"])
    with storage.get_conn() as conn:
        rows = conn.execute("SELECT week,payload_json FROM player_season_week WHERE source=? AND season=?", (source, season)).fetchall()
        exists = conn.execute("SELECT 1 FROM sqlite_master WHERE name='team_room_projection'").fetchone()
        projections = {(str(r["player_id"]), int(r["week"])): r["projection"] for r in
                       conn.execute("SELECT player_id,week,projection FROM team_room_projection WHERE league_id=? AND season=?", (league["id"], season))} if exists else {}
        corrections = conn.execute("""SELECT s.week,s.player_id,s.points FROM league_player_week_score s
            JOIN league_week_scoring_run r USING(league_id,season,week)
            WHERE s.league_id=? AND s.season=? AND r.final=1""", (league["id"], season)).fetchall() if not league.get("sleeper_league_id") else []
    roster = storage.list_roster(storage.roster_workspace_for_league(league), team["id"])
    weeks = {int(r["week"]): json.loads(r["payload_json"]) for r in rows}
    for correction in corrections:
        for game in weeks.get(int(correction["week"]), []):
            if str(correction["player_id"]) in game.get("aliases", []):
                game["points"] = correction["points"]
    # A missing feed week cannot masquerade as a player's bye or inactive week.
    incomplete = bool(weeks) and set(weeks) != set(range(1, max(weeks) + 1))
    pending = warm_native(league) if (not weeks or incomplete) and not league.get("sleeper_league_id") else False
    return {"season": season, "players": summarize({} if incomplete else weeks, roster, projections),
            "available": bool(weeks) and not incomplete, "incomplete": incomplete, "pending": pending,
            "host": "sleeper" if league.get("sleeper_league_id") else "scoresense"}
