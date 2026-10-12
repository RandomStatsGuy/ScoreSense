"""Replay supplied whole-lineup field assumptions without claiming a fitted model.

Weights describe entire legal rosters, so stacks, bring-backs, salary use and
duplicate constructions stay dependent. No product of marginal ownership is
used. Every opponent is represented by a multinomial multiplicity at the full
declared contest size; finite template support is an explicit research limit.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import math

import numpy as np

from src.products.dfs_opportunity import validate_source_receipt
from src.products.dfs_shared_outcomes import (
    _context, _fields, _hash, _id, _json, _lineups, _pool, _rows, _time,
)

SCHEMA_VERSION = "dfs_contest_field_v1"
SAMPLE_VERSION = "dfs_contest_field_sample_v1"
SEMANTICS = "declared_legal_lineup_assumptions_not_calibrated_opponent_forecasts"
MAX_BYTES = 8 * 1024 * 1024
MAX_SCENARIOS = 4
MAX_TEMPLATES = 500
MAX_OBSERVED_ROSTERS = 20000
MAX_ENTRANTS = 100000
MAX_DRAWS = 256
PURPOSES = ("generation", "selection", "evaluation")
CONTEST_TYPES = {"mini_max", "milly", "single_entry", "three_max", "other_gpp"}
CAPABILITIES = {
    "legal_full_size_field": True,
    "explicit_duplicate_multiplicity": True,
    "ownership_sensitivity": True,
    "fitted_opponent_generator": False,
    "held_out_field_calibration": False,
    "contest_specific_ownership_verified": False,
    "calibrated_extreme_ranks": False,
    "forward_forecast": False,
    "expected_payout": False,
    "prelock_source_verified": False,
}
WARNINGS = [
    "Whole-lineup weights and ownership are supplied assumptions, not fitted or calibrated forecasts.",
    "All opponents are represented, including repeated rosters. The declared templates may omit real opponent constructions.",
    "Source times, usage rights and hashes are declarations, not proof of authenticity or pre-lock availability.",
    "Ownership changes do not change football outcomes. Broad public ownership is not certified for this contest.",
    "Separate random streams and split labels do not prove that evaluation inputs were untouched.",
    "Research ranks and payouts under these assumptions do not establish future win probabilities or expected returns.",
]
_SOURCE_FIELDS = {
    "source_id", "provider", "uri", "content_sha256", "definition", "evidence_scope",
    "period", "published_at", "retrieved_at", "known_at", "rights", "raw_filters",
    "revision", "units", "counting_definition",
}


def _integer(value, label, minimum=0, maximum=MAX_ENTRANTS):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label} requires a whole integer from {minimum} to {maximum}.")
    return value


def _positive(value, label):
    if type(value) not in {int, float} or not 0 < value <= 1000000 or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite positive weight no greater than 1000000.")
    return value


def _pool_identity(pool):
    normalized = _pool(pool)
    games, teams = {}, {}
    for player in normalized:
        pair = frozenset((player["team"], player["opponent"]))
        if len(pair) != 2 or games.setdefault(player["game_id"], pair) != pair:
            raise ValueError("Frozen field pool has contradictory game/team/opponent identities.")
        for team in pair:
            if teams.setdefault(team, player["game_id"]) != player["game_id"]:
                raise ValueError("A frozen field pool team appears in multiple slate games.")
    return normalized


def validate_field_lineups(rows, pool, *, weight_key="multiplicity"):
    """Normalize legal counted entries while deliberately preserving duplicates.

    This validator also serves independent archived-field diagnostics. Distinct
    entry IDs may have identical scoring rosters; their multiplicities are not
    discarded. Templates instead coalesce equivalent rosters after validation.
    """
    if weight_key not in {"multiplicity", "weight"}:
        raise ValueError("Field lineup weight must be multiplicity or weight.")
    by_id = {p["player_id"]: p for p in _pool_identity(pool)}
    result, seen = [], set()
    maximum = MAX_OBSERVED_ROSTERS if weight_key == "multiplicity" else MAX_TEMPLATES
    for raw in _rows(rows, "Legal field lineups", maximum):
        _fields(raw, {"lineup_id", "player_ids", weight_key}, "Legal field lineup")
        lineup_id = _id(raw.get("lineup_id"), "Field lineup ID")
        if lineup_id in seen:
            raise ValueError("Field lineup IDs must be unique; duplicate rosters use distinct IDs or multiplicities.")
        seen.add(lineup_id)
        entry = _lineups([{"lineup_id": lineup_id, "player_ids": raw.get("player_ids")}], by_id)[0]
        weight = (_integer(raw.get(weight_key), "Field multiplicity", 1)
                  if weight_key == "multiplicity" else _positive(raw.get(weight_key), "Whole-lineup weight"))
        result.append({**entry, "player_ids": sorted(entry["player_ids"]), weight_key: weight})
    if weight_key == "multiplicity" and sum(row[weight_key] for row in result) > MAX_ENTRANTS:
        raise ValueError("Counted field exceeds the supported 100000 actual entries.")
    return sorted(result, key=lambda row: row["lineup_id"])


def _source_rows(raw, scope, decision, current):
    sources = {}
    for row in _rows(raw, "Field source receipts", 64):
        _fields(row, _SOURCE_FIELDS, "Field source receipt")
        _fields(row.get("period"), {"season", "start_week", "end_week", "game_ids"}, "Source period")
        _fields(row.get("rights"), {"personal_analysis", "hosted_ingestion", "display", "redistribution", "training", "external_model"}, "Source rights")
        receipt = validate_source_receipt(row, evidence_scope=scope)
        sid = receipt["source_id"]
        if sid in sources or receipt["evidence_scope"] != scope:
            raise ValueError("Field source IDs must be unique and match the declared evidence scope.")
        if any(receipt["rights"][key] is not True for key in ("personal_analysis", "hosted_ingestion", "display")):
            raise ValueError("Field sources need explicit personal-analysis, hosted-ingestion and display rights.")
        for key in ("published_at", "known_at", "retrieved_at"):
            timestamp = _time(receipt.get(key), f"Field source {key}")
            if timestamp > current or (key != "retrieved_at" and timestamp > decision):
                raise ValueError("Field source was not available by the frozen decision cutoff or has a future time.")
        sources[sid] = receipt
    return sources


def prepare_contest_field(payload, *, context, pool, now=None):
    """Validate bounded contest-conditioned declarations and freeze a detached copy."""
    if not isinstance(payload, dict) or len(_json(payload).encode("utf-8")) > MAX_BYTES:
        raise ValueError("Field input exceeds the 8 MiB finite JSON limit.")
    _fields(payload, {"schema_version", "mode", "context", "contest", "decision_at", "evidence_scope", "sources", "scenarios"}, "Contest field")
    if payload.get("schema_version") != SCHEMA_VERSION or payload.get("mode") != "declared_legal_lineup_templates":
        raise ValueError("Use the declared legal whole-lineup field schema; fitted-model claims are unsupported.")
    normalized_context = _context(context)
    if _context(payload.get("context")) != normalized_context:
        raise ValueError("Field context does not match the exact requested slate.")
    frozen_pool = _pool_identity(pool)
    raw_contest = _fields(payload.get("contest"), {"contest_id", "contest_type", "entrant_count"}, "Field contest")
    contest_type = raw_contest.get("contest_type")
    if not isinstance(contest_type, str) or contest_type not in CONTEST_TYPES:
        raise ValueError("Field contest requires a declared supported contest type.")
    contest = {"contest_id": _id(raw_contest.get("contest_id"), "Contest ID"), "contest_type": contest_type,
               "entrant_count": _integer(raw_contest.get("entrant_count"), "Actual contest entrant count", 1)}
    decision = _time(payload.get("decision_at"), "Field decision cutoff")
    current = datetime.now(timezone.utc) if now is None else (_time(now, "Current time") if isinstance(now, str) else now)
    if not isinstance(current, datetime) or current.tzinfo is None or decision > current:
        raise ValueError("Field decision cutoff cannot be in the future.")
    scope = payload.get("evidence_scope")
    if not isinstance(scope, str) or scope not in {"live", "retrospective", "synthetic"}:
        raise ValueError("Field evidence scope must be explicitly declared.")
    sources = _source_rows(payload.get("sources"), scope, decision, current)
    scenarios, scenario_ids = [], set()
    pool_ids = {p["player_id"] for p in frozen_pool}
    for raw in _rows(payload.get("scenarios"), "Ownership field assumptions", MAX_SCENARIOS):
        _fields(raw, {"scenario_id", "provider", "injury_assumption", "known_at", "source_ids", "split_id", "ownership_units", "ownership_contest_type", "ownership", "templates"}, "Ownership field assumption")
        sid = _id(raw.get("scenario_id"), "Field assumption ID")
        if sid in scenario_ids:
            raise ValueError("Field assumption IDs must be unique.")
        scenario_ids.add(sid)
        known = _time(raw.get("known_at"), "Field assumption known-at")
        if known > decision:
            raise ValueError("Field assumption follows the frozen decision cutoff.")
        refs = raw.get("source_ids")
        if (not isinstance(refs, list) or not 1 <= len(refs) <= 64 or
                any(not isinstance(ref, str) or ref not in sources for ref in refs) or len(set(refs)) != len(refs)):
            raise ValueError("Every field assumption requires distinct supplied source references.")
        if any(_time(sources[ref]["known_at"], "Source known-at") > known for ref in refs):
            raise ValueError("A field assumption cannot precede the sources it uses.")
        if raw.get("ownership_units") != "fraction":
            raise ValueError("Ownership units must explicitly be fraction; percentages are never guessed.")
        ownership_type = raw.get("ownership_contest_type")
        if not isinstance(ownership_type, str) or ownership_type not in {contest_type, "broad_public"}:
            raise ValueError("Ownership contest type must match this field or be explicitly broad_public.")
        ownership, seen = [], set()
        for row in _rows(raw.get("ownership"), "Projected ownership", len(frozen_pool), minimum=0):
            _fields(row, {"player_id", "projected_fraction"}, "Projected ownership row")
            pid = _id(row.get("player_id"), "Ownership player ID")
            value = row.get("projected_fraction")
            if pid not in pool_ids or pid in seen:
                raise ValueError("Ownership requires unique exact IDs from the frozen pool.")
            if value is not None and (type(value) not in {int, float} or not 0 <= value <= 1 or not math.isfinite(value)):
                raise ValueError("Projected ownership must be an explicit fraction from zero to one, or unknown.")
            seen.add(pid)
            ownership.append({"player_id": pid, "projected_fraction": value})
        template_rows = []
        for row in _rows(raw.get("templates"), "Whole-lineup templates", MAX_TEMPLATES):
            _fields(row, {"template_id", "player_ids", "weight"}, "Whole-lineup template")
            template_rows.append({"lineup_id": row.get("template_id"), "player_ids": row.get("player_ids"), "weight": row.get("weight")})
        legal = validate_field_lineups(template_rows, frozen_pool, weight_key="weight")
        groups = defaultdict(list)
        for row in legal:
            groups[tuple(row["player_ids"])].append(row)
        total_weight = math.fsum(row["weight"] for row in legal)
        templates = []
        for player_ids, group in sorted(groups.items()):
            weight = math.fsum(row["weight"] for row in group)
            probability = weight / total_weight
            if probability == 0:
                raise ValueError("A positive template weight cannot be represented as a sampling probability; use a less extreme weight range.")
            templates.append({"template_id": group[0]["lineup_id"], "declared_template_ids": [row["lineup_id"] for row in group],
                              "player_ids": list(player_ids), "salary": group[0]["salary"], "weight": weight,
                              "probability": probability})
        implied = {pid: math.fsum(row["probability"] for row in templates if pid in row["player_ids"]) for pid in pool_ids}
        gaps = [abs(row["projected_fraction"] - implied[row["player_id"]]) for row in ownership if row["projected_fraction"] is not None]
        consistency = {"semantics": "declared_ownership_vs_whole_template_probabilities_not_empirical_calibration",
                       "known_players": len(gaps), "missing_players": len(pool_ids) - len(gaps),
                       "mean_absolute_fraction_gap": math.fsum(gaps) / len(gaps) if gaps else None,
                       "maximum_absolute_fraction_gap": max(gaps) if gaps else None,
                       "pool_players_with_template_support": sum(value > 0 for value in implied.values())}
        scenarios.append({"scenario_id": sid, "provider": _id(raw.get("provider"), "Ownership provider"),
                          "injury_assumption": _id(raw.get("injury_assumption"), "Injury assumption"),
                          "known_at": raw["known_at"], "source_ids": sorted(refs), "split_id": _id(raw.get("split_id"), "Field construction split ID"),
                          "ownership_units": "fraction", "ownership_contest_type": ownership_type,
                          "ownership": sorted(ownership, key=lambda row: row["player_id"]), "templates": templates,
                          "ownership_consistency": consistency,
                          "declared_template_count": len(legal), "unique_template_count": len(templates),
                          "known_projected_ownership_count": sum(row["projected_fraction"] is not None for row in ownership)})
    result = {"schema_version": SCHEMA_VERSION, "mode": "declared_legal_lineup_templates", "context": normalized_context,
              "contest": contest, "decision_at": payload["decision_at"], "evidence_scope": scope, "semantics": SEMANTICS,
              "pool": frozen_pool, "sources": sorted(sources.values(), key=lambda row: row["source_id"]),
              "scenarios": sorted(scenarios, key=lambda row: row["scenario_id"]), "capabilities": deepcopy(CAPABILITIES),
              "warnings": list(WARNINGS), "raw_input_content_id": _hash(payload)}
    result["content_id"] = _hash(result)
    return result


validate_contest_research = prepare_contest_field


def verified_contest_field(field):
    if not isinstance(field, dict) or field.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Prepare the legal contest field before sampling.")
    body = {key: value for key, value in field.items() if key != "content_id"}
    if field.get("content_id") != _hash(body):
        raise ValueError("Prepared contest field changed after validation; select a new snapshot.")
    return field


def field_summary(field):
    """A receipt safe to display without copying raw lineups or player forecasts."""
    field = verified_contest_field(field)
    summary = {key: deepcopy(field[key]) for key in ("schema_version", "content_id", "context", "contest", "decision_at",
               "evidence_scope", "semantics", "sources", "capabilities", "warnings", "raw_input_content_id")}
    summary["pool_player_count"] = len(field["pool"])
    summary["scenarios"] = [{key: deepcopy(row[key]) for key in ("scenario_id", "provider", "injury_assumption", "known_at", "source_ids", "split_id",
                              "ownership_units", "ownership_contest_type", "declared_template_count", "unique_template_count", "known_projected_ownership_count", "ownership_consistency")}
                            for row in field["scenarios"]]
    return summary


def _sample_counts(field, opponent_entry_count, *, scenario_id, seed, draw_index, purpose):
    """Draw an exact full-size multinomial count; no small-field rank scaling.

    The PCG64 algorithm and NumPy version are recorded. Stream separation is
    deterministic by purpose, field snapshot, assumption and draw index.
    """
    opponent_entry_count = _integer(opponent_entry_count, "Actual opponent entry count", 0, field["contest"]["entrant_count"])
    _integer(seed, "Seed", 0, 2**63 - 1)
    _integer(draw_index, "Draw index", 0, MAX_DRAWS - 1)
    if purpose not in PURPOSES:
        raise ValueError("Use a separate generation, selection or evaluation stream.")
    scenario_id = _id(scenario_id, "Field assumption ID")
    scenario = next((row for row in field["scenarios"] if row["scenario_id"] == scenario_id), None)
    if scenario is None:
        raise ValueError("Selected field assumption is unavailable in this snapshot.")
    stream_id = hashlib.sha256(f"{field['content_id']}:{scenario_id}:{seed}:{purpose}:{draw_index}:dfs-field-pcg64-v1".encode()).hexdigest()
    rng = np.random.Generator(np.random.PCG64(int(stream_id, 16)))
    # NumPy interprets its last probability as the remaining mass. Put the
    # largest category last so finite summation cannot exceed one before it.
    order = sorted(range(len(scenario["templates"])), key=lambda index: scenario["templates"][index]["probability"])
    probabilities = [scenario["templates"][index]["probability"] for index in order]
    total = math.fsum(probabilities)
    probabilities = [value / total for value in probabilities]
    sampled = rng.multinomial(opponent_entry_count, probabilities)
    counts = [0] * len(order)
    for index, count in zip(order, sampled):
        counts[index] = int(count)
    rows = [{"template_id": row["template_id"], "player_ids": list(row["player_ids"]), "multiplicity": int(count)}
            for row, count in zip(scenario["templates"], counts)]
    result = {"schema_version": SAMPLE_VERSION, "field_id": field["content_id"], "scenario_id": scenario_id,
              "opponent_entry_count": opponent_entry_count, "template_counts": rows, "stream_id": stream_id,
              "seed": seed, "draw_index": draw_index, "purpose": purpose,
              "rng": {"algorithm": "PCG64", "library": "numpy", "version": np.__version__},
              "full_field_represented": sum(row["multiplicity"] for row in rows) == opponent_entry_count,
              "finite_template_support_not_calibrated": True}
    result["content_id"] = _hash(result)
    return result


def sample_field_counts(field, opponent_entry_count, *, scenario_id, seed=0, draw_index=0, purpose="evaluation"):
    """Sample one immutable field draw after checking the snapshot hash."""
    field = verified_contest_field(field)
    return _sample_counts(field, opponent_entry_count, scenario_id=scenario_id, seed=seed,
                          draw_index=draw_index, purpose=purpose)


def sample_field_draws(field, opponent_entry_count, *, scenario_id, seed=0, draw_count=128, purpose="evaluation"):
    """Bounded batch sampling verifies the frozen field only once.

    Returned count rows are detached copies. A caller cannot mutate the field
    during this synchronous operation; there are no callbacks or I/O.
    """
    return list(iter_field_draws(field, opponent_entry_count, scenario_id=scenario_id, seed=seed,
                                draw_count=draw_count, purpose=purpose))


def iter_field_draws(field, opponent_entry_count, *, scenario_id, seed=0, draw_count=128, purpose="evaluation"):
    """Check the snapshot now, then lazily sample a detached compact assumption.

    Only one draw's counts need remain in memory. Caller mutation of the original
    field after creating the iterator cannot change later replay draws.
    """
    field = verified_contest_field(field)
    _integer(draw_count, "Field draw count", 1, MAX_DRAWS)
    _integer(opponent_entry_count, "Actual opponent entry count", 0, field["contest"]["entrant_count"])
    _integer(seed, "Seed", 0, 2**63 - 1)
    if purpose not in PURPOSES:
        raise ValueError("Use a separate generation, selection or evaluation stream.")
    scenario_id = _id(scenario_id, "Field assumption ID")
    scenario = next((row for row in field["scenarios"] if row["scenario_id"] == scenario_id), None)
    if scenario is None:
        raise ValueError("Selected field assumption is unavailable in this snapshot.")
    compact = {"content_id": field["content_id"], "contest": deepcopy(field["contest"]),
               "scenarios": [{"scenario_id": scenario_id, "templates": deepcopy(scenario["templates"])}]}
    return (_sample_counts(compact, opponent_entry_count, scenario_id=scenario_id, seed=seed,
                           draw_index=index, purpose=purpose) for index in range(draw_count))
