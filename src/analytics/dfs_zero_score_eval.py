"""Research-only zero-score classification for observed WR/TE stat rows.

This experiment does not estimate participation or an unconditional DFS zero
probability. Missing player weeks are not reconstructed. It never changes a
serving model, point forecast, tail forecast or production qualification gate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pickle
import platform
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from src.analytics.role_features import attach_position
from src.projections.temporal_inputs import feature_digest, recent_feature_cols, recent_usage_frame

VERSION = "observed_wr_te_zero_score_logistic_v1"
SEED = 20261013
FEATURE_COLS = (*recent_feature_cols("wr"), "is_tight_end")
BUCKETS = ("unknown_prior_targets", "targets_at_most_2", "targets_over_2_to_6", "targets_over_6")
BUCKET_PRIOR_STRENGTH = 4.0
CONDITIONING = "Conditional on inclusion in observed regular-season player-stat rows; missing player weeks are not reconstructed."


def prepare_research_rows(history: pd.DataFrame) -> pd.DataFrame:
    """Build strictly prior observed-game features, retaining played zero scores."""
    required = {"player_id", "position", "season", "week", "Fpts"}
    missing = required - set(history)
    if missing:
        raise ValueError(f"Missing research identity/outcome columns: {sorted(missing)}")
    rows = history.copy()
    if rows.empty or not rows.player_id.map(lambda value: isinstance(value, str) and bool(value.strip())).all():
        raise ValueError("Research rows require nonempty canonical player IDs")
    for col in ("season", "week"):
        values = pd.to_numeric(rows[col], errors="coerce")
        array = values.to_numpy(dtype=float, na_value=np.nan)
        if rows[col].map(lambda value: isinstance(value, (bool, np.bool_))).any() or not np.isfinite(array).all() or not np.equal(array, np.floor(array)).all():
            raise ValueError(f"Research {col} must contain finite integer identities")
        lower, upper = (2000, 2200) if col == "season" else (1, 30)
        if not values.between(lower, upper).all():
            raise ValueError("Research season/week is outside the supported range")
        rows[col] = values.astype(int)
    if rows.duplicated(["player_id", "season", "week"]).any():
        raise ValueError("Research requires unique player/season/week identities")
    actual = pd.to_numeric(rows.Fpts, errors="coerce")
    if rows.Fpts.map(lambda value: isinstance(value, (bool, np.bool_))).any() or not np.isfinite(actual.to_numpy(dtype=float, na_value=np.nan)).all():
        raise ValueError("Research outcomes must be finite observed scores")
    rows["Fpts"] = actual.astype(float)
    rows["position"] = rows.position.astype(str).str.upper()
    rows = attach_position(rows)
    regular = rows.week.le(np.where(rows.season.lt(2021), 17, 18))
    rows = rows.loc[regular & rows.season.ge(2018)].sort_values(["player_id", "season", "week"]).reset_index(drop=True)
    if rows.empty:
        raise ValueError("No observed regular-season rows since 2018")
    rows = recent_usage_frame(rows, "wr", season_bounded=True)
    for col in FEATURE_COLS:
        if np.isinf(rows[col].to_numpy(dtype=float, na_value=np.nan)).any():
            raise ValueError("Research features cannot contain infinite values")
    rows["usage_bucket"] = usage_buckets(rows)
    rows["is_zero"] = rows.Fpts.eq(0).astype(int)
    return rows


def usage_buckets(rows: pd.DataFrame) -> pd.Series:
    """Predeclared prior-target groups; never target-game targets or salaries."""
    targets = rows["recent4_targets_avg"]
    return pd.Series(np.select(
        [targets.isna(), targets.le(2), targets.le(6)],
        list(BUCKETS[:3]), default=BUCKETS[3]), index=rows.index)


def make_classifier() -> Pipeline:
    """All fitted preprocessing belongs exclusively to a fold's earlier seasons."""
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)),
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(C=1.0, class_weight=None, solver="lbfgs", max_iter=2000, random_state=SEED)),
    ])


