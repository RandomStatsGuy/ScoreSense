from __future__ import annotations

import hashlib
import json
import math
import uuid
from collections import Counter

from src.draft_hub import storage, hub_scoring
from src.draft_hub.rules_engine import normalize_position, roster_limits
from src.draft_hub.schemas import LeagueRules, ScoringRules


class CorrectionError(ValueError):
    pass


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def _state(conn, league_id, season, week):
    league = conn.execute("SELECT * FROM league WHERE id=?", (league_id,)).fetchone()
    if league is None:
        raise CorrectionError("League not found")
    if league["sleeper_league_id"]:
        raise CorrectionError("Historical corrections require native scoring")
    if int(league["season"]) != season:
        raise CorrectionError("Select the league's current season")
    rules = LeagueRules.model_validate(json.loads(league["rules_json"]))
    if not 1 <= week <= rules.regular_season_games:
        raise CorrectionError("Week is outside the league's regular season")
    teams = [dict(row) for row in conn.execute("SELECT * FROM team WHERE league_id=? ORDER BY id", (league_id,))]
    key = (league_id, season, week)
    lineups = [dict(row) for row in conn.execute(
        "SELECT * FROM league_week_lineup WHERE league_id=? AND season=? AND week=? ORDER BY team_id,player_id", key)]
    scores = [dict(row) for row in conn.execute(
        "SELECT * FROM league_team_week_score WHERE league_id=? AND season=? ORDER BY week,team_id", (league_id, season))]
    matchups = [dict(row) for row in conn.execute(
        "SELECT * FROM league_week_matchup WHERE league_id=? AND season=? ORDER BY week,matchup_id", (league_id, season))]
    run = conn.execute("SELECT * FROM league_week_scoring_run WHERE league_id=? AND season=? AND week=?", key).fetchone()
    return {"league": dict(league), "teams": teams, "lineups": lineups,
            "scores": scores, "matchups": matchups, "run": dict(run) if run else None}


def _authorize(state, actor):
    if state["league"]["commissioner_sub"] == actor:
        return
    if any(team["user_sub"] == actor and team["is_commissioner"] for team in state["teams"]):
        return
    raise PermissionError("Commissioner managed")


def _standings(state, scores):
    records = {team["id"]: {"team_id": team["id"], "name": team["name"], "wins": 0,
                           "losses": 0, "ties": 0, "points_for": 0.0} for team in state["teams"]}
    lookup = {(row["week"], row["team_id"]): row["points"] for row in scores}
    for row in scores:
        if row["team_id"] in records:
            records[row["team_id"]]["points_for"] += row["points"]
    for match in state["matchups"]:
        home, away = match["home_team_id"], match["away_team_id"]
        home_points = lookup.get((match["week"], home))
        away_points = lookup.get((match["week"], away))
        if home not in records or away not in records or home_points is None or away_points is None:
            continue
        records[home]["wins" if home_points > away_points else "losses" if home_points < away_points else "ties"] += 1
        records[away]["wins" if away_points > home_points else "losses" if away_points < home_points else "ties"] += 1
    for record in records.values():
        record["points_for"] = round(record["points_for"], 2)
    return sorted(records.values(), key=lambda row: (-row["wins"], -row["points_for"], row["name"]))


def correction_context(league_id, season, week, actor):
    with storage.get_conn() as conn:
        state = _state(conn, league_id, season, week)
        _authorize(state, actor)
    rules = LeagueRules.model_validate(json.loads(state["league"]["rules_json"]))
    return {"league_id": league_id, "season": season, "week": week,
            "teams": [{"id": team["id"], "name": team["name"]} for team in state["teams"]],
            "lineups": state["lineups"], "slots": hub_scoring._starter_capacity(rules),
            "incomplete_team_ids": [team["id"] for team in state["teams"]
                                    if not any(row["team_id"] == team["id"] for row in state["lineups"])],
            "revision": _digest(state), "standings": _standings(state, state["scores"])}


