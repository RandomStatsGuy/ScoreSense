"""Train position-specific fantasy projection models with quantile intervals."""

from __future__ import annotations

import argparse
import json
from tempfile import TemporaryDirectory
from pathlib import Path
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

from src.config import (
    DEFAULT_TRAIN_SEASONS,
    MODEL_DIR,
    PROJECTION_MODEL_GATES_DIR,
    PREDICTION_QUANTILES,
    PROCESSED_DATA_DIR,
    RB_CALIBRATED_MODEL_BUNDLE,
    WR_CALIBRATED_MODEL_BUNDLE,
)
from src.core.features import get_position_features, prepare_feature_matrix
from src.projections.temporal_inputs import (
    INPUT_POLICIES, PREGAME_POLICY, RECENT_POLICIES, feature_digest, policy_feature_cols, quantile_feature_subsets, training_inputs,
)
from src.ml.quantile import interval_coverage, predict_quantiles, train_quantile_models, training_specification
from src.ml.training_config import (
    DEFAULT_TRAINING_CONFIG,
    RB_P90_BOOM_WEIGHT_3,
    WR_P90_BOOM_WEIGHT_3,
    TrainingConfig,
)


def load_training_data(position: str, data_dir: Path) -> pd.DataFrame:
    parquet = data_dir / f"{position}_mlready.parquet"
    csv_legacy = data_dir / f"{position}_mlready.csv"
    if parquet.exists():
        return pd.read_parquet(parquet)
    if csv_legacy.exists():
        return pd.read_csv(csv_legacy)
    raise FileNotFoundError(
        f"No training data for {position}. Run: python -m src.etl.nflverse_etl"
    )