def prevalence_baselines(train: pd.DataFrame, test: pd.DataFrame) -> dict[str, np.ndarray]:
    """Training-only Beta(1,1) global and four-observation pooled bucket priors."""
    global_probability = float((train.is_zero.sum() + 1) / (len(train) + 2))
    probabilities = {}
    for bucket in BUCKETS:
        group = train.loc[train.usage_bucket.eq(bucket), "is_zero"]
        probabilities[bucket] = float((group.sum() + BUCKET_PRIOR_STRENGTH * global_probability) / (len(group) + BUCKET_PRIOR_STRENGTH))
    return {
        "training_global_prevalence": np.full(len(test), global_probability),
        "training_usage_prevalence": test.usage_bucket.map(probabilities).to_numpy(dtype=float),
    }


def probability_metrics(actual: np.ndarray, probabilities: np.ndarray) -> dict:
    actual = np.asarray(actual)
    probabilities = np.asarray(probabilities, dtype=float)
    if len(actual) != len(probabilities) or not len(actual) or not np.isin(actual, [0, 1]).all() or not np.isfinite(probabilities).all() or ((probabilities < 0) | (probabilities > 1)).any():
        raise ValueError("Probability metrics require matching binary events and finite probabilities in [0,1]")
    bins = np.minimum((probabilities * 10).astype(int), 9)
    reliability = []
    for bucket in range(10):
        selected = bins == bucket
        reliability.append({"lower": bucket / 10, "upper": (bucket + 1) / 10, "n": int(selected.sum()),
            "predicted_probability": float(probabilities[selected].mean()) if selected.any() else None,
            "observed_frequency": float(actual[selected].mean()) if selected.any() else None})
    return {"rows": len(actual), "zeros": int(actual.sum()), "observed_frequency": float(actual.mean()),
        "mean_probability": float(probabilities.mean()), "brier_score": float(brier_score_loss(actual, probabilities)),
        "log_loss": float(log_loss(actual, probabilities, labels=[0, 1])), "reliability": reliability}


def _losses(actual: np.ndarray, probabilities: np.ndarray, metric: str) -> np.ndarray:
    if metric == "brier_score":
        return np.square(probabilities - actual)
    clipped = np.clip(probabilities, np.finfo(float).eps, 1 - np.finfo(float).eps)
    return -(actual * np.log(clipped) + (1 - actual) * np.log1p(-clipped))


def paired_probability_interval(rows: pd.DataFrame, candidate: np.ndarray, baseline: np.ndarray, *, metric: str, repeats: int = 2000) -> dict:
    """Paired proper-score differences; resample whole season/week blocks."""
    if metric not in ("brier_score", "log_loss") or type(repeats) is not int or not 1 <= repeats <= 10000:
        raise ValueError("Declare Brier/log loss and between 1 and 10,000 block resamples")
    actual = rows.is_zero.to_numpy(dtype=int)
    probability_metrics(actual, candidate)
    probability_metrics(actual, baseline)
    delta = _losses(actual, np.asarray(candidate), metric) - _losses(actual, np.asarray(baseline), metric)
    blocks = rows[["season", "week"]].assign(delta=delta).groupby(["season", "week"]).delta.agg(["sum", "count"]).to_numpy()
    interval = None
    if len(blocks) >= 2:
        rng = np.random.default_rng(SEED)
        samples = blocks[rng.integers(0, len(blocks), size=(repeats, len(blocks)))]
        sampled = samples[:, :, 0].sum(axis=1) / samples[:, :, 1].sum(axis=1)
        interval = np.quantile(sampled, [.025, .975]).tolist()
    return {"metric": metric, "mean_delta": float(delta.mean()), "rows": len(rows), "week_blocks": len(blocks),
        "ci95": interval, "bootstrap_repeats": repeats if interval is not None else 0,
        "direction": "negative favors the classifier"}


