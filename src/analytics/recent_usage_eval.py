"""Paired, pre-game-safe recent-usage gate; never writes production models."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_pinball_loss

from src.analytics.upside_eval import boom_recall
from src.core.features import TREND_DECIMAL_PLACES, feature_completeness, get_position_features, prepare_feature_matrix
from src.ml.quantile import interval_coverage, predict_quantiles, train_quantile_models, training_specification
from src.ml.training_config import DEFAULT_TRAINING_CONFIG, RB_P90_BOOM_WEIGHT_3, WR_P90_BOOM_WEIGHT_3
from src.pipeline.backtest import top_n_accuracy
from src.projections.temporal_inputs import PREGAME_POLICY, RECENT_POLICY, RECENT_POLICIES, RECENT_MEDIAN_POLICY, feature_digest, policy_feature_cols, training_inputs

GATE_SEASONS = tuple(range(2019, 2025))


def promotion_gate(comparisons: list[dict]) -> dict:
    by_season = {r["season"]: r for r in comparisons}
    required = [by_season[s] for s in GATE_SEASONS if s in by_season]
    deltas = [r["recent"]["composite"] - r["baseline"]["composite"] for r in required]
    boom_deltas = [r["recent"]["boom_recall"] - r["baseline"]["boom_recall"] for r in required]
    complete = len(required) == len(GATE_SEASONS)
    finite = bool(deltas) and bool(np.isfinite(deltas + boom_deltas).all())
    improved = sum(d < 0 for d in deltas)
    mean_delta = float(np.mean(deltas)) if deltas else None
    worst_boom = float(min(boom_deltas)) if boom_deltas else None
    passed = complete and finite and improved >= 4 and mean_delta < 0 and worst_boom >= -.02
    holdout = by_season.get(2025)
    holdout_delta = holdout["recent"]["composite"] - holdout["baseline"]["composite"] if holdout else None
    holdout_boom = holdout["recent"]["boom_recall"] - holdout["baseline"]["boom_recall"] if holdout else None
    holdout_passed = bool(holdout and np.isfinite([holdout_delta, holdout_boom]).all()
                          and holdout_delta < 0 and holdout_boom >= -.02)
    return {"passed": bool(passed), "required_seasons": list(GATE_SEASONS),
            "complete": complete, "seasons_improved": improved,
            "mean_composite_delta": mean_delta, "worst_boom_recall_delta": worst_boom,
            "holdout_2025_composite_delta": holdout_delta, "holdout_2025_boom_recall_delta": holdout_boom,
            "eligible_for_publication": bool(passed and holdout_passed)}


def _metrics(rows: pd.DataFrame, preds: pd.DataFrame, position: str) -> dict:
    scored = rows.assign(model_pred=preds.q50.to_numpy(), model_p10=preds.q10.to_numpy(), model_p90=preds.q90.to_numpy())
    mae = float(mean_absolute_error(scored.Fpts, scored.model_pred))
    recall = boom_recall(scored, position)
    return {"rows": len(scored), "mae": mae, "boom_recall": recall,
            "composite": .6 * (mae / 6.) + .4 * (1. - recall),
            "mean_bias": float((scored.model_pred - scored.Fpts).mean()),
            "top12_overlap": top_n_accuracy(scored, "model_pred"),
            "coverage_p10_p90": interval_coverage(scored.Fpts, scored.model_p10, scored.model_p90),
            "pinball": {str(q): float(mean_pinball_loss(scored.Fpts, preds[f'q{int(q*100)}'], alpha=q))
                        for q in (.1, .5, .9)}}


def evaluate_position(position: str, data_dir: Path, output: Path, seasons: list[int], candidate_policy: str = RECENT_POLICY) -> dict:
    source = data_dir / f"{position}_mlready.parquet"
    data = pd.read_parquet(source)
    data = data[data.Fpts.notna()].sort_values(["player_id", "season", "week"]).reset_index(drop=True)
    baseline = training_inputs(data, position, PREGAME_POLICY)
    recent = training_inputs(data, position, candidate_policy)
    cols = policy_feature_cols(position, list(get_position_features(position).feature_cols), PREGAME_POLICY)
    candidate_cols = policy_feature_cols(position, list(get_position_features(position).feature_cols), candidate_policy)
    config = {"qb": DEFAULT_TRAINING_CONFIG, "rb": RB_P90_BOOM_WEIGHT_3, "wr": WR_P90_BOOM_WEIGHT_3}[position]
    report = {"position": position, "candidate_policy": candidate_policy, "baseline_policy": PREGAME_POLICY,
              "source_sha256": {str(source): hashlib.sha256(source.read_bytes()).hexdigest()},
              "feature_precision": {"trend_decimal_places": TREND_DECIMAL_PLACES, "signed_zero": "positive"},
              "training_config": config.name, "training_specification": training_specification(config, position),
              "feature_cols": candidate_cols,
              "cohort": "All observed regular-season player-stat rows, including zero and negative scores; inactive roster weeks are not reconstructed.",
              "pregame_safe": True, "comparisons": []}
    for season in sorted(set(seasons)):
        train = data.season.lt(season)
        test = data.season.eq(season) & data.week.between(1, 17 if season < 2021 else 18)
        if not train.any() or not test.any():
            raise ValueError(f"Missing train or test rows for {position} {season}")
        comparison = {"season": season, "training_max_season": int(data.loc[train, 'season'].max())}
        baseline_models = None
        for label, frame, features in (("baseline", baseline, cols), ("recent", recent, candidate_cols)):
            X_train = prepare_feature_matrix(frame.loc[train], position, feature_cols_override=features)
            X_test = prepare_feature_matrix(frame.loc[test], position, feature_cols_override=features)
            # Keep compatibility imputation identical in the paired experiment.
            # Audits expose all missing columns instead of claiming full inputs.
            alphas = (.5,) if label == "recent" and candidate_policy == RECENT_MEDIAN_POLICY else (.1, .5, .9)
            models = train_quantile_models(X_train, data.loc[train, "Fpts"].to_numpy(), quantiles=alphas,
                                          training_config=config, position=position)
            if label == "baseline":
                baseline_models = models
            elif candidate_policy == RECENT_MEDIAN_POLICY:
                models = {**baseline_models, .5: models[.5]}
            comparison[label] = _metrics(data.loc[test], predict_quantiles(models, X_test), position)
            comparison[label]["input_quality"] = feature_completeness(frame.loc[test], features)
            if label == "recent" and season == 2025:
                report["training_through_2024_digest"] = feature_digest(X_train, data.loc[train, "Fpts"])
        report["comparisons"].append(comparison)
        report["gate"] = promotion_gate(report["comparisons"])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8", newline="\n")
        print(position, season, "MAE", round(comparison['baseline']['mae'], 3), "->", round(comparison['recent']['mae'], 3),
              "boom delta", round(comparison['recent']['boom_recall']-comparison['baseline']['boom_recall'], 4), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position", choices=("qb", "rb", "wr"), required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seasons", type=int, nargs="+", default=list(GATE_SEASONS) + [2025])
    parser.add_argument("--candidate-policy", choices=RECENT_POLICIES, default=RECENT_POLICY)
    args = parser.parse_args()
    evaluate_position(args.position, args.data_dir, args.output, args.seasons, args.candidate_policy)


if __name__ == "__main__":
    main()
