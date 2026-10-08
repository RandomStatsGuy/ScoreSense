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
    snapshots = [dict(row) for row in conn.execute(
        "SELECT * FROM league_week_lineup_snapshot WHERE league_id=? AND season=? AND week=? ORDER BY team_id", key)]
    scores = [dict(row) for row in conn.execute(
        "SELECT * FROM league_team_week_score WHERE league_id=? AND season=? ORDER BY week,team_id", (league_id, season))]
    matchups = [dict(row) for row in conn.execute(
        "SELECT * FROM league_week_matchup WHERE league_id=? AND season=? ORDER BY week,matchup_id", (league_id, season))]
    run = conn.execute("SELECT * FROM league_week_scoring_run WHERE league_id=? AND season=? AND week=?", key).fetchone()
    return {"league": dict(league), "teams": teams, "lineups": lineups, "snapshots": snapshots,
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
    from src.draft_hub.owner_display import attach_owner_names_to_teams
    teams = attach_owner_names_to_teams(league_id, [dict(team) for team in state["teams"]], season_year=season)
    current_rosters = storage.list_league_rosters_by_team(league_id)
    return {"league_id": league_id, "season": season, "week": week,
            "finalized": bool(state["run"] and state["run"].get("final")),
            "teams": [{"id": team["id"], "name": team["name"], "owner_name": team.get("owner_name")} for team in teams],
            "lineups": state["lineups"], "slots": hub_scoring._starter_capacity(rules),
            "current_roster_candidates": {
                team_id: [{"player_id": row["player_id"], "player_name": row.get("player_name") or "",
                           "position": normalize_position(row.get("position")),
                           "nfl_team": row.get("nfl_team") or row.get("team") or ""}
                          for row in rows if storage.roster_row_occupies(row)]
                for team_id, rows in current_rosters.items()},
            "slot_positions": {slot: [position for position in ("QB", "RB", "WR", "TE", "K", "DEF")
                                      if hub_scoring.slot_accepts_position(f"{slot}1", position, rules)]
                               for slot in hub_scoring._starter_capacity(rules)},
            "incomplete_team_ids": [team["id"] for team in state["teams"]
                                    if not any(row["team_id"] == team["id"] for row in state["snapshots"])],
            "revision": _digest(state), "standings": _standings(state, state["scores"])}


def _slot_label(slot):
    base = slot.rstrip("0123456789")
    return f"{base} {slot[len(base):]}" if slot != base else slot


def _validate_lineups(state, changes, acknowledge_empty, season, week, *, snapshot=None):
    rules = LeagueRules.model_validate(json.loads(state["league"]["rules_json"]))
    team_ids = {team["id"] for team in state["teams"]}
    changed_ids = [change["team_id"] for change in changes]
    if not changes or len(changed_ids) != len(set(changed_ids)) or not set(changed_ids) <= team_ids:
        raise CorrectionError("Choose distinct teams in this league")
    by_team = {team_id: [row for row in state["lineups"] if row["team_id"] == team_id] for team_id in team_ids}
    for change in changes:
        by_team[change["team_id"]] = change["players"]
    allowed_slots = set(hub_scoring.starter_slot_ids(rules))
    team_names = {team["id"]: team.get("name") or "A team" for team in state["teams"]}
    ownership = set()
    entries = []
    for team_id, players in by_team.items():
        slots = set()
        positions = Counter()
        if rules.roster_size_max is not None and len(players) > rules.roster_size_max:
            raise CorrectionError("Historical roster exceeds the roster limit")
        for player in players:
            trusted = hub_scoring.trusted_lineup_row(player, season, week, snapshot=snapshot)
            player_id = str(player.get("player_id") or "").strip()
            position = normalize_position((trusted or player).get("position"))
            slot = str(player.get("slot") or "BN").strip().upper()
            if not player_id or (team_id, player_id) in ownership:
                raise CorrectionError("A player can belong to only one team in the selected week")
            ownership.add((team_id, player_id))
            positions[position] += 1
            if slot != "BN":
                if trusted is None:
                    raise CorrectionError("Starter identity is unavailable. Refresh player information before correcting this week.")
                try:
                    slot = hub_scoring.canonical_starter_slot(slot, rules)
                except hub_scoring.LineupError as exc:
                    raise CorrectionError(str(exc)) from exc
                if position not in {"QB", "RB", "WR", "TE", "K", "DEF"}:
                    raise CorrectionError("Native scoring does not support this starter position")
                name = str((trusted or player).get("player_name") or player_id)
                if slot not in allowed_slots:
                    raise CorrectionError(f"{_slot_label(slot)} is not a starter slot in this league")
                if slot in slots:
                    raise CorrectionError(f"{team_names[team_id]} has two starters at {_slot_label(slot)}. Move one to the bench.")
                if not hub_scoring.slot_accepts_position(slot, position, rules):
                    raise CorrectionError(f"{name} ({position}) cannot start at {_slot_label(slot)}")
                slots.add(slot)
            metadata = trusted or player
            entries.append({"team_id": team_id, "player_id": player_id,
                            "player_name": str(metadata.get("player_name") or player_id),
                            "nfl_team": str(metadata.get("nfl_team") or metadata.get("team") or ""),
                            "position": position, "slot": slot,
                            "_canonical_player_key": metadata.get("_canonical_player_key") or f"unknown:{player_id}",
                            "_identity_unavailable": trusted is None,
                            "lineup_role": "bench" if slot == "BN" else "starter"})
        for position, limits in roster_limits(rules).items():
            if positions[position.upper()] > limits["max"]:
                raise CorrectionError(f"Historical roster exceeds the {position.upper()} limit")
        if slots != allowed_slots and not acknowledge_empty:
            raise CorrectionError("Acknowledge empty starter slots before previewing this week")
    by_player = {}
    for entry in entries:
        by_player.setdefault(entry["_canonical_player_key"], []).append(entry)
    recorded = {(row["team_id"], row["player_id"]): row for row in state["lineups"]}
    for rows in by_player.values():
        if len(rows) == 1:
            continue
        starters = [row for row in rows if row["lineup_role"] == "starter"]
        # A post-kickoff trade retains the scoring owner's starter and adds a
        # locked bench copy to the receiving roster. Permit that existing
        # snapshot, without allowing a correction to invent duplicate owners.
        if len(starters) != 1 or any(
                not recorded.get((row["team_id"], row["player_id"]), {}).get("locked")
                or recorded[(row["team_id"], row["player_id"])].get("lineup_role") != row["lineup_role"]
                for row in rows):
            raise CorrectionError("A player can belong to only one team in the selected week")
    return entries


def preview_correction(league_id, season, week, actor, changes, reason, revision, acknowledge_empty=False, mode="results", *, stat_index=None):
    if mode not in {"lineup", "results"}:
        raise CorrectionError("Choose a lineup repair or corrected results")
    reason = reason.strip()
    if len(reason) < 3:
        raise CorrectionError("Explain why the historical record needs correction")
    with storage.get_conn() as conn:
        state = _state(conn, league_id, season, week)
        _authorize(state, actor)
    if revision != _digest(state):
        raise CorrectionError("League records changed. Reload before previewing")
    snapshot = None
    if stat_index is None:
        from src.draft_hub.native_stats import get_week_snapshot, cached_week_snapshot, NativeStatsUnavailable
        try:
            snapshot = cached_week_snapshot(season, week) if mode == "lineup" else get_week_snapshot(season, week)
        except NativeStatsUnavailable:
            pass
    if snapshot is not None and mode == "results" and stat_index is None:
        from src.draft_hub.native_participation import enrich_inactive_players
        changed_teams = {change["team_id"] for change in changes}
        candidates = [row for row in state["lineups"] if row["team_id"] not in changed_teams]
        candidates.extend(player for change in changes for player in change["players"])
        snapshot = enrich_inactive_players(snapshot, candidates, season, week)
    entries = _validate_lineups(state, changes, acknowledge_empty, season, week, snapshot=snapshot)
    if mode == "lineup":
        if state["run"] and state["run"].get("final"):
            raise CorrectionError("This week is finalized. Preview corrected results instead")
        recorded = {"lineups": state["lineups"],
                    "scores": [row for row in state["scores"] if row["week"] == week],
                    "standings": _standings(state, state["scores"])}
        result = {"id": str(uuid.uuid4()), "league_id": league_id, "season": season, "week": week,
                  "mode": mode, "revision": revision, "reason": reason, "blockers": [], "can_publish": True,
                  "before": recorded, "after": {**recorded, "lineups": entries}}
        with storage.get_conn() as conn:
            conn.execute("INSERT INTO league_week_correction (id,league_id,season,week,actor_sub,reason,revision,preview_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                         (result["id"], league_id, season, week, actor, reason, revision, json.dumps(result), storage._utcnow()))
        return result
    rules = LeagueRules.model_validate(json.loads(state["league"]["rules_json"]))
    scoring = ScoringRules.model_validate(json.loads(state["run"]["scoring_json"])) if state["run"] else rules.scoring
    blockers = []
    stats, complete, warnings = _resolved_statistics(entries, season, week, stat_index, snapshot=snapshot)
    if not complete:
        blockers.append("The selected week's games are not complete")
    matches = [row for row in state["matchups"] if row["week"] == week]
    covered = {row[field] for row in matches for field in ("home_team_id", "away_team_id") if row[field]}
    if covered != {team["id"] for team in state["teams"]}:
        blockers.append("The selected week's matchup schedule is incomplete")
    totals = {team["id"]: 0.0 for team in state["teams"]}
    player_scores = []
    for entry in _scoring_entries(entries):
        if entry.get("_identity_unavailable"):
            continue
        raw = stats.get(entry["player_id"])
        points = 0.0
        if entry["lineup_role"] == "starter":
            try:
                hub_scoring.require_position_stats(entry["position"], raw or {}, scoring)
            except hub_scoring.LineupError as exc:
                blockers.append(str(exc))
        known_no_game = bool(raw and raw.get("_native_no_game") == 1)
        available = bool(raw and (known_no_game or any(key in raw for key in hub_scoring.NATIVE_STAT_FIELDS)))
        if entry["lineup_role"] == "starter" and not available:
            blockers.append(f"Actual scoring statistics unavailable for {entry['player_name']}")
        if not available:
            # Unavailable optional bench statistics must stay unknown. They do
            # not decide the winner and cannot be persisted as an invented zero.
            continue
        if not known_no_game:
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
              "mode": mode, "revision": revision, "reason": reason, "blockers": blockers, "can_publish": not blockers, "warnings": warnings,
              "before": {"lineups": state["lineups"], "scores": [row for row in state["scores"] if row["week"] == week],
                         "standings": _standings(state, state["scores"])},
              "after": {"lineups": entries, "scores": team_scores, "standings": _standings(state, combined)},
              "player_scores": player_scores, "scoring": scoring.model_dump(), "stats_digest": _digest(stats)}
    with storage.get_conn() as conn:
        conn.execute("INSERT INTO league_week_correction (id,league_id,season,week,actor_sub,reason,revision,preview_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     (result["id"], league_id, season, week, actor, reason, revision, json.dumps(result), storage._utcnow()))
    return result


def publish_correction(league_id, season, week, actor, preview_id, revision, reason, idempotency_key, *, stat_index=None):
    if not idempotency_key.strip():
        raise CorrectionError("A publication key is required")
    with storage.get_conn() as conn:
        initial = _state(conn, league_id, season, week)
        _authorize(initial, actor)
        saved = conn.execute("SELECT * FROM league_week_correction WHERE id=? AND league_id=? AND season=? AND week=?",
                             (preview_id, league_id, season, week)).fetchone()
        if saved is None or saved["actor_sub"] != actor:
            raise CorrectionError("Preview not found for this commissioner and week")
    preview = json.loads(saved["preview_json"])
    lineup_only = preview.get("mode") == "lineup"
    locks = {}
    if not saved["published_at"] and lineup_only:
        prior_locks = {(row["team_id"], row["player_id"]): row["locked"] for row in initial["lineups"]}
        _verify_reviewed_identities(preview["after"]["lineups"], season, week)
        locks = {(row["team_id"], row["player_id"]): int(hub_scoring._lineup_row_locked(
            {**row, "locked": prior_locks.get((row["team_id"], row["player_id"]))}, season, week))
            for row in preview["after"]["lineups"]}
    if not saved["published_at"] and not lineup_only:
        stats, complete, _ = _resolved_statistics(preview["after"]["lineups"], season, week, stat_index)
        if not complete:
            raise CorrectionError("The selected week's games are not complete")
        if _digest(stats) != preview["stats_digest"]:
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
        conn.executemany("""INSERT INTO league_week_lineup_snapshot
            (league_id,team_id,season,week,created_at,updated_at) VALUES (?,?,?,?,?,?)
            ON CONFLICT(league_id,team_id,season,week) DO UPDATE SET updated_at=excluded.updated_at""",
            [(league_id, team["id"], season, week, stamp, stamp) for team in state["teams"]])
        conn.execute("DELETE FROM league_week_lineup WHERE league_id=? AND season=? AND week=?", key)
        conn.executemany("""INSERT INTO league_week_lineup
            (league_id,season,week,team_id,player_id,slot,lineup_role,player_name,nfl_team,position,locked,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(*key, row["team_id"], row["player_id"], row["slot"], row["lineup_role"], row["player_name"],
              row["nfl_team"], row["position"], locks.get((row["team_id"], row["player_id"]), 1), stamp)
             for row in preview["after"]["lineups"]])
        if lineup_only:
            conn.execute("UPDATE league_week_correction SET published_at=?,idempotency_key=? WHERE id=?", (stamp, idempotency_key, preview_id))
            conn.execute("INSERT INTO draft_event (league_id,event_type,payload_json,created_at) VALUES (?,?,?,?)",
                         (league_id, "week_lineup_correction", json.dumps({"correction_id": preview_id,
                          "week": week, "season": season, "reason": reason, "by": actor}), stamp))
            return {"id": preview_id, "published_at": stamp, "already_published": False, "mode": "lineup"}
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
             "mode": json.loads(row["preview_json"]).get("mode", "results"),
             "published_at": row["published_at"], "before": json.loads(row["preview_json"])["before"],
             "after": json.loads(row["preview_json"])["after"]} for row in rows]


def _scoring_entries(entries):
    key = lambda row: row.get("_canonical_player_key") or row["player_id"]
    starter_owners = {key(row): (row["team_id"], row["player_id"]) for row in entries if row["lineup_role"] == "starter"}
    unique = {}
    for row in sorted(entries, key=lambda row: row["lineup_role"] != "starter"):
        owner = starter_owners.get(key(row))
        if owner is None or (row["lineup_role"] == "starter" and owner == (row["team_id"], row["player_id"])):
            unique.setdefault(key(row), row)
    return list(unique.values())



def _resolved_statistics(entries, season, week, stat_index=None, *, snapshot=None):
    """Read one verified actual-stat snapshot and resolve historical identities."""
    if stat_index is not None:
        _verify_reviewed_identities(entries, season, week, snapshot=snapshot)
        return stat_index, hub_scoring.nfl_week_slate_complete(season, week), []
    from src.draft_hub.native_stats import get_week_snapshot, resolve_lineup_stats, NativeStatsUnavailable
    try:
        snapshot = snapshot or get_week_snapshot(season, week)
    except NativeStatsUnavailable as exc:
        return {}, False, [str(exc)]
    from src.draft_hub.native_participation import enrich_inactive_players
    snapshot = enrich_inactive_players(snapshot, entries, season, week)
    _verify_reviewed_identities(entries, season, week, snapshot=snapshot)
    stats = {}
    warnings = []
    for entry in _scoring_entries(entries):
        try:
            if entry.get("_identity_unavailable"):
                raise NativeStatsUnavailable("Bench player identity is unavailable.")
            stats[entry["player_id"]] = resolve_lineup_stats(entry, snapshot)
        except NativeStatsUnavailable as exc:
            stats[entry["player_id"]] = {"_native_stats_unavailable": 1}
            warnings.append(str(exc))
    return stats, bool(snapshot.get("complete")), warnings



def _verify_reviewed_identities(entries, season, week, *, snapshot=None):
    for entry in entries:
        if entry.get("_identity_unavailable"):
            continue
        trusted = hub_scoring.trusted_lineup_row(entry, season, week, snapshot=snapshot)
        if trusted is None or any(trusted.get(key) != entry.get(key)
                                 for key in ("position", "nfl_team", "_canonical_player_key")):
            raise CorrectionError("Player identity changed. Preview again before publishing.")
