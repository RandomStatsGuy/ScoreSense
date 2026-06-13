"""Train position-specific fantasy projection models."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split

from src.config import (
    DEFAULT_TRAIN_SEASONS,
    MODEL_DIR,
    PROCESSED_DATA_DIR,
)
from src.features import get_position_features, prepare_feature_matrix


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
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    model_dir = model_dir or MODEL_DIR
    train_seasons = train_seasons or DEFAULT_TRAIN_SEASONS

    df = load_training_data(position, data_dir)
    train_df = df[df["season"].isin(train_seasons)].copy()
    train_df = train_df[train_df["Fpts"] > 0]

    spec = get_position_features(position)
    X = prepare_feature_matrix(train_df, position)
    y = train_df["Fpts"].values

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.15, random_state=42
    )

    model = GradientBoostingRegressor(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        random_state=42,
    )
    model.fit(X_train, y_train)

    val_pred = model.predict(X_val)
    metrics = {
        "position": position,
        "train_rows": int(len(X_train)),
        "val_rows": int(len(X_val)),
        "val_mae": float(mean_absolute_error(y_val, val_pred)),
        "val_rmse": float(np.sqrt(mean_squared_error(y_val, val_pred))),
        "feature_cols": list(spec.feature_cols),
        "train_seasons": train_seasons,
    }

    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / f"{position}_model.joblib"
    metrics_path = model_dir / f"{position}_metrics.json"

    joblib.dump(
        {
            "model": model,
            "feature_cols": list(spec.feature_cols),
            "position": position,
        },
        model_path,
    )
    metrics_path.write_text(json.dumps(metrics, indent=2))

    print(f"Trained {position}: MAE={metrics['val_mae']:.3f} -> {model_path}")
    return metrics


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
    args = parser.parse_args()

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