def _cohort_results(rows: pd.DataFrame, predictions: dict[str, np.ndarray], repeats: int) -> dict:
    masks = {"all_observed": np.ones(len(rows), dtype=bool),
        "known_low_usage": rows.usage_bucket.eq(BUCKETS[1]).to_numpy(),
        "unknown_prior_usage": rows.usage_bucket.eq(BUCKETS[0]).to_numpy(),
        "known_medium_usage": rows.usage_bucket.eq(BUCKETS[2]).to_numpy(),
        "known_high_usage": rows.usage_bucket.eq(BUCKETS[3]).to_numpy(),
        "no_prior_scoring_history": rows.recent4_Fpts_avg.isna().to_numpy(),
        "position_wr": rows.position.eq("WR").to_numpy(), "position_te": rows.position.eq("TE").to_numpy()}
    result = {}
    for name, mask in masks.items():
        selected = rows.loc[mask]
        if selected.empty:
            result[name] = {"rows": 0, "metrics": None, "paired_classifier_minus_baseline": None}
            continue
        selected_predictions = {key: values[mask] for key, values in predictions.items()}
        result[name] = {"rows": len(selected), "metrics": {
            key: probability_metrics(selected.is_zero.to_numpy(), values) for key, values in selected_predictions.items()},
            "paired_classifier_minus_baseline": {baseline: {
                metric: paired_probability_interval(selected, selected_predictions["classifier"], values, metric=metric, repeats=repeats)
                for metric in ("brier_score", "log_loss")}
                for baseline, values in selected_predictions.items() if baseline != "classifier"}}
    return result