def train_position_model(
    position: str,
    data_dir: Path | None = None,
    train_seasons: list[int] | None = None,
    model_dir: Path | None = None,
    training_config: TrainingConfig | None = None,
    model_filename: str | None = None,
    metrics_filename: str | None = None,
    input_policy: str = PREGAME_POLICY,
    gate_report: Path | None = None,
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    model_dir = model_dir or MODEL_DIR
    train_seasons = train_seasons or DEFAULT_TRAIN_SEASONS
    cfg = training_config or DEFAULT_TRAINING_CONFIG

    df = load_training_data(position, data_dir)
    # Transform full chronological history before selecting training seasons.
    # The transforms themselves exclude each game's own/future observations.
    df = training_inputs(df, position, input_policy)
    train_df = df[df["season"].isin(train_seasons) & df["Fpts"].notna()].copy()
    train_df = train_df.sort_values(["player_id", "season", "week"])

    spec = get_position_features(position)
    feature_cols = policy_feature_cols(position, list(spec.feature_cols), input_policy)
    absent = [c for c in feature_cols if c not in train_df or train_df[c].isna().all()]
    if absent:
        raise ValueError(f"Rebuild required {position} training inputs: {absent}")
    X = prepare_feature_matrix(train_df, position, feature_cols_override=feature_cols)
    y = train_df["Fpts"].values
    digest = feature_digest(X, train_df["Fpts"])
    if input_policy in RECENT_POLICIES:
        evidence = json.loads(gate_report.read_text()) if gate_report else {}
        if not (evidence.get("gate", {}).get("eligible_for_publication") and evidence.get("pregame_safe")
                and evidence.get("candidate_policy") == input_policy and evidence.get("position") == position
                and evidence.get("training_config") == cfg.name and evidence.get("feature_cols") == feature_cols
                and evidence.get("training_specification") == training_specification(cfg, position)
                and evidence.get("training_through_2024_digest") == digest):
            raise ValueError("Recent usage requires a passed gate matching this data, feature contract and training preset")
    train_mask, val_mask = chronological_validation_split(train_df)
    head_features = quantile_feature_subsets(position, feature_cols, input_policy)
    X_train, X_val = X.loc[train_mask], X.loc[val_mask]
    y_train, y_val = y[train_mask], y[val_mask]

    quantile_models = train_quantile_models(
        X_train,
        y_train,
        PREDICTION_QUANTILES,
        training_config=cfg,
        position=position,
        feature_cols_by_alpha=head_features,
    )
    val_preds = predict_quantiles(quantile_models, X_val)

    metrics = {
        "position": position,
        "training_config": cfg.name,
        "training_specification": training_specification(cfg, position),
        "train_rows": int(len(X_train)),
        "val_rows": int(len(X_val)),
        "val_mae": float(mean_absolute_error(y_val, val_preds["q50"])),
        "val_rmse": float(np.sqrt(mean_squared_error(y_val, val_preds["q50"]))),
        "val_interval_coverage_p10_p90": float(
            interval_coverage(
                pd.Series(y_val, index=X_val.index),
                val_preds["q10"],
                val_preds["q90"],
            )
        ),
        "feature_cols": feature_cols,
        "train_seasons": train_seasons,
        "quantiles": list(PREDICTION_QUANTILES),
        "input_policy": input_policy,
        "input_quality": X.attrs["input_quality"],
        "training_digest": digest,
        "validation_split": "latest_season_or_final_20_percent_of_weeks",
        "validation_min_season": int(train_df.loc[val_mask, "season"].min()),
        "fit_max_season_before_validation": int(train_df.loc[train_mask, "season"].max()),
        "zero_or_negative_rows": int(train_df.Fpts.le(0).sum()),
        "final_fit_rows": len(train_df),
    }

    # Validation is diagnostic; the published bundle uses every eligible earlier
    # game, rather than permanently discarding the validation season.
    quantile_models = train_quantile_models(X, y, PREDICTION_QUANTILES, training_config=cfg, position=position,
                                          feature_cols_by_alpha=head_features)

    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / (model_filename or f"{position}_model.joblib")
    metrics_path = model_dir / (metrics_filename or f"{position}_metrics.json")

    temporary = model_path.with_name(f"{model_path.name}.{uuid4().hex}.tmp")
    try:
        joblib.dump({
            "quantile_models": quantile_models,
            "feature_cols": feature_cols,
            "position": position,
            "quantiles": list(PREDICTION_QUANTILES),
            "training_config": cfg.name,
            "training_specification": metrics["training_specification"],
            "input_policy": input_policy,
            "feature_cols_by_alpha": head_features,
            "train_seasons": sorted(train_df.season.unique().astype(int).tolist()),
            "training_digest": digest,
            "input_quality": metrics["input_quality"],
        },
        temporary)
        temporary.replace(model_path)
    finally:
        temporary.unlink(missing_ok=True)
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8", newline="\n")

    print(
        f"Trained {position} ({cfg.name}): MAE={metrics['val_mae']:.3f}, "
        f"interval coverage={metrics['val_interval_coverage_p10_p90']:.1%} -> {model_path}"
    )
    return metrics


def chronological_validation_split(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Hold out complete later weeks, never random player rows from the same game."""
    if df.empty:
        raise ValueError("No eligible training games")
    years = sorted(df.season.unique())
    if len(years) > 1:
        val = df.season.eq(years[-1]).to_numpy()
    else:
        weeks = sorted(df.week.unique())
        if len(weeks) < 2:
            raise ValueError("Chronological validation needs at least two observed weeks")
        boundary = weeks[max(1, int(len(weeks) * .8))]
        val = df.week.ge(boundary).to_numpy()
    return ~val, val


def train_wr_calibrated_model(
    data_dir: Path | None = None,
    train_seasons: list[int] | None = None,
    model_dir: Path | None = None,
    **input_options,
) -> dict:
    """Train WR with P90 boom-weight calibration; writes wr_model_calibrated.joblib."""
    return train_position_model(
        "wr",
        data_dir=data_dir,
        train_seasons=train_seasons,
        model_dir=model_dir,
        training_config=WR_P90_BOOM_WEIGHT_3,
        model_filename=WR_CALIBRATED_MODEL_BUNDLE,
        metrics_filename="wr_calibrated_metrics.json",
        **input_options,
    )


def train_rb_calibrated_model(
    data_dir: Path | None = None,
    train_seasons: list[int] | None = None,
    model_dir: Path | None = None,
    **input_options,
) -> dict:
    """Train RB with P90 boom-weight calibration; writes rb_model_calibrated.joblib."""
    return train_position_model(
        "rb",
        data_dir=data_dir,
        train_seasons=train_seasons,
        model_dir=model_dir,
        training_config=RB_P90_BOOM_WEIGHT_3,
        model_filename=RB_CALIBRATED_MODEL_BUNDLE,
        metrics_filename="rb_calibrated_metrics.json",
        **input_options,
    )


def gated_training_options(position: str, data_dir: Path, train_seasons: list[int], cfg: TrainingConfig) -> dict:
    """Use the candidate only when its frozen gate exactly matches current inputs.

    Source revisions or feature-flag changes require a new evaluation. Revert to
    the safe baseline on mismatch rather than silently claiming stale evidence.
    """
    path = PROJECTION_MODEL_GATES_DIR / f"recent_usage_gate_{position}.json"
    if not path.exists():
        return {}
    evidence = json.loads(path.read_text())
    policy = evidence.get("candidate_policy")
    if not evidence.get("gate", {}).get("eligible_for_publication") or policy not in RECENT_POLICIES:
        return {}
    data = training_inputs(load_training_data(position, data_dir), position, policy)
    train = data[data.season.isin(train_seasons) & data.Fpts.notna()].sort_values(["player_id", "season", "week"])
    cols = policy_feature_cols(position, list(get_position_features(position).feature_cols), policy)
    X = prepare_feature_matrix(train, position, feature_cols_override=cols)
    matches = (evidence.get("pregame_safe") and evidence.get("position") == position
               and evidence.get("training_config") == cfg.name and evidence.get("feature_cols") == cols
               and evidence.get("training_specification") == training_specification(cfg, position)
               and evidence.get("training_through_2024_digest") == feature_digest(X, train.Fpts))
    if not matches:
        print(f"{position}: recent-usage evidence does not match current inputs; using {PREGAME_POLICY}")
        return {}
    return {"input_policy": policy, "gate_report": path}


def train_all(
    data_dir: Path | None = None,
    model_dir: Path | None = None,
    train_seasons: list[int] | None = None,
) -> dict[str, dict]:
    data_dir = data_dir or PROCESSED_DATA_DIR
    model_dir = model_dir or MODEL_DIR
    train_seasons = train_seasons or DEFAULT_TRAIN_SEASONS
    model_dir.mkdir(parents=True, exist_ok=True)
    results = {}
    # A source/fitting failure must not publish a partial new set of serving
    # models. Finish all fits first, then atomically replace each complete bundle.
    with TemporaryDirectory(prefix=".training-", dir=model_dir) as temporary:
        stage = Path(temporary)
        for position in ("qb", "rb", "wr"):
            options = gated_training_options(position, data_dir, train_seasons, DEFAULT_TRAINING_CONFIG) if position == "qb" else {}
            results[position] = train_position_model(position, data_dir=data_dir,
                train_seasons=train_seasons, model_dir=stage, **options)
        # The router serves the calibrated RB/WR bundles, not their baseline files.
        results["rb_calibrated"] = train_rb_calibrated_model(data_dir, train_seasons, stage,
            **gated_training_options("rb", data_dir, train_seasons, RB_P90_BOOM_WEIGHT_3))
        results["wr_calibrated"] = train_wr_calibrated_model(data_dir, train_seasons, stage,
            **gated_training_options("wr", data_dir, train_seasons, WR_P90_BOOM_WEIGHT_3))
        (stage / "training_summary.json").write_text(json.dumps(results, indent=2), encoding="utf-8", newline="\n")
        for artifact in stage.iterdir():
            artifact.replace(model_dir / artifact.name)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ScoreSense models")
    parser.add_argument(
        "--position",
        choices=["qb", "rb", "wr", "all"],
        default="all",
    )
    parser.add_argument("--data-dir", type=Path, default=PROCESSED_DATA_DIR)
    parser.add_argument("--model-dir", type=Path, default=MODEL_DIR)
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=DEFAULT_TRAIN_SEASONS,
    )
    parser.add_argument(
        "--calibrated",
        action="store_true",
        help="Train P90-calibrated bundle (wr or rb only)",
    )
    parser.add_argument("--input-policy", choices=INPUT_POLICIES, default=PREGAME_POLICY)
    parser.add_argument("--gate-report", type=Path, help="Exact-data gate evidence required for the recent-usage candidate")
    args = parser.parse_args()
    if args.input_policy in RECENT_POLICIES:
        if args.position == "all":
            parser.error("Recent-usage promotion requires an individual position and its matching gate report")
        cfg = {"rb": RB_P90_BOOM_WEIGHT_3, "wr": WR_P90_BOOM_WEIGHT_3}.get(args.position, DEFAULT_TRAINING_CONFIG) if args.calibrated else DEFAULT_TRAINING_CONFIG
        train_position_model(args.position, args.data_dir, args.seasons, args.model_dir, training_config=cfg,
                             model_filename=({"rb": RB_CALIBRATED_MODEL_BUNDLE, "wr": WR_CALIBRATED_MODEL_BUNDLE}.get(args.position) if args.calibrated else None),
                             metrics_filename=(f"{args.position}_calibrated_metrics.json" if args.calibrated else None),
                             input_policy=args.input_policy, gate_report=args.gate_report)
        return

    if args.calibrated:
        if args.position == "wr":
            train_wr_calibrated_model(args.data_dir, args.seasons, args.model_dir)
        elif args.position == "rb":
            train_rb_calibrated_model(args.data_dir, args.seasons, args.model_dir)
        elif args.position == "all":
            train_wr_calibrated_model(args.data_dir, args.seasons, args.model_dir)
            train_rb_calibrated_model(args.data_dir, args.seasons, args.model_dir)
            train_position_model("qb", data_dir=args.data_dir, train_seasons=args.seasons, model_dir=args.model_dir)
        else:
            parser.error("--calibrated applies to wr or rb only")
        return

    if args.position == "all":
        train_all(args.data_dir, args.model_dir, args.seasons)
    else:
        train_position_model(
            args.position,
            data_dir=args.data_dir,
            train_seasons=args.seasons,
            model_dir=args.model_dir,
        )


if __name__ == "__main__":
    main()