def _validate_lineups(state, changes, acknowledge_empty):
    rules = LeagueRules.model_validate(json.loads(state["league"]["rules_json"]))
    team_ids = {team["id"] for team in state["teams"]}
    changed_ids = [change["team_id"] for change in changes]
    if not changes or len(changed_ids) != len(set(changed_ids)) or not set(changed_ids) <= team_ids:
        raise CorrectionError("Choose distinct teams in this league")
    by_team = {team_id: [row for row in state["lineups"] if row["team_id"] == team_id] for team_id in team_ids}
    for change in changes:
        by_team[change["team_id"]] = change["players"]
    capacity = hub_scoring._starter_capacity(rules)
    allowed_slots = {f"{position}{index}" for position, count in capacity.items() for index in range(1, count + 1)}
    ownership = set()
    entries = []
    for team_id, players in by_team.items():
        slots = set()
        positions = Counter()
        if rules.roster_size_max is not None and len(players) > rules.roster_size_max:
            raise CorrectionError("Historical roster exceeds the roster limit")
        for player in players:
            player_id = str(player.get("player_id") or "").strip()
            position = normalize_position(player.get("position"))
            slot = str(player.get("slot") or "BN").upper()
            if not player_id or player_id in ownership:
                raise CorrectionError("A player can belong to only one team in the selected week")
            ownership.add(player_id)
            positions[position] += 1
            if slot != "BN":
                if position not in {"QB", "RB", "WR", "TE", "K", "DEF"}:
                    raise CorrectionError("Native scoring does not support this starter position")
                if slot not in allowed_slots or slot in slots or not hub_scoring.slot_accepts_position(slot, position, rules):
                    raise CorrectionError("Starter slots must be distinct and position-eligible")
                slots.add(slot)
            entries.append({"team_id": team_id, "player_id": player_id,
                            "player_name": str(player.get("player_name") or player_id),
                            "nfl_team": str(player.get("nfl_team") or player.get("team") or ""),
                            "position": position, "slot": slot,
                            "lineup_role": "bench" if slot == "BN" else "starter"})
        for position, limits in roster_limits(rules).items():
            if positions[position.upper()] > limits["max"]:
                raise CorrectionError(f"Historical roster exceeds the {position.upper()} limit")
        if slots != allowed_slots and not acknowledge_empty:
            raise CorrectionError("Acknowledge empty starter slots before previewing this week")
    return entries