def evaluate(history: pd.DataFrame, *, seasons: list[int], bootstrap_repeats: int = 2000) -> tuple[dict, pd.DataFrame]:
    """Walk forward without fitting or publishing any existing forecast head."""
    if not seasons or any(type(s) is not int or s < 2019 for s in seasons) or len(set(seasons)) != len(seasons):
        raise ValueError("Declare unique evaluation seasons from 2019 onward")
    if type(bootstrap_repeats) is not int or not 1 <= bootstrap_repeats <= 10000:
        raise ValueError("Bootstrap repetitions must be between 1 and 10,000")
    rows = prepare_research_rows(history)
    report = {"schema_version": VERSION, "conditioning": CONDITIONING,
        "event": "Exactly zero PPR fantasy points in an observed player-stat row; negative scores are nonzero.",
        "source_scoring": "Existing Fpts training target; not verified official DraftKings/FanDuel scoring.",
        "serving_changed": False, "production_eligible": False, "fitted_models_saved": False,
        "training_start_season": 2018, "feature_cols": list(FEATURE_COLS),
        "feature_policy": "Current-season prior four observed games; earlier-season observations at the opener; no target/future game inputs.",
        "usage_buckets": {BUCKETS[0]: "No prior observed target count", BUCKETS[1]: "Prior-four-game mean targets <= 2",
            BUCKETS[2]: "Prior-four-game mean targets > 2 and <= 6", BUCKETS[3]: "Prior-four-game mean targets > 6"},
        "specification": {"sklearn_version": sklearn.__version__, "numpy_version": np.__version__,
            "pandas_version": pd.__version__, "python_version": platform.python_version(), "random_seed": SEED,
            "preprocessing": "Train-only median imputation with missing indicators and retained empty columns, then standard scaling",
            "classifier": make_classifier().named_steps["classifier"].get_params(),
            "baselines": {"global": "Training-only Beta(1,1) zero-score prevalence", "usage": "Training-only prior-target bucket prevalence pooled toward global with strength 4"},
            "reliability_bins": "Ten fixed equal-width bins; final bin includes probability one", "bootstrap_repeats": bootstrap_repeats},
        "limitations": [CONDITIONING,
            "This classifier cannot estimate nonparticipation, inactive weeks, zero-snap active weeks absent from the source, or no-history roster estimates.",
            "Historical source revisions and cohort shifts can change apparent event rates; inspect source parity before interpreting scores.",
            "2025 has already been explored and is an exploratory later-season check, not an untouched holdout.",
            "No current injuries, salary-based cohorts, implied quantile probabilities, forecast calibration, model routing or profitability claim."],
        "folds": []}
    saved_rows = []
    for season in sorted(seasons):
        train = rows.loc[rows.season.lt(season)]
        test = rows.loc[rows.season.eq(season)]
        if train.empty or test.empty:
            raise ValueError(f"Missing earlier training or evaluation rows for {season}")
        if train.is_zero.nunique() != 2:
            raise ValueError(f"Both zero and nonzero earlier training outcomes are required for {season}")
        X_train, X_test = train.loc[:, list(FEATURE_COLS)], test.loc[:, list(FEATURE_COLS)]
        model = make_classifier()
        model.fit(X_train, train.is_zero)
        if int(model.named_steps["classifier"].n_iter_.max()) >= 2000:
            raise ValueError(f"Classifier did not converge for {season}")
        predictions = {"classifier": model.predict_proba(X_test)[:, 1], **prevalence_baselines(train, test)}
        fold = {"season": season, "train_seasons": sorted(train.season.unique().tolist()), "training_max_season": int(train.season.max()),
            "training_last_context": [int(train.season.max()), int(train.loc[train.season.eq(train.season.max()), "week"].max())],
            "training_rows": len(train), "training_zeros": int(train.is_zero.sum()), "test_rows": len(test), "test_zeros": int(test.is_zero.sum()),
            "training_matrix_and_labels_sha256": feature_digest(X_train, train.is_zero),
            "fitted_pipeline_sha256": hashlib.sha256(pickle.dumps(model, protocol=5)).hexdigest(),
            "input_missing_counts": {c: int(test[c].isna().sum()) for c in FEATURE_COLS},
            "cohorts": _cohort_results(test, predictions, bootstrap_repeats)}
        report["folds"].append(fold)
        saved = test[["player_id", "position", "season", "week", "Fpts", "is_zero", "usage_bucket", *FEATURE_COLS]].copy()
        for name, probabilities in predictions.items():
            saved[f"probability_{name}"] = probabilities
        saved_rows.append(saved)
    combined = pd.concat(saved_rows, ignore_index=True)
    report["pooled_cohorts"] = _cohort_results(combined, {
        name: combined[f"probability_{name}"].to_numpy() for name in ("classifier", "training_global_prevalence", "training_usage_prevalence")}, bootstrap_repeats)
    report["decision"] = "Research diagnostics only; no model promotion or serving zero-score probability."
    return report, combined


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="Read-only consistent WR/TE mlready parquet")
    parser.add_argument("--seasons", type=int, nargs="+", default=list(range(2019, 2026)))
    parser.add_argument("--bootstrap-repeats", type=int, default=2000)
    parser.add_argument("--output", type=Path, required=True, help="Isolated research JSON; row forecasts are saved alongside")
    args = parser.parse_args()
    if args.output.resolve() == args.data.resolve() or args.output.with_suffix(".rows.parquet").resolve() == args.data.resolve():
        parser.error("Research outputs cannot overwrite the input snapshot")
    report, rows = evaluate(pd.read_parquet(args.data), seasons=args.seasons, bootstrap_repeats=args.bootstrap_repeats)
    from src.analytics import role_features
    from src.projections import temporal_inputs
    sources = [args.data, Path(__file__), Path(role_features.__file__), Path(temporal_inputs.__file__)]
    report["source_sha256"] = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    row_path = args.output.with_suffix(".rows.parquet")
    rows.to_parquet(row_path, index=False)
    report["row_forecasts"] = {"path": str(row_path), "sha256": hashlib.sha256(row_path.read_bytes()).hexdigest(), "rows": len(rows)}
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8", newline="\n")
    for fold in report["folds"]:
        metrics = fold["cohorts"]["all_observed"]["metrics"]
        print(f"{fold['season']}: observed rows={fold['test_rows']}, zeros={fold['test_zeros']}; Brier classifier={metrics['classifier']['brier_score']:.6f}, global={metrics['training_global_prevalence']['brier_score']:.6f}, usage={metrics['training_usage_prevalence']['brier_score']:.6f}")
    print(CONDITIONING)
    print(report["decision"])


if __name__ == "__main__":
    main()
