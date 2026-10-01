"""Paired offline candidate diagnostics; never changes production routing.

Historical market lines are closing-line proxies, not archived weekly snapshots.
2025 has already been explored and is a later-season check, not an untouched test.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from src.analytics.forecast_validation import (
    MARKET_COLS, INDUSTRY_SIZED_LIMITS, actionable_mask, attach_game_market, boom_flags, forecast_metrics,
    paired_week_bootstrap,
)
from src.analytics.recent_usage_eval import GATE_SEASONS, promotion_gate
from src.core.features import feature_completeness, get_position_features, prepare_feature_matrix
from src.ml.quantile import predict_quantiles, train_quantile_models, training_specification
from src.ml.quantile import repair_quantile_order
from src.core.game_market import missing_market
from src.ml.training_config import DEFAULT_TRAINING_CONFIG, RB_P90_BOOM_WEIGHT_3, WR_P90_BOOM_WEIGHT_3, TrainingConfig
from src.projections.temporal_inputs import (
    RECENT_MEDIAN_POLICY, MARKET_MEDIAN_POLICY, feature_digest, policy_feature_cols, quantile_feature_subsets,
    training_inputs,
)

CANDIDATES = ("game_market_p50", "p90_boom_weight_2", "p90_uniform")


def candidate_contract(candidate: str, reference_cols: list[str], config: TrainingConfig) -> tuple[float, list[str], TrainingConfig]:
    if candidate == "game_market_p50":
        cols = [c for c in reference_cols if c not in ("implied_team_total_avg", "total_line_avg")]
        return .5, cols + MARKET_COLS, config
    if candidate in ("p90_boom_weight_2", "p90_uniform"):
        return .9, [], TrainingConfig(name=candidate, boom_weight_p90=2. if candidate.endswith("2") else 1.)
    raise ValueError(f"Unknown research candidate: {candidate}")


def _cohorts(rows: pd.DataFrame, reference: pd.DataFrame, candidate: pd.DataFrame, position: str) -> dict:
    masks = {"all_observed": None, "actionable": actionable_mask(rows, reference)}
    masks["industry_sized"] = actionable_mask(rows, reference, INDUSTRY_SIZED_LIMITS)
    # Rank-based boom flags are fixed on the full pool before subsetting.
    ref_flags, cand_flags = boom_flags(rows, reference, position), boom_flags(rows, candidate, position)
    results = {name: {"reference": forecast_metrics(rows, reference, position, mask=mask, flags=ref_flags),
                   "candidate": forecast_metrics(rows, candidate, position, mask=mask, flags=cand_flags),
                   "paired_mae": paired_week_bootstrap(rows, reference, candidate, mask=mask)}
            for name, mask in masks.items()}
    for actual_position in rows.position.str.upper().unique():
        mask = rows.position.str.upper().eq(actual_position) & masks["industry_sized"]
        if mask.any():
            results[f"industry_sized_{actual_position.lower()}"] = {
                "reference": forecast_metrics(rows, reference, position, mask=mask, flags=ref_flags),
                "candidate": forecast_metrics(rows, candidate, position, mask=mask, flags=cand_flags),
                "paired_mae": paired_week_bootstrap(rows, reference, candidate, mask=mask)}
    return results


def diagnostic_gate(comparisons: list[dict]) -> dict:
    """Preserve the existing gate and add point-error and false-alarm constraints.

    This research decision is not a production gate artifact. Training cannot
    consume it. Final publication needs versioned train/infer feature parity.
    """
    original = []
    if len({r["season"] for r in comparisons}) != len(comparisons):
        raise ValueError("Each walk-forward season must appear once")
    for row in comparisons:
        metrics = row["cohorts"]["all_observed"]
        if any(metrics[s]["boom"]["recall"] is None for s in ("reference", "candidate")):
            return {"legacy_composite_gate": {"eligible_for_publication": False},
                    "additional_failures": ["Boom recall unavailable in a required comparison"],
                    "research_qualified": False, "production_eligible": False}
        original.append({"season": row["season"], **{
            label: {"boom_recall": metrics[source]["boom"]["recall"],
                    "composite": .1*metrics[source]["mae"] + .4*(1.-metrics[source]["boom"]["recall"])}
            for label, source in (("baseline", "reference"), ("recent", "candidate"))}})
    gate = promotion_gate(original)
    required = [r for r in comparisons if r["season"] in GATE_SEASONS]
    failures = []
    for cohort in ("all_observed", "actionable"):
        def deltas(metric):
            return [r["cohorts"][cohort]["candidate"][metric]-r["cohorts"][cohort]["reference"][metric] for r in required]
        for metric in ("mae", "weighted_interval_score"):
            values = deltas(metric)
            if not values or np.mean(values) >= 0.:
                failures.append(f"{cohort}: mean {metric} does not improve")
        for r in required:
            pair = r["cohorts"][cohort]
            for event, metric, limit in (("boom", "recall", -.02), ("boom", "precision", -.02), ("bust", "f1", -.02)):
                a, b = pair["candidate"][event][metric], pair["reference"][event][metric]
                if a is None or b is None or not np.isfinite([a, b]).all() or a-b < limit:
                    failures.append(f"{r['season']} {cohort}: {event} {metric} drops over 2pp or unavailable")
    later = next((r for r in comparisons if r["season"] == 2025), None)
    if later:
        for cohort in ("all_observed", "actionable"):
            pair = later["cohorts"][cohort]
            ci = pair.get("paired_mae", {}).get("ci95")
            if ci is None or len(ci) != 2 or not np.isfinite(ci).all() or ci[1] >= 0.:
                failures.append(f"2025 {cohort}: paired week-bootstrap MAE interval does not exclude zero")
            for metric in ("mae", "weighted_interval_score"):
                if pair["candidate"][metric] >= pair["reference"][metric]:
                    failures.append(f"2025 {cohort}: {metric} does not improve")
            for event, metric in (("boom", "recall"), ("boom", "precision"), ("bust", "f1")):
                a, b = pair["candidate"][event][metric], pair["reference"][event][metric]
                if a is None or b is None or not np.isfinite([a, b]).all() or a-b < -.02:
                    failures.append(f"2025 {cohort}: {event} {metric} drops over 2pp or unavailable")
    return {"legacy_composite_gate": gate, "additional_failures": failures,
            "research_qualified": bool(gate["eligible_for_publication"] and not failures),
            "production_eligible": False}


def publication_evidence(report: dict) -> dict:
    """Freeze a qualified market experiment in the exact-data training format."""
    checked = diagnostic_gate(report["comparisons"])
    if report["candidate"] != "game_market_p50" or not checked["research_qualified"]:
        raise ValueError("Only a complete qualified game-market experiment can be published")
    last = next(r for r in report["comparisons"] if r["season"] == 2025)
    return {**report, "candidate_policy": MARKET_MEDIAN_POLICY, "pregame_safe": True,
            "training_config": {"qb": "default", "rb": "rb_p90_boom_3", "wr": "wr_p90_boom_3"}[report["position"]],
            "training_specification": report["reference_specification"],
            "feature_cols": report["union_feature_cols"],
            "training_through_2024_digest": last["union_training_digest"],
            "gate": checked["legacy_composite_gate"], "diagnostic_gate": {**checked, "production_eligible": True},
            "fallback_policy": RECENT_MEDIAN_POLICY}


def _load_reference(directory: Path, position: str, cols: list[str], X: pd.DataFrame,
                    y: pd.Series, config: TrainingConfig, max_season: int) -> dict:
    filename = f"{position}_model{'_calibrated' if position != 'qb' else ''}.joblib"
    bundle = joblib.load(directory / filename)
    if (bundle.get("position") != position or bundle.get("input_policy") != RECENT_MEDIAN_POLICY
        or bundle.get("feature_cols") != cols or bundle.get("train_seasons") != list(range(2018, max_season+1))
        or bundle.get("training_digest") != feature_digest(X, y)
        or bundle.get("training_config") != config.name):
        raise ValueError("Reference bundle does not match the paired training contract")
    # Verify actual fitted heads too; metadata alone is insufficient.
    models = bundle["quantile_models"]
    subsets = {**quantile_feature_subsets(position, cols, RECENT_MEDIAN_POLICY), .5: cols}
    specification = training_specification(config, position)["regressors"]
    for q in (.1, .5, .9):
        if list(models[q].feature_names_in_) != subsets[q] or models[q].get_params() != specification[str(q)]:
            raise ValueError("Reference fitted head differs from expected training specification")
    return models


def evaluate(position: str, data_dir: Path, schedules_path: Path, output: Path,
             candidate_name: str, seasons: list[int], reference_dir: Path | None = None,
             checkpoint_dir: Path | None = None) -> dict:
    data_path = data_dir / f"{position}_mlready.parquet"
    data = pd.read_parquet(data_path)
    data = data[data.Fpts.notna()].sort_values(["player_id", "season", "week"]).reset_index(drop=True)
    frame = training_inputs(data, position, RECENT_MEDIAN_POLICY)
    cols = policy_feature_cols(position, list(get_position_features(position).feature_cols), RECENT_MEDIAN_POLICY)
    subsets = {**quantile_feature_subsets(position, cols, RECENT_MEDIAN_POLICY), .5: cols}
    config = {"qb": DEFAULT_TRAINING_CONFIG, "rb": RB_P90_BOOM_WEIGHT_3, "wr": WR_P90_BOOM_WEIGHT_3}[position]
    alpha, candidate_cols, candidate_config = candidate_contract(candidate_name, cols, config)
    if alpha == .9:
        candidate_cols = subsets[.9]
    enriched = attach_game_market(frame, pd.read_parquet(schedules_path)) if alpha == .5 else frame
    union_cols = list(dict.fromkeys(cols + candidate_cols))
    report = {"position": position, "candidate": candidate_name, "reference_policy": RECENT_MEDIAN_POLICY,
        "cohort": "Observed regular-season player-stat rows, including zero/negative scores; inactive roster weeks not reconstructed.",
        "source_sha256": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (data_path, schedules_path)},
        "market_timing": "Historical closing-line proxy, not archived Thursday/Sunday weekly snapshots.",
        "later_season_note": "2025 has been explored; not an untouched holdout.",
        "candidate_feature_cols": candidate_cols, "candidate_alpha": alpha,
        "reference_specification": training_specification(config, position),
        "candidate_specification": training_specification(candidate_config, position), "comparisons": []}
    output.parent.mkdir(parents=True, exist_ok=True)
    for season in sorted(set(seasons)):
        train = data.season.between(2018, season-1)
        test = data.season.eq(season) & data.week.between(1, 17 if season < 2021 else 18)
        if not train.any() or not test.any():
            raise ValueError(f"Missing train/test rows for {position} {season}")
        X_ref = prepare_feature_matrix(frame.loc[train], position, feature_cols_override=cols)
        y = data.loc[train, "Fpts"]
        reference_digest = feature_digest(X_ref, y)
        cache_key = hashlib.sha256(json.dumps([reference_digest, report["reference_specification"], subsets], sort_keys=True).encode()).hexdigest()
        cached = checkpoint_dir / f"{position}_{season}_{cache_key}.joblib" if checkpoint_dir else None
        if reference_dir and season == 2025:
            models = _load_reference(reference_dir, position, cols, X_ref, y, config, season-1)
        elif cached and cached.exists():
            models = joblib.load(cached)
        else:
            models = train_quantile_models(X_ref, y.to_numpy(), training_config=config,
                                           position=position, feature_cols_by_alpha=subsets)
            if cached:
                cached.parent.mkdir(parents=True, exist_ok=True)
                joblib.dump(models, cached)
        candidate_X = prepare_feature_matrix(enriched.loc[train], position, feature_cols_override=candidate_cols)
        fitted = train_quantile_models(candidate_X, y.to_numpy(), quantiles=(alpha,),
                                       training_config=candidate_config, position=position)
        candidate_models = {**models, alpha: fitted[alpha]}
        X_test = prepare_feature_matrix(enriched.loc[test], position, feature_cols_override=union_cols)
        reference, candidate = predict_quantiles(models, X_test), predict_quantiles(candidate_models, X_test)
        if candidate_name == "game_market_p50":
            unavailable = missing_market(enriched.loc[test])
            candidate.loc[unavailable, "q50"] = reference.loc[unavailable, "q50"]
            candidate = repair_quantile_order(candidate)
        comparison = {"season": season, "train_seasons": sorted(data.loc[train, "season"].unique().tolist()),
            "reference_training_digest": feature_digest(X_ref, y),
            "candidate_training_digest": feature_digest(candidate_X, y),
            "union_training_digest": feature_digest(prepare_feature_matrix(enriched.loc[train], position,
                                                     feature_cols_override=union_cols), y),
            "input_quality": feature_completeness(enriched.loc[test], candidate_cols),
            "cohorts": _cohorts(data.loc[test], reference, candidate, position)}
        report["comparisons"].append(comparison)
        report["diagnostic_gate"] = diagnostic_gate(report["comparisons"])
        report["union_feature_cols"] = union_cols
        saved = data.loc[test, ["player_id", "season", "week", "position", "team", "Fpts"]].copy()
        saved["actionable"] = actionable_mask(data.loc[test], reference)
        for name, predictions in (("reference", reference), ("candidate", candidate)):
            for col in ("q10", "q50", "q90"):
                saved[f"{name}_{col}"] = predictions[col]
        saved.to_parquet(output.with_name(f"{output.stem}_{season}_rows.parquet"), index=False)
        output.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8", newline="\n")
        pair = comparison["cohorts"]["actionable"]
        print(position, candidate_name, season, "actionable MAE", round(pair['reference']['mae'], 3),
              "->", round(pair['candidate']['mae'], 3), "WIS", round(pair['reference']['weighted_interval_score'], 3),
              "->", round(pair['candidate']['weighted_interval_score'], 3), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position", choices=("qb", "rb", "wr"), required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--schedules", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--candidate", choices=CANDIDATES, required=True)
    parser.add_argument("--seasons", type=int, nargs="+", default=list(GATE_SEASONS)+[2025])
    parser.add_argument("--reference-dir", type=Path, help="Optional verified through-2024 reference models for 2025 only")
    parser.add_argument("--checkpoint-dir", type=Path, help="Local research cache keyed by training matrix and effective fit parameters")
    parser.add_argument("--gate-output", type=Path, help="Freeze exact-data training evidence only if all market qualification checks pass")
    args = parser.parse_args()
    report = evaluate(args.position, args.data_dir, args.schedules, args.output, args.candidate, args.seasons, args.reference_dir, args.checkpoint_dir)
    if args.gate_output:
        evidence = publication_evidence(report)
        args.gate_output.parent.mkdir(parents=True, exist_ok=True)
        args.gate_output.write_text(json.dumps(evidence, indent=2, allow_nan=False)+"\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