def preview_correction(league_id, season, week, actor, changes, reason, revision, acknowledge_empty=False):
    reason = reason.strip()
    if len(reason) < 3:
        raise CorrectionError("Explain why the historical record needs correction")
    with storage.get_conn() as conn:
        state = _state(conn, league_id, season, week)
        _authorize(state, actor)
    if revision != _digest(state):
        raise CorrectionError("League records changed. Reload before previewing")
    entries = _validate_lineups(state, changes, acknowledge_empty)
    rules = LeagueRules.model_validate(json.loads(state["league"]["rules_json"]))
    scoring = ScoringRules.model_validate(json.loads(state["run"]["scoring_json"])) if state["run"] else rules.scoring
    blockers = []
    if not hub_scoring.nfl_week_slate_complete(season, week):
        blockers.append("The selected week's games are not complete")
    matches = [row for row in state["matchups"] if row["week"] == week]
    covered = {row[field] for row in matches for field in ("home_team_id", "away_team_id") if row[field]}
    if covered != {team["id"] for team in state["teams"]}:
        blockers.append("The selected week's matchup schedule is incomplete")
    try:
        stats = hub_scoring.load_week_stat_index(season, week)
    except Exception:
        stats = {}
    totals = {team["id"]: 0.0 for team in state["teams"]}
    player_scores = []
    for entry in entries:
        raw = hub_scoring.stats_for_lineup_row(stats, entry)
        points = 0.0
        if entry["lineup_role"] == "starter":
            try:
                hub_scoring.require_position_stats(entry["position"], raw or {}, scoring)
            except hub_scoring.LineupError as exc:
                blockers.append(str(exc))
        if entry["lineup_role"] == "starter" and (not raw or not any(key in raw for key in hub_scoring.NATIVE_STAT_FIELDS)):
            blockers.append(f"Actual scoring statistics unavailable for {entry['player_name']}")
        if raw and any(key in raw for key in hub_scoring.NATIVE_STAT_FIELDS):
            points = hub_scoring.fantasy_points_from_stats(raw, scoring)
            if not math.isfinite(points):
                raise CorrectionError("Player statistics contain an invalid score")
        if entry["lineup_role"] == "starter":
            totals[entry["team_id"]] += points
        player_scores.append({**entry, "points": round(points, 2), "stats": raw or {}})
    team_scores = [{"team_id": team_id, "points": round(points, 2), "week": week,
                    "matchup_id": next((match["matchup_id"] for match in matches
                                        if team_id in (match["home_team_id"], match["away_team_id"])), None)}
                   for team_id, points in totals.items()]
    combined = [row for row in state["scores"] if row["week"] != week] + team_scores
    result = {"id": str(uuid.uuid4()), "league_id": league_id, "season": season, "week": week,
              "revision": revision, "reason": reason, "blockers": blockers, "can_publish": not blockers,
              "before": {"lineups": state["lineups"], "scores": [row for row in state["scores"] if row["week"] == week],
                         "standings": _standings(state, state["scores"])},
              "after": {"lineups": entries, "scores": team_scores, "standings": _standings(state, combined)},
              "player_scores": player_scores, "scoring": scoring.model_dump(), "stats_digest": _digest(stats)}
    with storage.get_conn() as conn:
        conn.execute("INSERT INTO league_week_correction (id,league_id,season,week,actor_sub,reason,revision,preview_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     (result["id"], league_id, season, week, actor, reason, revision, json.dumps(result), storage._utcnow()))
    return result


def publish_correction(league_id, season, week, actor, preview_id, revision, reason, idempotency_key):
    if not idempotency_key.strip():
        raise CorrectionError("A publication key is required")
    with storage.get_conn() as conn:
        initial = _state(conn, league_id, season, week)
        _authorize(initial, actor)
        saved = conn.execute("SELECT * FROM league_week_correction WHERE id=? AND league_id=? AND season=? AND week=?",
                             (preview_id, league_id, season, week)).fetchone()
        if saved is None or saved["actor_sub"] != actor:
            raise CorrectionError("Preview not found for this commissioner and week")
    if not saved["published_at"]:
        if not hub_scoring.nfl_week_slate_complete(season, week):
            raise CorrectionError("The selected week's games are not complete")
        try:
            stats = hub_scoring.load_week_stat_index(season, week)
        except Exception as exc:
            raise CorrectionError("Actual scoring statistics unavailable") from exc
        if _digest(stats) != json.loads(saved["preview_json"])["stats_digest"]:
            raise CorrectionError("Player statistics changed. Preview again")
    with storage.get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        state = _state(conn, league_id, season, week)
        _authorize(state, actor)
        saved = conn.execute("SELECT * FROM league_week_correction WHERE id=? AND league_id=? AND season=? AND week=?",
                             (preview_id, league_id, season, week)).fetchone()
        if saved is None or saved["actor_sub"] != actor:
            raise CorrectionError("Preview not found for this commissioner and week")
        preview = json.loads(saved["preview_json"])
        if revision != saved["revision"] or reason.strip() != saved["reason"]:
            raise CorrectionError("Publish the reviewed reason and revision")
        if saved["published_at"]:
            if saved["idempotency_key"] != idempotency_key:
                raise CorrectionError("This preview has already been published")
            return {"id": preview_id, "published_at": saved["published_at"], "already_published": True}
        if conn.execute("SELECT 1 FROM league_week_correction WHERE league_id=? AND idempotency_key=?", (league_id, idempotency_key)).fetchone():
            raise CorrectionError("Publication key already used")
        if not preview["can_publish"] or _digest(state) != revision:
            raise CorrectionError("Preview is blocked or league records changed. Preview again")
        stamp = storage._utcnow()
        key = (league_id, season, week)
        conn.execute("DELETE FROM league_week_lineup WHERE league_id=? AND season=? AND week=?", key)
        conn.executemany("""INSERT INTO league_week_lineup
            (league_id,season,week,team_id,player_id,slot,lineup_role,player_name,nfl_team,position,locked,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,1,?)""",
            [(*key, row["team_id"], row["player_id"], row["slot"], row["lineup_role"], row["player_name"],
              row["nfl_team"], row["position"], stamp) for row in preview["after"]["lineups"]])
        conn.execute("DELETE FROM league_player_week_score WHERE league_id=? AND season=? AND week=?", key)
        conn.execute("DELETE FROM league_team_week_score WHERE league_id=? AND season=? AND week=?", key)
        conn.executemany("""INSERT INTO league_player_week_score
            (league_id,season,week,player_id,team_id,slot,lineup_role,points,stats_json,scored_at) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            [(*key, row["player_id"], row["team_id"], row["slot"], row["lineup_role"], row["points"], json.dumps(row["stats"]), stamp)
             for row in preview["player_scores"]])
        conn.executemany("""INSERT INTO league_team_week_score
            (league_id,season,week,team_id,matchup_id,points,scored_at) VALUES (?,?,?,?,?,?,?)""",
            [(*key, row["team_id"], row["matchup_id"], row["points"], stamp) for row in preview["after"]["scores"]])
        conn.execute(
            """INSERT OR REPLACE INTO league_week_scoring_run
               (league_id, season, week, scoring_json, scored_at, final)
               VALUES (?,?,?,?,?,1)""",
            (*key, json.dumps(preview["scoring"]), stamp),
        )
        conn.execute("UPDATE league_week_correction SET published_at=?,idempotency_key=? WHERE id=?", (stamp, idempotency_key, preview_id))
        conn.execute("INSERT INTO draft_event (league_id,event_type,payload_json,created_at) VALUES (?,?,?,?)",
                     (league_id, "week_correction", json.dumps({"correction_id": preview_id, "week": week, "season": season,
                                                               "reason": reason, "by": actor}), stamp))
    return {"id": preview_id, "published_at": stamp, "already_published": False}


def correction_history(league_id, season, week):
    with storage.get_conn() as conn:
        rows = conn.execute("SELECT * FROM league_week_correction WHERE league_id=? AND season=? AND week=? AND published_at IS NOT NULL ORDER BY published_at DESC",
                            (league_id, season, week)).fetchall()
    return [{"id": row["id"], "actor_sub": row["actor_sub"], "reason": row["reason"],
             "published_at": row["published_at"], "before": json.loads(row["preview_json"])["before"],
             "after": json.loads(row["preview_json"])["after"]} for row in rows]
