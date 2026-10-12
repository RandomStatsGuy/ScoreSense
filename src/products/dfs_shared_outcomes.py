"""Bounded replay of explicitly supplied, coherent whole-game event profiles.

This is an empirical research tool, not a fitted simulator. Profile weights are
declarations, source hashes are not authenticity checks, and no production
forecast or account state is read or changed. Missing coverage fails atomically.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
import random
from time import monotonic

from src.core.team_codes import normalize_team_for_match
from src.products.dfs_opportunity import normalize_evidence_context, validate_source_receipt

SCHEMA_VERSION = "dfs_shared_outcomes_bank_v1"
RESULT_VERSION = "dfs_shared_outcomes_review_v1"
SEMANTICS = "empirical_declared_scenario_scores_not_calibrated_forecasts_or_payouts"
MAX_BYTES = 8 * 1024 * 1024
MAX_GAMES = 16
MAX_PROFILES = 64
MAX_EVENTS = 512
MAX_PLAYERS = 750
MAX_LINEUPS = 150
MAX_DRAWS = 1024
PURPOSES = ("generation", "selection", "evaluation")
CAPABILITIES = {
    "coherent_event_scoring": True, "shared_game_profiles": True,
    "site_scoring_rules_verified": True, "source_completeness_verified": False,
    "calibrated_marginals": False, "calibrated_joint_tail": False,
    "forward_forecast": False, "contest_field": False, "expected_payout": False,
    "prelock_source_verified": False, "untouched_finalist_evaluation_verified": False,
}
WARNINGS = [
    "Declared empirical scenarios are research inputs; their weights are not calibrated future probabilities.",
    "Games are sampled independently. Within each game, all players and both defenses share one complete event profile.",
    "Source timestamps, rights and hashes are declarations, not authentication or proof of historical availability.",
    "More draws reduce replay noise; they do not establish marginal, joint-tail, injury or tournament calibration.",
    "Purpose-specific random streams do not prove that finalists were chosen without seeing evaluation results; freeze inputs before assessment.",
    "No opponent field, ownership, payout or contest-return estimate is available.",
]


def _json(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Scenario input must be finite JSON data.") from exc


def _hash(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _id(value, label):
    if (not isinstance(value, str) or not value or value != value.strip() or len(value) > 120 or
            any(ord(char) < 32 or ord(char) == 127 for char in value)):
        raise ValueError(f"{label} requires an exact nonempty identity without padding.")
    return value


def _time(value, label):
    if not isinstance(value, str) or value != value.strip():
        raise ValueError(f"{label} requires an ISO timestamp with a timezone.")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label} requires an ISO timestamp with a timezone.") from exc
    if result.tzinfo is None:
        raise ValueError(f"{label} requires an ISO timestamp with a timezone.")
    return result.astimezone(timezone.utc)


def _team(value):
    return _id(normalize_team_for_match(_id(value, "Team")), "Team")


def _rows(value, label, maximum, *, minimum=1):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum or any(not isinstance(row, dict) for row in value):
        raise ValueError(f"{label} requires {minimum}–{maximum} explicit rows.")
    return value


def _fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(f"{label} contains unsupported fields; controls are never silently dropped.")
    return value


def _context(context):
    _fields(context, {"site", "sport", "format", "slate_id", "season", "week"}, "Slate context")
    if type(context.get("season")) is not int or type(context.get("week")) is not int:
        raise ValueError("Slate season/week need explicit whole integers.")
    result = normalize_evidence_context(context)
    _id(result["slate_id"], "Slate ID")
    if result["site"] != "draftkings":
        raise ValueError("Shared event review supports DraftKings NFL Classic only.")
    return result


def _pool(pool):
    result, seen = [], set()
    for row in _rows(pool, "Player pool", MAX_PLAYERS):
        _fields(row, {"player_id", "game_id", "team", "opponent", "position", "salary"}, "Frozen pool participant")
        pid = _id(row.get("player_id"), "Player ID")
        if pid in seen:
            raise ValueError("Player pool contains duplicate canonical IDs.")
        seen.add(pid)
        if not isinstance(row.get("position"), str) or row["position"] not in {"QB", "RB", "WR", "TE", "DST"}:
            raise ValueError("Shared review needs an explicit supported position.")
        salary = row.get("salary")
        if type(salary) is not int or not 0 < salary <= 50000:
            raise ValueError("Shared review needs positive whole DraftKings salaries.")
        result.append({"player_id": pid, "game_id": _id(row.get("game_id"), "Player game ID"),
                       "team": _team(row.get("team")), "opponent": _team(row.get("opponent")),
                       "position": row["position"], "salary": salary})
    return sorted(result, key=lambda row: row["player_id"])


def _profile_players(raw, game, relevant_pool):
    result, seen = [], set()
    for row in _rows(raw, "Profile participants", 160):
        _fields(row, {"player_id", "team", "opponent", "position", "status", "availability_scenario", "residual"}, "Profile participant")
        pid = _id(row.get("player_id"), "Profile participant ID")
        if pid in seen:
            raise ValueError("Profile participants contain duplicate IDs.")
        seen.add(pid)
        team, opponent = _team(row.get("team")), _team(row.get("opponent"))
        if {team, opponent} != {game["home_team"], game["away_team"]} or team == opponent:
            raise ValueError("Profile participant has a different game/team/opponent.")
        if not isinstance(row.get("position"), str) or row["position"] not in {"QB", "RB", "WR", "TE", "DST", "RESIDUAL"}:
            raise ValueError("Profile participants require explicit supported positions or RESIDUAL.")
        if not isinstance(row.get("status"), str) or row["status"] not in {"active", "inactive"}:
            raise ValueError("Every participant needs an explicit active/inactive status; unknown is not active.")
        availability = row.get("availability_scenario")
        if not isinstance(availability, str) or availability not in {"normal", "limited", "inactive"}:
            raise ValueError("Every participant needs a declared normal/limited/inactive availability scenario.")
        if (row["status"] == "inactive") != (availability == "inactive"):
            raise ValueError("Participant status contradicts the availability scenario.")
        residual = row.get("residual", row["position"] == "RESIDUAL")
        if type(residual) is not bool or (row["position"] == "RESIDUAL" and not residual):
            raise ValueError("Residual actors must be explicitly identified.")
        result.append({"player_id": pid, "team": team, "opponent": opponent, "position": row["position"],
                       "status": row["status"], "availability_scenario": availability, "residual": residual})
    by_id = {row["player_id"]: row for row in result}
    for player in relevant_pool:
        actor = by_id.get(player["player_id"])
        if actor is None:
            raise ValueError("Profile coverage is incomplete; every pool participant must have explicit availability.")
        if actor["residual"] or any(actor[key] != player[key] for key in ("team", "opponent", "position")):
            raise ValueError("Profile participant contradicts the frozen player pool identity.")
    return sorted(result, key=lambda row: row["player_id"])


def prepare_scenario_bank(payload, *, context, pool, now=None):
    """Validate every profile, score its complete ledger, then publish one copy.

    No partial bank is returned. Returned content is detached from the caller;
    its content ID is checked again before evaluation to reject later mutation.
    """
    from src.products.dfs_event_scoring import SCORING_VERSION, SCORING_SOURCE, score_game_events

    started = monotonic()
    if not isinstance(payload, dict) or len(_json(payload).encode("utf-8")) > MAX_BYTES:
        raise ValueError("Scenario bank exceeds the 8 MiB finite JSON limit.")
    _fields(payload, {"schema_version", "scoring_version", "mode", "context", "decision_at", "evidence_scope", "sources", "games"}, "Scenario bank")
    if payload.get("schema_version") != SCHEMA_VERSION or payload.get("mode") != "declared_empirical_scenarios":
        raise ValueError("Use the declared empirical scenario-bank schema; quantile fitting is unsupported.")
    if payload.get("scoring_version") != SCORING_VERSION:
        raise ValueError("Scenario bank has missing or incompatible DraftKings scoring identity.")
    normalized_context = _context(context)
    if _context(payload.get("context")) != normalized_context:
        raise ValueError("Scenario bank does not match the exact requested slate context.")
    pool_copy = _pool(pool)
    decision = _time(payload.get("decision_at"), "Decision cutoff")
    current = datetime.now(timezone.utc) if now is None else (_time(now, "Current time") if isinstance(now, str) else now)
    if not isinstance(current, datetime) or current.tzinfo is None or decision > current:
        raise ValueError("Scenario decision cutoff cannot be in the future.")
    scope = payload.get("evidence_scope")
    if not isinstance(scope, str) or scope not in {"live", "retrospective", "synthetic"}:
        raise ValueError("Scenario evidence scope must be declared.")
    source_rows, sources = [], {}
    for row in _rows(payload.get("sources"), "Source receipts", 64):
        receipt = validate_source_receipt(row, evidence_scope=scope)
        if receipt["evidence_scope"] != scope:
            raise ValueError("Scenario source scope must match the bank; synthetic and retrospective evidence cannot be relabeled.")
        sid = receipt["source_id"]
        if sid in sources:
            raise ValueError("Scenario sources contain duplicate IDs.")
        if any(receipt["rights"].get(key) is not True for key in ("personal_analysis", "hosted_ingestion", "display")):
            raise ValueError("Scenario source lacks explicit analysis, hosted-ingestion or display rights.")
        for key in ("known_at", "published_at", "retrieved_at"):
            if receipt.get(key) and _time(receipt[key], key) > current:
                raise ValueError("Scenario source receipt has a future timestamp.")
        if receipt.get("known_at") and _time(receipt["known_at"], "Source known-at") > decision:
            raise ValueError("Scenario source was not known by the frozen decision cutoff.")
        if receipt.get("published_at") and _time(receipt["published_at"], "Source publication") > decision:
            raise ValueError("Scenario source publication follows the frozen decision cutoff.")
        source_rows.append(receipt)
        sources[sid] = receipt
    games, game_ids, teams = [], set(), set()
    profile_count, event_count = 0, 0
    actor_games = {}
    for original in _rows(payload.get("games"), "Slate games", MAX_GAMES):
        _fields(original, {"game_id", "home_team", "away_team", "kickoff_at", "profiles"}, "Slate game")
        game = {"game_id": _id(original.get("game_id"), "Game ID"),
                "home_team": _team(original.get("home_team")), "away_team": _team(original.get("away_team")),
                "kickoff_at": original.get("kickoff_at")}
        kickoff = _time(game["kickoff_at"], "Game kickoff")
        if game["game_id"] in game_ids or game["home_team"] == game["away_team"] or teams.intersection({game["home_team"], game["away_team"]}):
            raise ValueError("Slate games contain duplicate identities or repeated/conflicting teams.")
        if decision >= kickoff:
            raise ValueError("Frozen scenario cutoff must precede every target game kickoff.")
        game_ids.add(game["game_id"])
        teams.update((game["home_team"], game["away_team"]))
        relevant = [player for player in pool_copy if player["game_id"] == game["game_id"]]
        for player in relevant:
            if {player["team"], player["opponent"]} != {game["home_team"], game["away_team"]}:
                raise ValueError("Frozen pool player conflicts with the exact slate game.")
        profiles, profile_ids = [], set()
        for raw_profile in _rows(original.get("profiles"), "Game profiles", MAX_PROFILES):
            _fields(raw_profile, {"profile_id", "weight", "source_ids", "shared_state", "players", "events", "ledger_complete"}, "Game profile")
            pid = _id(raw_profile.get("profile_id"), "Profile ID")
            if pid in profile_ids:
                raise ValueError("Game profile IDs must be unique within each game.")
            profile_ids.add(pid)
            weight = raw_profile.get("weight")
            if type(weight) not in {int, float} or not math.isfinite(weight) or not 0 < weight <= 1000000:
                raise ValueError("Profile weights must be finite, explicitly positive numbers.")
            refs = raw_profile.get("source_ids")
            if (not isinstance(refs, list) or not refs or len(refs) > 64 or
                    any(not isinstance(ref, str) for ref in refs) or len(set(refs)) != len(refs) or any(ref not in sources for ref in refs)):
                raise ValueError("Every game profile must reference distinct supplied source receipts.")
            state = raw_profile.get("shared_state")
            if not isinstance(state, dict) or set(state) != {"weather", "game_script", "personnel"}:
                raise ValueError("Profile shared weather, game-script and personnel states must be explicit.")
            if any(not isinstance(v, str) or not v.strip() or len(v) > 300 for v in state.values()):
                raise ValueError("Shared state labels must be bounded nonempty declarations.")
            if raw_profile.get("ledger_complete") is not True:
                raise ValueError("A profile must explicitly declare its complete game event ledger.")
            players = _profile_players(raw_profile.get("players"), game, relevant)
            for player in players:
                old_game = actor_games.setdefault(player["player_id"], game["game_id"])
                if old_game != game["game_id"]:
                    raise ValueError("A canonical actor appears in more than one slate game.")
            events = _rows(raw_profile.get("events"), "Game events", MAX_EVENTS, minimum=0)
            scorer_players = [{key: value for key, value in player.items() if key != "availability_scenario"} for player in players]
            scoring_game = {key: game[key] for key in ("game_id", "home_team", "away_team")}
            scored = score_game_events({**scoring_game, "ledger_complete": True}, scorer_players, events, site="draftkings")
            if scored.get("scoring_version") != SCORING_VERSION or scored.get("audit", {}).get("complete") is not True:
                raise ValueError("Profile scoring or conservation audit is unavailable/incompatible.")
            scores = scored.get("player_scores")
            if not isinstance(scores, dict) or set(scores) != {player["player_id"] for player in players}:
                raise ValueError("Event scorer omitted participant outcomes; missing scores cannot become zero.")
            if any(type(score) not in {int, float} or not math.isfinite(score) for score in scores.values()):
                raise ValueError("Event scorer returned nonfinite fantasy outcomes.")
            profiles.append({"profile_id": pid, "weight": float(weight), "source_ids": sorted(refs),
                             "shared_state": deepcopy(state), "players": players, "player_scores": scores,
                             "team_stats": scored.get("team_stats"), "game_score": scored.get("game_score"),
                             "audit": scored["audit"], "event_count": len(events), "event_content_id": _hash(events),
                             "scored_ledger_id": scored["event_ledger_id"]})
            event_count += len(events)
            profile_count += 1
        game["profiles"] = profiles
        games.append(game)
    if any(player["game_id"] not in game_ids for player in pool_copy):
        raise ValueError("Frozen pool includes participants outside the bank's exact slate games.")
    bank = {"schema_version": SCHEMA_VERSION, "mode": "declared_empirical_scenarios", "context": normalized_context,
            "decision_at": payload["decision_at"], "evidence_scope": scope, "scoring_version": SCORING_VERSION,
            "scoring_source": deepcopy(SCORING_SOURCE),
            "semantics": SEMANTICS, "pool": pool_copy, "sources": sorted(source_rows, key=lambda row: row["source_id"]),
            "games": sorted(games, key=lambda row: row["game_id"]), "capabilities": deepcopy(CAPABILITIES),
            "counts": {"games": len(games), "profiles": profile_count, "events": event_count,
                       "pool_players": len(pool_copy), "unique_actors": len(actor_games)},
            "warnings": list(WARNINGS), "raw_input_content_id": _hash(payload)}
    bank["content_id"] = _hash(bank)
    # Timing is diagnostic metadata outside the content-addressed immutable body.
    return {**bank, "preparation_seconds": monotonic() - started}


def _verified_bank(bank):
    from src.products.dfs_event_scoring import SCORING_VERSION
    if not isinstance(bank, dict) or bank.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Prepare and validate the scenario bank before evaluation.")
    if bank.get("scoring_version") != SCORING_VERSION:
        raise ValueError("Prepared bank uses an incompatible scoring version; select a new snapshot.")
    body = {key: value for key, value in bank.items() if key not in {"content_id", "preparation_seconds"}}
    if bank.get("content_id") != _hash(body):
        raise ValueError("Prepared scenario bank changed after validation; select a new snapshot.")
    return bank


def scenario_bank_summary(bank):
    bank = _verified_bank(bank)
    return {key: deepcopy(bank[key]) for key in ("schema_version", "content_id", "context", "decision_at", "evidence_scope",
            "scoring_version", "scoring_source", "semantics", "capabilities", "counts", "sources", "warnings", "preparation_seconds")}


def _lineups(lineups, by_id):
    result, ids_seen, scoring_sets = [], set(), set()
    for index, entry in enumerate(_rows(lineups, "Complete lineups", MAX_LINEUPS)):
        _fields(entry, {"lineup_id", "player_ids"}, "Finalist lineup")
        ids = entry.get("player_ids")
        if not isinstance(ids, list) or len(ids) != 9 or any(not isinstance(pid, str) for pid in ids) or len(set(ids)) != 9:
            raise ValueError("Shared review requires complete nine-player lineups with distinct IDs.")
        ids = [_id(pid, "Lineup player ID") for pid in ids]
        if any(pid not in by_id for pid in ids):
            raise ValueError("Lineup contains an unavailable player outside the frozen pool.")
        positions = Counter(by_id[pid]["position"] for pid in ids)
        if positions["QB"] != 1 or positions["DST"] != 1 or positions["RB"] < 2 or positions["WR"] < 3 or positions["TE"] < 1:
            raise ValueError("Lineup does not fit the DraftKings Classic roster and FLEX composition.")
        salary = sum(by_id[pid]["salary"] for pid in ids)
        if salary > 50000:
            raise ValueError("Lineup exceeds the DraftKings Classic salary cap.")
        if len({by_id[pid]["game_id"] for pid in ids}) < 2:
            raise ValueError("DraftKings Classic lineups require players from at least two different NFL games.")
        lineup_id = _id(entry.get("lineup_id", str(index)), "Lineup ID")
        if lineup_id in ids_seen:
            raise ValueError("Lineup IDs must be unique.")
        key = tuple(sorted(ids))
        if key in scoring_sets:
            raise ValueError("Scoring-equivalent duplicate lineups must be removed before shared review.")
        ids_seen.add(lineup_id)
        scoring_sets.add(key)
        result.append({"lineup_id": lineup_id, "player_ids": ids, "salary": salary})
    return result


def _distribution(values):
    ordered = sorted(values)
    def quantile(q):
        location = (len(ordered) - 1) * q
        lo = int(location)
        hi = min(lo + 1, len(ordered) - 1)
        return ordered[lo] + (ordered[hi] - ordered[lo]) * (location - lo)
    return {"mean": math.fsum(values) / len(values), "p10": quantile(.1), "p50": quantile(.5), "p90": quantile(.9),
            "zero_fraction": sum(v == 0 for v in values) / len(values),
            "negative_fraction": sum(v < 0 for v in values) / len(values), "min": ordered[0], "max": ordered[-1]}


def evaluate_shared_outcomes(bank, lineups, *, seed=0, draw_count=256, purpose="evaluation"):
    """Replay common evaluation draws; no player-level jitter or correlation bonus.

    Purpose-specific independent PRNG streams can sample identical profiles by
    chance. Distinct streams are not a claim that sampled outcomes are disjoint.
    """
    started = monotonic()
    bank = _verified_bank(bank)
    if type(seed) is not int or not 0 <= seed <= 2**63 - 1:
        raise ValueError("Seed must be an explicit nonnegative 63-bit integer.")
    if type(draw_count) is not int or not 16 <= draw_count <= MAX_DRAWS:
        raise ValueError("Shared review supports 16–1024 bounded draws.")
    if not isinstance(purpose, str) or purpose not in PURPOSES:
        raise ValueError("Use a separate generation, selection or evaluation stream.")
    by_id = {player["player_id"]: player for player in bank["pool"]}
    entries = _lineups(lineups, by_id)
    streams = {name: hashlib.sha256(f"{bank['content_id']}:{seed}:{name}:dfs-shared-v1".encode()).hexdigest() for name in PURPOSES}
    rng = random.Random(int(streams[purpose], 16))
    players = {pid: [] for pid in by_id}
    draws, choices, selections = [], Counter(), []
    for _ in range(draw_count):
        scores, selected = {}, []
        for game in bank["games"]:
            profiles = game["profiles"]
            profile = rng.choices(profiles, weights=[p["weight"] for p in profiles], k=1)[0]
            selected.append((game["game_id"], profile["profile_id"]))
            choices[(game["game_id"], profile["profile_id"])] += 1
            for pid, value in profile["player_scores"].items():
                if pid in by_id:
                    scores[pid] = value
        if set(scores) != set(by_id):
            raise ValueError("A prepared draw lost participant coverage; no zero fallback is allowed.")
        for pid, value in scores.items():
            players[pid].append(value)
        draws.append([math.fsum(scores[pid] for pid in entry["player_ids"]) for entry in entries])
        selections.append(selected)
    baseline = [draw[0] for draw in draws]
    rows = []
    for index, entry in enumerate(entries):
        values = [draw[index] for draw in draws]
        deltas = [value - ref for value, ref in zip(values, baseline)]
        rows.append({**entry, **_distribution(values), "paired_delta_mean_vs_first": math.fsum(deltas) / draw_count,
                     "paired_delta_p10_vs_first": _distribution(deltas)["p10"],
                     "paired_better_fraction_vs_first": sum(v > 0 for v in deltas) / draw_count})
    return {"schema_version": RESULT_VERSION, "bank_id": bank["content_id"], "context": deepcopy(bank["context"]),
            "scoring_version": bank["scoring_version"], "semantics": SEMANTICS, "capabilities": deepcopy(CAPABILITIES),
            "draw_count": draw_count, "stream_manifest": {"version": 1, "selected_purpose": purpose, "seed": seed,
                "streams": streams, "draw_content_id": _hash(selections),
                "common_draws_across_lineups": True, "cross_game_independence_assumed": True,
                "independent_streams_not_disjoint_outcomes": True, "finalist_choice_independence_verified": False},
            "players": [{"player_id": pid, **_distribution(values)} for pid, values in sorted(players.items())],
            "lineups": rows, "profile_selections": [{"game_id": key[0], "profile_id": key[1], "draws": value} for key, value in sorted(choices.items())],
            "audit": {"conservation_passed": True, "all_profile_audits_passed": True,
                "profiles_validated": bank["counts"]["profiles"], "game_draws": draw_count * len(bank["games"]),
                "pool_players_covered": len(by_id), "lineups_evaluated": len(entries),
                "all_actor_scores_derive_from_shared_events": True},
            "runtime_seconds": monotonic() - started, "warnings": list(WARNINGS)}
