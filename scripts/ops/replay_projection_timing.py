"""Compare inference timing on identical held-out player-games.

Uses fixed bundles, no current roster/injury feeds, and prior-game matchup EPA.
This diagnoses input timing; it is not a gate for a newly trained model head.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import mean_pinball_loss

from src.core.features import feature_completeness, prepare_feature_matrix
from src.core.projection_context import build_projection_roster
from src.ml.quantile import interval_coverage, predict_quantiles
from src.pipeline.backtest import compute_metrics, lag_legacy_matchup_epa, top_n_accuracy
from src.projections.predict import load_model


def replay(position: str, data_dir: Path, model_dir: Path, test_season: int, train_through: int) -> dict:
    if test_season <= train_through:
        raise ValueError("Test season must be later than the bundle's training cutoff")
    data = pd.read_parquet(data_dir / f"{position}_mlready.parquet")
    bundle = load_model(position, model_dir)
    frames = []
    quality = []
    safe_matchups = lag_legacy_matchup_epa(data)
    for week in sorted(data.loc[data.season.eq(test_season) & data.week.le(18), "week"].unique()):
        actual = data[data.season.eq(test_season) & data.week.eq(week)].copy()
        old_history = data[data.season.eq(test_season) & data.week.lt(week)]
        if old_history.empty:
            old_history = data[data.season.eq(test_season - 1)]
        old = old_history.sort_values(["player_id", "week"]).groupby("player_id").tail(1).set_index("player_id")
        new = build_projection_roster(data, test_season, int(week)).set_index("player_id")
        # Same players, including observed played zeros; no outcome-based selection.
        actual = actual[actual.player_id.isin(old.index) & actual.player_id.isin(new.index)]
        if actual.empty:
            continue
        ids = actual.player_id
        matchup = safe_matchups[safe_matchups.season.eq(test_season) & safe_matchups.week.eq(week)].set_index("player_id")
        result = actual[["player_id", "season", "week", "Fpts"]].reset_index(drop=True)
        for label, profiles in (("before", old), ("after", new)):
            features = profiles.loc[ids].reset_index(drop=True)
            for col in ("opponent_pass_epa_allowed", "opponent_rush_epa_allowed"):
                if col in matchup:
                    features[col] = matchup.loc[ids, col].values
            if label == "after":
                for col in ("is_home", "days_rest"):
                    if col in actual:
                        features[col] = actual[col].values
            quality.append(feature_completeness(features, bundle["feature_cols"]))
            q = predict_quantiles(bundle["quantile_models"], prepare_feature_matrix(
                features, position, feature_cols_override=bundle["feature_cols"]))
            for quantile in ("q10", "q50", "q90"):
                result[f"{label}_{quantile}"] = q[quantile].values
        frames.append(result)
    results = pd.concat(frames, ignore_index=True)
    report = {"position": position, "test_season": test_season,
              "declared_bundle_train_through": train_through, "cohort": "same observed player-games; played zeros included",
              "rows": len(results), "incomplete_inputs": any(not q["complete"] for q in quality),
              "missing_model_features": sorted({c for q in quality for c in q["missing_columns"]}),
              "limitation": "Fixed legacy bundles may have learned same-game EPA leakage; matchup inputs are lagged for both sides. Not a model promotion gate."}
    for label in ("before", "after"):
        report[label] = compute_metrics(results.Fpts, results[f"{label}_q50"])
        report[label]["top12_overlap"] = top_n_accuracy(results, f"{label}_q50")
        report[label]["coverage_p10_p90"] = interval_coverage(results.Fpts, results[f"{label}_q10"], results[f"{label}_q90"])
        report[label]["pinball"] = {str(q): float(mean_pinball_loss(results.Fpts, results[f"{label}_q{int(q*100)}"], alpha=q)) for q in (.1, .5, .9)}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--test-season", type=int, required=True)
    parser.add_argument("--bundle-train-through", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = {}
    for pos in ("qb", "rb", "wr"):
        report[pos] = replay(pos, args.data_dir, args.model_dir, args.test_season, args.bundle_train_through)
        print(f"Finished {pos.upper()}: {report[pos]['rows']} held-out player-games", flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
