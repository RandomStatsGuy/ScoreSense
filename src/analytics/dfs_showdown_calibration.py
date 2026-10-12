"""Offline forecast diagnostics; supplied evidence is not authenticated or fitted here.

Only archived FLEX-basis forecasts known before kickoff can match declared
official completed-game outcomes. Missing archives produce coverage, never
invented calibration. Synthetic runs test calculations only.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import random
import re
import statistics

VERSION = "dfs_showdown_forecast_diagnostics_v1"
MAX_ROWS = 20000
MAX_BYTES = 8 * 1024 * 1024


def _time(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)", value):
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result if result.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _key(row):
    keys = ("season", "week", "slate_id", "player_id", "score_system_id")
    if not isinstance(row, dict) or any(row.get(key) is None for key in keys):
        raise ValueError("Every row needs season/week, slate, canonical player and scoring identities.")
    if any(not isinstance(row[key], int) or isinstance(row[key], bool) for key in keys[:2]):
        raise ValueError("Season and week must be integers.")
    if not 2000 <= row["season"] <= 2200 or not 1 <= row["week"] <= 30:
        raise ValueError("Season/week is outside the supported archive range.")
    if any(not isinstance(row[key], str) or not row[key].strip() or len(row[key]) > 150 for key in keys[2:]):
        raise ValueError("Archive identities must be bounded nonempty strings.")
    return tuple(row[key] for key in keys)


def _interval(values, *, seed=1729):
    """Resample whole slate/week blocks; one block cannot estimate uncertainty."""
    blocks = [(sum(block), len(block)) for block in values.values()]
    if len(blocks) < 2:
        return None
    rng = random.Random(seed)
    samples = []
    for _ in range(400):
        selected = [blocks[rng.randrange(len(blocks))] for _ in blocks]
        samples.append(sum(block[0] for block in selected) / sum(block[1] for block in selected))
    samples.sort()
    return {"lower": samples[9], "upper": samples[389], "confidence": 0.95,
            "method": "400 whole-slate/week bootstrap resamples", "blocks": len(blocks)}


def _metric(rows, value):
    blocks = defaultdict(list)
    for row in rows:
        blocks[(row["season"], row["week"], row["slate_id"])].append(value(row))
    values = [item for block in blocks.values() for item in block]
    return {"n": len(values), "value": statistics.fmean(values) if values else None,
            "block_interval": _interval(blocks)}


def _metrics(rows):
    result = {"n": len(rows), "slate_week_blocks": len({(r["season"], r["week"], r["slate_id"]) for r in rows}),
              "mean_error": None, "quantiles": {}, "zero_score": None}
    means = [row for row in rows if row.get("projection_statistic") == "mean" and _number(row.get("projection"))]
    if means:
        result["mean_error"] = _metric(means, lambda row: row["actual"] - row["projection"])
    for name, tau in (("p10", .1), ("p50", .5), ("p90", .9)):
        eligible = [row for row in rows if _number(row.get(name))]
        if not eligible:
            continue
        less = _metric(eligible, lambda row: float(row["actual"] < row[name]))
        equal = _metric(eligible, lambda row: float(row["actual"] == row[name]))
        leq = _metric(eligible, lambda row: float(row["actual"] <= row[name]))
        q = {"tau": tau, "n": len(eligible), "below": less, "at_threshold": equal,
             "at_or_below": leq, "above": _metric(eligible, lambda row: float(row["actual"] > row[name])),
             "pinball_loss": _metric(eligible, lambda row: (tau - float(row["actual"] < row[name])) * (row["actual"] - row[name])),
             "empirical_quantile_condition": less["value"] <= tau <= leq["value"]}
        if name == "p50":
            q["median_error"] = statistics.median(row["actual"] - row[name] for row in eligible)
        result["quantiles"][name] = q
    zeros = [row for row in rows if row.get("p_zero") is not None]
    if zeros:
        result["zero_score"] = {"n": len(zeros), "event": "exactly zero fantasy points; not zero targets or receptions",
            "observed_frequency": _metric(zeros, lambda row: float(row["actual"] == 0)),
            "predicted_probability": _metric(zeros, lambda row: row["p_zero"]),
            "brier_score": _metric(zeros, lambda row: (row["p_zero"] - float(row["actual"] == 0)) ** 2)}
    return result


def build_report(forecasts, outcomes, *, evidence_scope="retrospective", holdout_from=None):
    if evidence_scope not in {"synthetic", "retrospective"}:
        raise ValueError("Declare synthetic calculation checks or retrospective archive diagnostics.")
    if not isinstance(forecasts, list) or not isinstance(outcomes, list) or max(len(forecasts), len(outcomes)) > MAX_ROWS:
        raise ValueError("Supply bounded forecast and outcome arrays (at most 20,000 rows each).")
    if holdout_from is not None:
        if not isinstance(holdout_from, (tuple, list)) or len(holdout_from) != 2 or any(not isinstance(x, int) or isinstance(x, bool) for x in holdout_from):
            raise ValueError("Holdout start needs [season, week].")
        holdout_from = tuple(holdout_from)
    observed, seen, reasons, matched = {}, set(), Counter(), []
    for row in outcomes:
        key = _key(row)
        if key in observed:
            raise ValueError("Outcome identity is duplicated; select an explicit archive revision.")
        observed[key] = row
    for row in forecasts:
        key = _key(row)
        if key in seen:
            raise ValueError("Forecast identity is duplicated; select one frozen forecast per player/slate.")
        seen.add(key)
        if holdout_from is None:
            reasons["holdout_not_declared"] += 1
            continue
        if key[:2] < holdout_from:
            reasons["earlier_reference_week_not_evaluated"] += 1
            continue
        cutoff = _time(row.get("kickoff_at"))
        stamps = [_time(row.get(k)) for k in ("forecast_at", "data_known_at", "observed_period_end", "model_frozen_at")]
        if cutoff is None or any(stamp is None for stamp in stamps):
            reasons["pregame_known_at_evidence_missing"] += 1
            continue
        if max(stamps) >= cutoff:
            reasons["forecast_or_source_not_prelock"] += 1
            continue
        issued, data_known, observed_end, model_frozen = stamps
        observed_start = _time(row.get("observed_period_start"))
        if observed_start is None or not observed_start <= observed_end <= data_known <= issued or model_frozen > issued:
            reasons["source_unavailable_at_forecast_or_invalid_window"] += 1
            continue
        if not row.get("model_id") or not row.get("source_id") or not row.get("source_type"):
            reasons["forecast_provenance_missing"] += 1
            continue
        if row.get("basis") != "flex":
            reasons["non_flex_or_unknown_scoring_basis"] += 1
            continue
        quantiles = [row.get(k) for k in ("p10", "p50", "p90")]
        if any(value is not None and not _number(value) for value in quantiles + [row.get("projection")]):
            raise ValueError("Supplied point and quantile values must be finite numbers, or null.")
        ordered = [value for value in quantiles if value is not None]
        if ordered != sorted(ordered):
            raise ValueError("Archived quantiles must be ordered P10 <= P50 <= P90.")
        if row.get("p_zero") is not None and (not _number(row["p_zero"]) or not 0 <= row["p_zero"] <= 1):
            raise ValueError("A modeled zero-score probability must be finite and between zero and one.")
        outcome = observed.get(key)
        if outcome is None or not _number(outcome.get("points")):
            reasons["outcome_missing"] += 1
            continue
        ended, known = _time(outcome.get("ended_at")), _time(outcome.get("known_at"))
        if outcome.get("source_type") != "official_completed_game" or not outcome.get("source_id") or outcome.get("complete") is not True or ended is None or known is None or not cutoff < ended <= known or outcome.get("basis") != "flex":
            reasons["official_completed_outcome_evidence_missing"] += 1
            continue
        conditioning = row.get("availability_conditioning", "unknown")
        if conditioning == "conditional_active" and outcome.get("active") is not True:
            reasons["not_confirmed_active_for_conditional_forecast"] += 1
            continue
        if conditioning not in {"conditional_active", "scenario_mixture", "user_scenario"}:
            reasons["availability_conditioning_unknown"] += 1
            continue
        matched.append({**row, "actual": outcome["points"], "outcome_source_id": outcome.get("source_id")})
    groups = defaultdict(list)
    for row in matched:
        salary = row.get("salary")
        bucket = "unknown" if not _number(salary) or salary < 0 else "under_4000" if salary < 4000 else "4000_to_7999" if salary < 8000 else "8000_plus"
        group = (str(row.get("model_id")), str(row.get("source_id")), str(row.get("source_type")), row["score_system_id"],
                 str(row.get("role_bucket") or "unknown"), bucket, row["availability_conditioning"], str(row.get("projection_statistic") or "unknown"))
        groups[group].append(row)
    grouped = [{**dict(zip(("model_id", "source_id", "source_type", "score_system_id", "role_bucket", "salary_bucket", "availability_conditioning", "projection_statistic"), key)),
                "source_windows": sorted({str(row.get("observed_period_start")) + "/" + str(row.get("observed_period_end")) for row in rows}),
                "metrics": _metrics(rows)} for key, rows in sorted(groups.items())]
    raw = json.dumps({"forecasts": forecasts, "outcomes": outcomes, "holdout_from": holdout_from}, sort_keys=True, allow_nan=False, separators=(",", ":"))
    return {"schema_version": VERSION, "evidence_scope": evidence_scope,
            "status": "calculation_check_only" if matched and evidence_scope == "synthetic" else "retrospective_diagnostics" if matched else "coverage_only",
            "source_authenticity_verified": False, "model_fitted_or_promoted": False,
            "metrics_scope": "descriptive pooled matched FLEX rows; compare compatible source/scoring/conditioning groups separately",
            "input_sha256": hashlib.sha256(raw.encode()).hexdigest(), "holdout_from": holdout_from,
            "coverage": {"forecast_rows": len(forecasts), "outcome_rows": len(outcomes), "matched_rows": len(matched), "excluded": dict(sorted(reasons.items()))},
            "groups": grouped, "metrics": _metrics(matched) if matched else None,
            "limitations": ["Declared archived timestamps and official source types are not independently authenticated.",
                "Synthetic fixtures establish calculation correctness only; no calibration or profitable exposure claim.",
                "Mean error uses actual means only; quantiles do not imply a zero-score probability.",
                "Intervals resample whole slate/week blocks; fewer than two blocks leaves uncertainty unavailable.",
                "Later weeks are evaluated separately; this report does not fit a model or use outcomes to choose forecasts."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--forecasts", type=Path)
    parser.add_argument("--outcomes", type=Path)
    parser.add_argument("--holdout-season", type=int)
    parser.add_argument("--holdout-week", type=int)
    parser.add_argument("--synthetic", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    def read(path):
        if path is None:
            return []
        raw = path.read_bytes()
        if len(raw) > MAX_BYTES:
            raise ValueError("Each offline input is limited to 8 MiB.")
        return json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON is invalid.")))
    if (args.holdout_season is None) != (args.holdout_week is None):
        parser.error("Supply both holdout season and week.")
    holdout = (args.holdout_season, args.holdout_week) if args.holdout_season else None
    report = build_report(read(args.forecasts), read(args.outcomes), evidence_scope="synthetic" if args.synthetic else "retrospective", holdout_from=holdout)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes((json.dumps(report, indent=2, allow_nan=False) + "\n").encode())


if __name__ == "__main__":
    main()
