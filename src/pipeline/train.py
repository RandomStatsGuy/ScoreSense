"""Train position-specific fantasy projection models with quantile intervals."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split

from src.config import (
    DEFAULT_TRAIN_SEASONS,
    MODEL_DIR,
    PREDICTION_QUANTILES,
    PROCESSED_DATA_DIR,
    RB_CALIBRATED_MODEL_BUNDLE,
    WR_CALIBRATED_MODEL_BUNDLE,
)
from src.core.features import get_position_features, prepare_feature_matrix
from src.ml.quantile import interval_coverage, predict_quantiles, train_quantile_models
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
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    model_dir = model_dir or MODEL_DIR
    train_seasons = train_seasons or DEFAULT_TRAIN_SEASONS
    cfg = training_config or DEFAULT_TRAINING_CONFIG

    df = load_training_data(position, data_dir)
    train_df = df[df["season"].isin(train_seasons)].copy()
    train_df = train_df[train_df["Fpts"] > 0]

    spec = get_position_features(position)
    X = prepare_feature_matrix(train_df, position)
    y = train_df["Fpts"].values

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.15, random_state=42
    )

    quantile_models = train_quantile_models(
        X_train,
        y_train,
        PREDICTION_QUANTILES,
        training_config=cfg,
        position=position,
    )
    val_preds = predict_quantiles(quantile_models, X_val)

    metrics = {
        "position": position,
        "training_config": cfg.name,
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
        "feature_cols": list(spec.feature_cols),
        "train_seasons": train_seasons,
        "quantiles": list(PREDICTION_QUANTILES),
    }

    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / (model_filename or f"{position}_model.joblib")
    metrics_path = model_dir / (metrics_filename or f"{position}_metrics.json")

    joblib.dump(
        {
            "quantile_models": quantile_models,
            "feature_cols": list(spec.feature_cols),
            "position": position,
            "quantiles": list(PREDICTION_QUANTILES),
            "training_config": cfg.name,
        },
        model_path,
    )
    metrics_path.write_text(json.dumps(metrics, indent=2))

    print(
        f"Trained {position} ({cfg.name}): MAE={metrics['val_mae']:.3f}, "
        f"interval coverage={metrics['val_interval_coverage_p10_p90']:.1%} -> {model_path}"
    )
    return metrics


def train_wr_calibrated_model(
    data_dir: Path | None = None,
    train_seasons: list[int] | None = None,
    model_dir: Path | None = None,
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
    )


def train_rb_calibrated_model(
    data_dir: Path | None = None,
    train_seasons: list[int] | None = None,
    model_dir: Path | None = None,
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
    )


def train_all(
    data_dir: Path | None = None,
    model_dir: Path | None = None,
    train_seasons: list[int] | None = None,
) -> dict[str, dict]:
    results = {}
    for position in ("qb", "rb", "wr"):
        results[position] = train_position_model(
            position,
            data_dir=data_dir,
            train_seasons=train_seasons,
            model_dir=model_dir,
        )
    summary_path = (model_dir or MODEL_DIR) / "training_summary.json"
    summary_path.write_text(json.dumps(results, indent=2))
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
    args = parser.parse_args()

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
