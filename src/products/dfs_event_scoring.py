"""Bounded NFL Classic scoring from one declared, normalized whole-game ledger.

This is a scoring adapter, not a fitted simulator or a provider-stat normalizer.
Unsupported lateral/multiple-possession plays fail atomically. A caller's
``ledger_complete`` declaration is required; it is not independent verification
that a feed contains every play. No forecasts, files, services or leagues change.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import re

from src.core.team_codes import normalize_team_for_match

SCORING_VERSION = "draftkings_nfl_classic_2026-10-12_v1"
SCHEMA_VERSION = "dfs_game_event_scoring_v1"
MAX_PLAYERS = 160
MAX_EVENTS = 1000
SCORING_SOURCE = {
    "provider": "DraftKings",
    "uri": "https://api.draftkings.com/rules-and-scoring/RulesAndScoring.json",
    "section": "1.rules[name=NFL Classic]; gameTypes 1,158",
    "retrieved_at": "2026-10-12T17:32:04.522766Z",
    "source_published_at": None,
    "response_sha256": "4ae6599b4159852e5106f451d87f3632c2cecccb7b8502bc4968a15319ce6f18",
    "section_sha256": "9c37b2570fc8282011a5af64e3549701b0c537242ee75712e79300fa5ee60c67",
    "rights": "Public rules consulted for scoring implementation; no raw source redistribution or feed/model license asserted.",
}
_TEAMS = set("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LA MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split())
_COMMON = {"event_id", "kind", "team", "period"}
_FUMBLE = {"fumbler_id", "fumble_lost", "fumble_return_td", "recovery_td_id"}
_FIELDS = {
    "pass": {"passer_id", "receiver_id", "complete", "intercepted", "yards", "td", "return_td"} | _FUMBLE,
    "rush": {"rusher_id", "rush_type", "yards", "td", "safety"} | _FUMBLE,
    "sack": {"passer_id", "yards", "safety"} | _FUMBLE,
    "spike": {"passer_id"},
    "no_play": set(),
    "field_goal": {"made"},
    "extra_point": {"made", "after_event_id"},
    "two_point": {"mode", "success", "passer_id", "receiver_id", "rusher_id", "returned", "after_event_id"},
    "return_td": {"returner_id", "return_type"},
    "blocked_kick": {"kick_type", "return_td", "after_event_id"},
    "safety": {"reason"},
}
_PLAYER_STATS = "passing_yards passing_tds interceptions passing_attempts completions targets receptions receiving_yards receiving_tds rushing_yards rushing_tds rushing_attempts designed_runs scrambles kneels spikes fumbles_lost return_tds offensive_recovery_tds two_point_pass two_point_run two_point_catch".split()
_TEAM_STATS = "plays designed_runs dropbacks sacks sack_yards_lost scrambles throws targeted untargeted completions passing_yards net_passing_yards receiving_yards passing_tds receiving_tds rushing_yards modeled_rushing_yards rushing_tds spikes kneels official_pass_attempts official_rush_attempts fumbles_lost interceptions_thrown defensive_sacks defensive_interceptions defensive_fumble_recoveries defensive_tds special_teams_tds blocked_kicks safeties conversion_returns points_allowed no_plays".split()


def _object(value, allowed, label, required=()):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        raise ValueError(f"{label} contains unknown fields or lacks required fields.")
    return value


def _id(value, label):
    if not isinstance(value, str) or not 1 <= len(value) <= 128 or value != value.strip() or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError(f"{label} needs an exact, nonempty ID without padding.")
    return value


def _team(value):
    value = _id(value, "Team")
    if value != value.upper():
        raise ValueError("Team must use a canonical NFL code or supported uppercase alias.")
    team = normalize_team_for_match(value)
    if team not in _TEAMS:
        raise ValueError("Unknown NFL team.")
    return team


def _integer(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{label} must be a whole number from {low} through {high}.")
    return value


def _boolean(event, field, *, required=False):
    if field not in event and not required:
        return False
    if type(event.get(field)) is not bool:
        raise ValueError(f"{field} must be an explicit boolean.")
    return event[field]


def _points_allowed_score(points):
    for ceiling, score in ((0, 10), (6, 7), (13, 4), (20, 1), (27, 0), (34, -1)):
        if points <= ceiling:
            return score
    return -4


def score_game_events(game, players, events, *, site="draftkings"):
    """Validate and score one complete declared game, without mutating inputs.

    Exact player IDs include explicit residual/unselected actors. Every team has
    one active DST. Ordinary plays, kicks and tries are separate events; each try
    references its preceding touchdown. Unsupported fields or inconsistent
    actors reject the entire ledger rather than returning partial scores.
    """
    if site != "draftkings":
        raise ValueError("This versioned scoring adapter supports DraftKings NFL Classic only.")
    _object(game, {"game_id", "home_team", "away_team", "ledger_complete"}, "Game", ("game_id", "home_team", "away_team", "ledger_complete"))
    game_id = _id(game["game_id"], "Game ID")
    home, away = _team(game["home_team"]), _team(game["away_team"])
    if home == away or game["ledger_complete"] is not True:
        raise ValueError("A game needs different teams and an explicit complete-ledger declaration.")
    opponent = {home: away, away: home}
    if not isinstance(players, list) or not 2 <= len(players) <= MAX_PLAYERS:
        raise ValueError(f"Game players must be an array of 2..{MAX_PLAYERS} explicit participants.")
    roster, dst = {}, {}
    for raw in players:
        _object(raw, {"player_id", "team", "opponent", "position", "status", "residual"}, "Player", ("player_id", "team", "opponent", "position", "status"))
        player = dict(raw)
        pid = _id(player["player_id"], "Player ID")
        team, opp = _team(player["team"]), _team(player["opponent"])
        if team not in opponent or opponent[team] != opp or pid in roster:
            raise ValueError("Participant identity is duplicated or outside this game.")
        if not isinstance(player["position"], str) or player["position"] not in {"QB", "RB", "WR", "TE", "DST", "RESIDUAL"} or not isinstance(player["status"], str) or player["status"] not in {"active", "inactive"}:
            raise ValueError("Unsupported participant position or availability status.")
        residual = _boolean(player, "residual")
        if (player["position"] == "RESIDUAL") != residual:
            raise ValueError("Residual actors need both RESIDUAL position and residual=true.")
        player.update(team=team, opponent=opp, residual=residual)
        roster[pid] = player
        if player["position"] == "DST":
            if player["status"] != "active" or team in dst:
                raise ValueError("Each team needs exactly one active DST participant.")
            dst[team] = pid
    if set(dst) != set(opponent):
        raise ValueError("Each team needs exactly one active DST participant.")
    if not isinstance(events, list) or len(events) > MAX_EVENTS:
        raise ValueError(f"A complete game ledger permits at most {MAX_EVENTS} events.")
    stats = {pid: dict.fromkeys(_PLAYER_STATS, 0) for pid in roster}
    teams = {team: dict.fromkeys(_TEAM_STATS, 0) for team in opponent}
    game_score = dict.fromkeys(opponent, 0)
    seen, touchdowns, tries = set(), {}, set()
    normalized = []
    last_period = 1

    def actor(pid, team):
        pid = _id(pid, "Event participant ID")
        player = roster.get(pid)
        if not player or player["team"] != team or player["status"] != "active" or player["position"] == "DST":
            raise ValueError("Event participant is missing, inactive, a DST, or on the wrong team.")
        return pid

    def points(team, amount, *, allowed):
        game_score[team] += amount
        if allowed:
            teams[opponent[team]]["points_allowed"] += amount

    def touchdown(event_id, team, *, allowed):
        points(team, 6, allowed=allowed)
        touchdowns[event_id] = team

    def try_event(event, team):
        previous = _id(event.get("after_event_id"), "Try touchdown ID")
        if touchdowns.get(previous) != team or previous in tries:
            raise ValueError("A try must reference one earlier, same-team touchdown exactly once.")
        # A delayed try beyond another ordinary play is not a normalized ledger.
        if not normalized or normalized[-1]["event_id"] != previous:
            raise ValueError("A try must immediately follow its touchdown event.")
        tries.add(previous)

    for raw in events:
        if not isinstance(raw, dict) or not isinstance(raw.get("kind"), str) or raw["kind"] not in _FIELDS:
            raise ValueError("Unsupported normalized event kind; no rare-play guess is applied.")
        kind = raw["kind"]
        _object(raw, _COMMON | _FIELDS[kind], "Event", _COMMON)
        event = dict(raw)
        eid = _id(event["event_id"], "Event ID")
        team = _team(event["team"])
        period = _integer(event["period"], "Period", 1, 10)
        if eid in seen or team not in opponent or period < last_period:
            raise ValueError("Event IDs must be unique, teams in-game, and periods chronological.")
        seen.add(eid)
        last_period = period
        event["team"] = team
        defense = opponent[team]
        ts, ds = teams[team], teams[defense]
        involved = set()
        score_td = False
        safety = _boolean(event, "safety") if kind in {"rush", "sack"} else False
        if kind == "pass":
            passer = actor(event.get("passer_id"), team)
            if "receiver_id" not in event:
                raise ValueError("A throw needs an explicit target ID or receiver_id=null for an untargeted throw.")
            receiver = actor(event["receiver_id"], team) if event.get("receiver_id") is not None else None
            if receiver == passer:
                raise ValueError("Self-completions require unsupported rare-play normalization.")
            complete = _boolean(event, "complete", required=True)
            intercepted = _boolean(event, "intercepted", required=True)
            score_td = _boolean(event, "td", required=True)
            yards = _integer(event.get("yards"), "Passing yards", -99, 99)
            returned = _boolean(event, "return_td")
            if (complete and (receiver is None or intercepted)) or (not complete and (yards != 0 or score_td)) or (score_td and yards < 0) or (returned and not intercepted):
                raise ValueError("Passing completion, yards, touchdown and turnover fields contradict one another.")
            ts["plays"] += 1
            ts["dropbacks"] += 1
            ts["throws"] += 1
            ts["official_pass_attempts"] += 1
            ts["targeted" if receiver else "untargeted"] += 1
            stats[passer]["passing_attempts"] += 1
            involved = {receiver} if complete else set()
            if receiver:
                stats[receiver]["targets"] += 1
            if complete:
                ts["completions"] += 1
                ts["passing_yards"] += yards
                ts["receiving_yards"] += yards
                stats[passer]["completions"] += 1
                stats[passer]["passing_yards"] += yards
                stats[receiver]["receptions"] += 1
                stats[receiver]["receiving_yards"] += yards
                if score_td:
                    ts["passing_tds"] += 1
                    ts["receiving_tds"] += 1
                    stats[passer]["passing_tds"] += 1
                    stats[receiver]["receiving_tds"] += 1
                    touchdown(eid, team, allowed=True)
            if intercepted:
                stats[passer]["interceptions"] += 1
                ts["interceptions_thrown"] += 1
                ds["defensive_interceptions"] += 1
                if returned:
                    ds["defensive_tds"] += 1
                    touchdown(eid, defense, allowed=False)
        elif kind == "rush":
            rusher = actor(event.get("rusher_id"), team)
            mode = event.get("rush_type")
            if not isinstance(mode, str) or mode not in {"designed", "scramble", "kneel"}:
                raise ValueError("Rush type must distinguish designed, scramble and kneel.")
            if mode in {"scramble", "kneel"} and roster[rusher]["position"] not in {"QB", "RESIDUAL"}:
                raise ValueError("Scrambles and kneels need an explicit quarterback or residual actor.")
            yards = _integer(event.get("yards"), "Rushing yards", -99, 99)
            score_td = _boolean(event, "td", required=True)
            if (mode == "kneel" and (yards > 0 or score_td or safety)) or (score_td and (yards < 0 or safety)) or (safety and yards >= 0):
                raise ValueError("Rush, kneel, touchdown and safety fields contradict one another.")
            stats[rusher]["rushing_yards"] += yards
            stats[rusher]["rushing_attempts"] += 1
            ts["rushing_yards"] += yards
            ts["official_rush_attempts"] += 1
            if mode == "kneel":
                ts["kneels"] += 1
                stats[rusher]["kneels"] += 1
            else:
                ts["plays"] += 1
                ts["modeled_rushing_yards"] += yards
                ts["dropbacks" if mode == "scramble" else "designed_runs"] += 1
                if mode == "scramble":
                    ts["scrambles"] += 1
                stats[rusher]["scrambles" if mode == "scramble" else "designed_runs"] += 1
            involved = {rusher}
            if score_td:
                stats[rusher]["rushing_tds"] += 1
                ts["rushing_tds"] += 1
                touchdown(eid, team, allowed=True)
        elif kind == "sack":
            passer = actor(event.get("passer_id"), team)
            yards = _integer(event.get("yards"), "Sack yards", -99, 0)
            ts["plays"] += 1
            ts["dropbacks"] += 1
            ts["sacks"] += 1
            ts["sack_yards_lost"] -= yards
            ds["defensive_sacks"] += 1
            involved = {passer}
            # NFL sack losses are not personal passing/rushing yard losses.
        elif kind == "spike":
            passer = actor(event.get("passer_id"), team)
            ts["spikes"] += 1
            ts["official_pass_attempts"] += 1
            stats[passer]["spikes"] += 1
            stats[passer]["passing_attempts"] += 1
        elif kind == "no_play":
            ts["no_plays"] += 1
        elif kind == "field_goal":
            if _boolean(event, "made", required=True):
                points(team, 3, allowed=True)
        elif kind == "extra_point":
            try_event(event, team)
            if _boolean(event, "made", required=True):
                points(team, 1, allowed=True)
        elif kind == "two_point":
            try_event(event, team)
            mode = event.get("mode")
            success = _boolean(event, "success", required=True)
            returned = _boolean(event, "returned")
            if mode == "pass":
                passer = actor(event.get("passer_id"), team)
                receiver = actor(event.get("receiver_id"), team)
                if passer == receiver or "rusher_id" in event:
                    raise ValueError("Invalid two-point passing participants.")
                if success:
                    stats[passer]["two_point_pass"] += 1
                    stats[receiver]["two_point_catch"] += 1
            elif mode == "run":
                rusher = actor(event.get("rusher_id"), team)
                if {"passer_id", "receiver_id"} & set(event):
                    raise ValueError("Invalid two-point rushing participants.")
                if success:
                    stats[rusher]["two_point_run"] += 1
            else:
                raise ValueError("Two-point mode must be pass or run.")
            if returned and success:
                raise ValueError("A successful two-point try cannot also be returned.")
            if success:
                points(team, 2, allowed=True)
            if returned:
                ds["conversion_returns"] += 1
                points(defense, 2, allowed=True)
        elif kind == "return_td":
            returner = actor(event.get("returner_id"), team)
            if not isinstance(event.get("return_type"), str) or event["return_type"] not in {"punt", "kickoff", "field_goal"}:
                raise ValueError("Only verified punt, kickoff and missed-field-goal player return TDs are supported.")
            stats[returner]["return_tds"] += 1
            ts["special_teams_tds"] += 1
            touchdown(eid, team, allowed=True)
        elif kind == "blocked_kick":
            kick_type = event.get("kick_type")
            if not isinstance(kick_type, str) or kick_type not in {"punt", "field_goal", "extra_point"}:
                raise ValueError("Unsupported blocked kick.")
            returned = _boolean(event, "return_td", required=True)
            if kick_type == "extra_point":
                try_event(event, team)
            elif "after_event_id" in event:
                raise ValueError("Only an extra-point block references a touchdown.")
            ds["blocked_kicks"] += 1
            if returned:
                if kick_type == "extra_point":
                    ds["conversion_returns"] += 1
                    points(defense, 2, allowed=True)
                else:
                    ds["special_teams_tds"] += 1
                    touchdown(eid, defense, allowed=True)
        elif kind == "safety":
            if event.get("reason") != "penalty":
                raise ValueError("Standalone safety supports an explicit penalty only; rush/sack safeties stay on that event.")
            safety = True
        if safety:
            ds["safeties"] += 1
            points(defense, 2, allowed=False)
        if kind in {"pass", "rush", "sack"}:
            lost = _boolean(event, "fumble_lost")
            returned = _boolean(event, "fumble_return_td")
            fumbler = event.get("fumbler_id")
            recovery_td = event.get("recovery_td_id")
            if (lost or returned or recovery_td is not None) and fumbler is None:
                raise ValueError("Fumble outcomes require an explicit fumbler.")
            if fumbler is not None:
                fumbler = actor(fumbler, team)
                if fumbler not in involved or score_td or safety or (kind == "pass" and event["intercepted"]):
                    raise ValueError("Fumble does not belong to this ordinary offensive event.")
            if returned and not lost:
                raise ValueError("A fumble return touchdown requires a lost fumble.")
            if lost:
                stats[fumbler]["fumbles_lost"] += 1
                ts["fumbles_lost"] += 1
                ds["defensive_fumble_recoveries"] += 1
                if returned:
                    ds["defensive_tds"] += 1
                    touchdown(eid, defense, allowed=False)
            if recovery_td is not None:
                recovery = actor(recovery_td, team)
                if lost or kind == "sack" or (kind == "rush" and event["rush_type"] == "kneel"):
                    raise ValueError("Offensive recovery touchdown contradicts this fumble event.")
                stats[recovery]["offensive_recovery_tds"] += 1
                touchdown(eid, team, allowed=True)
        normalized.append(event)

    identities = {}
    for team, ts in teams.items():
        ts["net_passing_yards"] = ts["passing_yards"] - ts["sack_yards_lost"]
        ps = [stats[pid] for pid, player in roster.items() if player["team"] == team and player["position"] != "DST"]
        checks = {
            "plays": ts["plays"] == ts["designed_runs"] + ts["dropbacks"],
            "dropbacks": ts["dropbacks"] == ts["sacks"] + ts["scrambles"] + ts["throws"],
            "throws": ts["throws"] == ts["targeted"] + ts["untargeted"],
            "official_attempts": ts["official_pass_attempts"] == ts["throws"] + ts["spikes"],
            "official_rushes": ts["official_rush_attempts"] == ts["designed_runs"] + ts["scrambles"] + ts["kneels"],
            "targets": ts["targeted"] == sum(p["targets"] for p in ps),
            "completions": ts["completions"] == sum(p["completions"] for p in ps) == sum(p["receptions"] for p in ps),
            "yards": ts["passing_yards"] == ts["receiving_yards"] == sum(p["passing_yards"] for p in ps) == sum(p["receiving_yards"] for p in ps),
            "passing_tds": ts["passing_tds"] == ts["receiving_tds"] == sum(p["passing_tds"] for p in ps) == sum(p["receiving_tds"] for p in ps),
            "rushing_yards": ts["rushing_yards"] == sum(p["rushing_yards"] for p in ps),
            "rushing_tds": ts["rushing_tds"] == sum(p["rushing_tds"] for p in ps),
            "opposing_sacks": ts["sacks"] == teams[opponent[team]]["defensive_sacks"],
            "opposing_interceptions": ts["interceptions_thrown"] == teams[opponent[team]]["defensive_interceptions"],
            "opposing_fumbles": ts["fumbles_lost"] == teams[opponent[team]]["defensive_fumble_recoveries"],
        }
        if not all(checks.values()):
            raise ValueError("Game ledger failed independent count conservation.")
        identities[team] = checks
    scores = {}
    for pid, player in roster.items():
        if player["position"] == "DST":
            ts = teams[player["team"]]
            stats[pid] = deepcopy(ts)
            score = (ts["defensive_sacks"] + 2 * (ts["defensive_interceptions"] + ts["defensive_fumble_recoveries"] + ts["blocked_kicks"] + ts["safeties"] + ts["conversion_returns"])
                     + 6 * (ts["defensive_tds"] + ts["special_teams_tds"]) + _points_allowed_score(ts["points_allowed"]))
        else:
            ps = stats[pid]
            score = (0.04 * ps["passing_yards"] + 4 * ps["passing_tds"] - ps["interceptions"]
                     + 0.1 * (ps["rushing_yards"] + ps["receiving_yards"]) + 6 * (ps["rushing_tds"] + ps["receiving_tds"] + ps["return_tds"] + ps["offensive_recovery_tds"])
                     + ps["receptions"] - ps["fumbles_lost"] + 2 * (ps["two_point_pass"] + ps["two_point_run"] + ps["two_point_catch"])
                     + 3 * sum(ps[stat] >= threshold for stat, threshold in (("passing_yards", 300), ("rushing_yards", 100), ("receiving_yards", 100))))
        scores[pid] = round(score, 6)
    content = {"game": {"game_id": game_id, "home_team": home, "away_team": away, "ledger_complete": True}, "players": list(roster.values()), "events": normalized, "scoring_version": SCORING_VERSION}
    ledger_id = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return {
        "schema_version": SCHEMA_VERSION, "scoring_version": SCORING_VERSION,
        "scoring_source": deepcopy(SCORING_SOURCE), "game_id": game_id, "event_ledger_id": ledger_id,
        "player_scores": scores, "player_stats": stats, "team_stats": teams, "game_score": game_score,
        "audit": {"complete": True, "ledger_complete_declared": True, "source_completeness_verified": False,
                  "event_count": len(events), "identities": identities,
                  "residual_player_ids": sorted(pid for pid, player in roster.items() if player["residual"]),
                  "inactive_player_ids": sorted(pid for pid, player in roster.items() if player["status"] == "inactive"),
                  "definition": "Modeled plays exclude kneels, spikes, tries and no-plays; include overtime. Official attempts retain spikes and official rushes retain kneels."},
        "capabilities": {"site_scoring_rules_verified": True, "shared_offense_dst_events": True,
                         "calibrated_forecast": False, "specialist_distribution_calibrated": False,
                         "provider_stat_normalizer": False, "rare_multiple_possession_plays": False,
                         "laterals": False, "contest_ev": False},
    }
