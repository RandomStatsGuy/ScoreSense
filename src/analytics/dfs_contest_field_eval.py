"""Offline diagnostics for declared, independently withheld contest fields.

This compares complete counted rosters. It never fits a generator, fetches a
contest, estimates payout, or certifies that a declared holdout was untouched.
Source receipts and split attestations are retained as declarations.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import hashlib
from itertools import combinations
import json
from pathlib import Path

from src.products.dfs_contest_field import validate_field_lineups, MAX_ENTRANTS
from src.products.dfs_opportunity import validate_source_receipt
from src.products.dfs_shared_outcomes import _context, _id, _pool, _time

VERSION = "dfs_contest_field_holdout_report_v1"
MANIFEST_VERSION = "dfs_contest_field_holdout_v1"
MAX_BYTES = 8 * 1024 * 1024
MAX_ROWS = 20000
MAX_ENTRIES = MAX_ENTRANTS
MAX_PAIR_ROWS = 100


def _fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(f"{label} contains unsupported fields.")


def _ids(value, label, *, empty=False):
    if not isinstance(value, list) or not (0 if empty else 1) <= len(value) <= 128:
        raise ValueError(f"{label} requires bounded explicit identities.")
    result = [_id(item, label) for item in value]
    if len(set(result)) != len(result):
        raise ValueError(f"{label} contains duplicate identities.")
    return result


def _manifest(manifest, sources, context):
    _fields(manifest, {"schema_version", "model_id", "model_frozen_at", "forecast_source_ids",
        "training_blocks", "tuning_blocks", "evaluation_block", "observed_source_ids",
        "independence_attestations", "evidence_scope", "contest_id", "contest_type",
        "contest_entrant_count", "observed_field_scope"}, "Holdout manifest")
    if manifest.get("schema_version") != MANIFEST_VERSION:
        raise ValueError("Use a versioned contest-field holdout manifest.")
    scope = manifest.get("evidence_scope")
    if not isinstance(scope, str) or scope not in {"synthetic", "retrospective"}:
        raise ValueError("Offline field diagnostics must declare synthetic or retrospective evidence.")
    _id(manifest.get("model_id"), "Model ID")
    _id(manifest.get("contest_id"), "Contest ID")
    _id(manifest.get("contest_type"), "Contest type")
    entrant_count = manifest.get("contest_entrant_count")
    if type(entrant_count) is not int or not 1 <= entrant_count <= MAX_ENTRIES:
        raise ValueError("Declare the actual bounded contest entrant count.")
    if not isinstance(manifest.get("observed_field_scope"), str) or manifest["observed_field_scope"] not in {"complete_contest_field", "partial_observed_sample"}:
        raise ValueError("Declare whether withheld observations cover the whole contest or a partial sample.")
    frozen = _time(manifest.get("model_frozen_at"), "Model freeze")
    evaluation = manifest.get("evaluation_block")
    _fields(evaluation, {"block_id", "starts_at", "ends_at"}, "Evaluation block")
    evaluation_id = _id(evaluation.get("block_id"), "Evaluation block ID")
    starts, ends = (_time(evaluation.get(key), f"Evaluation {key}") for key in ("starts_at", "ends_at"))
    if not frozen < starts < ends:
        raise ValueError("Freeze the generator strictly before the withheld evaluation block.")
    if not isinstance(sources, list) or not 2 <= len(sources) <= 128:
        raise ValueError("Holdout diagnostics need bounded, separate forecast and observation receipts.")
    receipts = []
    for row in sources:
        _fields(row, {"source_id", "provider", "uri", "content_sha256", "definition", "evidence_scope", "period",
            "published_at", "retrieved_at", "known_at", "rights", "raw_filters", "revision", "units", "counting_definition"}, "Source receipt")
        _fields(row.get("period"), {"season", "start_week", "end_week", "game_ids"}, "Source period")
        _fields(row.get("rights"), {"personal_analysis", "hosted_ingestion", "display", "redistribution", "training", "external_model"}, "Source rights")
        receipts.append(validate_source_receipt(row, evidence_scope=scope))
    by_source = {row["source_id"]: row for row in receipts}
    if len(by_source) != len(receipts):
        raise ValueError("Source identities must be unique.")
    if any(row["rights"]["personal_analysis"] is not True for row in receipts):
        raise ValueError("Every source requires explicit personal-analysis rights.")
    if any(row["evidence_scope"] != scope for row in receipts):
        raise ValueError("Synthetic and observed retrospective evidence cannot be relabeled as one another.")
    forecast_ids = _ids(manifest.get("forecast_source_ids"), "Forecast source IDs")
    observed_ids = _ids(manifest.get("observed_source_ids"), "Observed source IDs")
    used_ids = set(forecast_ids + observed_ids)
    blocks_seen, earlier_ids = {evaluation_id}, set(forecast_ids)
    for kind in ("training_blocks", "tuning_blocks"):
        blocks = manifest.get(kind)
        if not isinstance(blocks, list) or len(blocks) > 128 or (kind == "training_blocks" and not blocks):
            raise ValueError("Declare bounded training and tuning blocks; training cannot be empty.")
        for block in blocks:
            _fields(block, {"block_id", "through_at", "source_ids"}, "Earlier field block")
            identity = _id(block.get("block_id"), "Earlier block ID")
            if identity in blocks_seen:
                raise ValueError("Training, tuning and evaluation block identities must be disjoint.")
            blocks_seen.add(identity)
            if not _time(block.get("through_at"), "Earlier block end") <= frozen:
                raise ValueError("Training and tuning blocks must end before the declared model freeze.")
            source_ids = _ids(block.get("source_ids"), "Earlier block source IDs")
            used_ids.update(source_ids)
            earlier_ids.update(source_ids)
    if used_ids != set(by_source):
        raise ValueError("Every receipt must be referenced, and every referenced receipt must be supplied.")
    if earlier_ids & set(observed_ids):
        raise ValueError("Withheld observations cannot also supply training, tuning or the forecast.")
    if {by_source[sid]["content_sha256"] for sid in earlier_ids} & {
            by_source[sid]["content_sha256"] for sid in observed_ids}:
        raise ValueError("Withheld observation content hashes overlap earlier inputs.")
    for sid in earlier_ids:
        row = by_source[sid]
        if row["published_at"] is None or row["known_at"] is None or max(
                _time(row[key], f"Earlier source {key}") for key in ("published_at", "known_at")) > frozen:
            raise ValueError("Earlier source publication and known-at must precede the model freeze.")
    for sid in observed_ids:
        row = by_source[sid]
        if row["period"]["season"] != context["season"] or not (
                row["period"]["start_week"] <= context["week"] <= row["period"]["end_week"]):
            raise ValueError("Withheld observation source period must cover the evaluated slate.")
        if row["published_at"] is None or row["known_at"] is None or min(
                _time(row[key], f"Observed source {key}") for key in ("published_at", "known_at")) < ends:
            raise ValueError("Complete withheld observations must be published and known after the block ends.")
    attestations = manifest.get("independence_attestations")
    required = {"no_evaluation_outcomes_in_training", "no_evaluation_outcomes_in_tuning",
                "no_evaluation_outcomes_in_forecast"}
    if not isinstance(attestations, dict) or set(attestations) != required or any(
            attestations[key] is not True for key in required):
        raise ValueError("Declare each holdout independence attestation explicitly.")
    return deepcopy(manifest), receipts


def _counted(rows, pool):
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        raise ValueError("Each field needs 1–20000 explicit counted legal rosters.")
    entries = validate_field_lineups(rows, pool, weight_key="multiplicity")
    total = sum(row["multiplicity"] for row in entries)
    if not 1 <= total <= MAX_ENTRIES:
        raise ValueError(f"Represent each field with 1–{MAX_ENTRIES} actual counted entries.")
    return entries, total


def _summarize(entries, total, pool):
    by_id = {row["player_id"]: row for row in pool}
    marginals, pairs, attachments, bringbacks, salaries, constructions = (Counter() for _ in range(6))
    for row in entries:
        ids, count = row["player_ids"], row["multiplicity"]
        marginals.update({pid: count for pid in ids})
        pairs.update({pair: count for pair in combinations(sorted(ids), 2)})
        qb = next(by_id[pid] for pid in ids if by_id[pid]["position"] == "QB")
        attached = sum(by_id[pid]["position"] in {"WR", "TE"} and by_id[pid]["team"] == qb["team"] for pid in ids)
        opposing = sum(by_id[pid]["position"] != "DST" and by_id[pid]["team"] == qb["opponent"] for pid in ids)
        attachments[attached] += count
        bringbacks[opposing] += count
        salaries[row["salary"]] += count
        constructions[tuple(sorted(ids))] += count
    repeated = sum(count for count in constructions.values() if count > 1)
    return {"entries": total, "unique_constructions": len(constructions), "marginals": marginals,
        "pairs": pairs, "qb_wr_te_attachments": attachments, "opposing_offensive_players": bringbacks,
        "salary": salaries, "mean_salary": sum(salary * count for salary, count in salaries.items()) / total,
        "duplicate_excess_fraction": (total - len(constructions)) / total,
        "entries_in_repeated_constructions_fraction": repeated / total,
        "construction_multiplicity": Counter(constructions.values())}


def _distribution(generated, observed, generated_total, observed_total):
    keys = sorted(set(generated) | set(observed))
    return {"total_variation": sum(abs(generated[key] / generated_total - observed[key] / observed_total)
            for key in keys) / 2,
        "rows": [{"value": key, "generated_count": generated[key], "observed_count": observed[key],
                  "generated_fraction": generated[key] / generated_total,
                  "observed_fraction": observed[key] / observed_total} for key in keys]}


def evaluate_field_frequencies(*, context, pool, generated_entries, observed_entries, manifest, sources):
    """Compare one withheld contest block; field sizes may differ explicitly.

    Repeated opponent constructions retain multiplicity. Frequencies are entry
    weighted. QB attachments mean WR/TE only; this diagnostic does not infer
    receiving-RB roles. No single-block error establishes future calibration.
    """
    context, pool = _context(context), _pool(pool)
    manifest, receipts = _manifest(manifest, sources, context)
    generated, generated_total = _counted(generated_entries, pool)
    observed, observed_total = _counted(observed_entries, pool)
    entrant_count = manifest["contest_entrant_count"]
    if observed_total > entrant_count or (manifest["observed_field_scope"] == "complete_contest_field" and observed_total != entrant_count):
        raise ValueError("Withheld observation counts do not match the declared actual contest and coverage scope.")
    left, right = (_summarize(rows, total, pool) for rows, total in (
        (generated, generated_total), (observed, observed_total)))
    player_rows = [{"player_id": row["player_id"],
        "generated_count": left["marginals"][row["player_id"]], "observed_count": right["marginals"][row["player_id"]],
        "generated_fraction": left["marginals"][row["player_id"]] / generated_total,
        "observed_fraction": right["marginals"][row["player_id"]] / observed_total} for row in pool]
    pair_keys = set(left["pairs"]) | set(right["pairs"])
    pair_rows = [{"player_ids": list(pair), "generated_count": left["pairs"][pair],
        "observed_count": right["pairs"][pair], "generated_fraction": left["pairs"][pair] / generated_total,
        "observed_fraction": right["pairs"][pair] / observed_total} for pair in pair_keys]
    for row in player_rows + pair_rows:
        row["absolute_error_percentage_points"] = 100 * abs(row["generated_fraction"] - row["observed_fraction"])
    pair_rows.sort(key=lambda row: (-row["absolute_error_percentage_points"], row["player_ids"]))
    salary = _distribution(left["salary"], right["salary"], generated_total, observed_total)
    cumulative_left = cumulative_right = 0.0
    cdf_error = 0.0
    for row in salary["rows"]:
        cumulative_left += row["generated_fraction"]
        cumulative_right += row["observed_fraction"]
        cdf_error = max(cdf_error, abs(cumulative_left - cumulative_right))
    encoded_inputs = json.dumps({"context": context, "pool": pool, "generated_entries": generated,
        "observed_entries": observed, "manifest": manifest, "sources": receipts},
        sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return {"schema_version": VERSION, "input_content_id": hashlib.sha256(encoded_inputs).hexdigest(),
        "context": context, "manifest": manifest, "sources": receipts,
        "semantics": "declared_holdout_entry_weighted_diagnostics_not_validated_forecasts_or_payouts",
        "coverage": {"evaluation_blocks": 1, "generated_entries": generated_total, "observed_entries": observed_total,
            "contest_entrant_count": entrant_count, "observed_field_scope": manifest["observed_field_scope"],
            "observed_contest_fraction": observed_total / entrant_count,
            "generated_unique_constructions": left["unique_constructions"],
            "observed_unique_constructions": right["unique_constructions"], "player_dimensions": len(pool),
            "active_pair_dimensions": len(pair_rows), "legal_rosters_checked": len(generated) + len(observed)},
        "players": {"mean_absolute_error_percentage_points": sum(row["absolute_error_percentage_points"] for row in player_rows) / len(player_rows),
                    "rows": player_rows},
        "pairs": {"mean_absolute_error_percentage_points_over_active_pairs": sum(row["absolute_error_percentage_points"] for row in pair_rows) / len(pair_rows),
            "pair_dimensions_with_nonzero_frequency": len(pair_rows), "reported_rows": min(len(pair_rows), MAX_PAIR_ROWS),
            "row_limit": MAX_PAIR_ROWS, "rows": pair_rows[:MAX_PAIR_ROWS]},
        "qb_wr_te_attachments": _distribution(left["qb_wr_te_attachments"], right["qb_wr_te_attachments"], generated_total, observed_total),
        "opposing_offensive_players": _distribution(left["opposing_offensive_players"], right["opposing_offensive_players"], generated_total, observed_total),
        "salary": {**salary, "generated_mean": left["mean_salary"], "observed_mean": right["mean_salary"],
            "absolute_mean_difference": abs(left["mean_salary"] - right["mean_salary"]), "max_cdf_difference": cdf_error},
        "duplicates": {"generated_excess_fraction": left["duplicate_excess_fraction"],
            "observed_excess_fraction": right["duplicate_excess_fraction"],
            "generated_entries_in_repeated_constructions_fraction": left["entries_in_repeated_constructions_fraction"],
            "observed_entries_in_repeated_constructions_fraction": right["entries_in_repeated_constructions_fraction"],
            "construction_multiplicity": _distribution(left["construction_multiplicity"], right["construction_multiplicity"],
                left["unique_constructions"], right["unique_constructions"])},
        "rights": {key: all(row["rights"][key] is True for row in receipts)
            for key in ("personal_analysis", "hosted_ingestion", "display", "redistribution", "training", "external_model")},
        "capabilities": {"legal_counted_rosters": True, "entry_weighted_field_diagnostics": True,
            "chronological_declarations_checked": True, "holdout_independence_verified": False,
            "calibrated_field": False, "large_field_rank_probabilities": False, "expected_payout": False},
        "warnings": ["Source timestamps, hashes and holdout attestations are declarations, not independent proof of provenance or untouched evaluation.",
            "One withheld block is descriptive; no block confidence interval or calibration acceptance threshold is inferred.",
            "Ownership and pair frequencies count complete legal entries; marginal ownership is never multiplied into duplication estimates.",
            "QB attachment counts include same-team WR/TE only. Opposing offensive-player counts exclude DST.",
            "Generated and observed sizes are reported separately; no large-field rank or rare-payout extrapolation is performed.",
            "Raw rosters are omitted from this report. Retained source rights still govern sharing, hosting and reuse."]}


def _pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            raise ValueError("Diagnostic JSON contains duplicate object keys.")
        result[key] = value
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with args.input.open("rb") as handle:
        raw = handle.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Diagnostic input exceeds the 8 MiB limit.")
    def reject_constant(value):
        raise ValueError(f"Diagnostic JSON contains nonfinite {value}.")
    payload = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_pairs, parse_constant=reject_constant)
    report = evaluate_field_frequencies(**payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8", newline="\n")
    print(json.dumps({"input_content_id": report["input_content_id"], "coverage": report["coverage"],
        "capabilities": report["capabilities"]}, indent=2))


if __name__ == "__main__":
    main()
