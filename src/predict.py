"""Unified prediction interface for training and inference."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import joblib
import pandas as pd

from src.config import MODEL_DIR, PREDICTIONS_DIR, PROCESSED_DATA_DIR
from src.features import get_position_features, prepare_feature_matrix


def load_model(position: str, model_dir: Path | None = None) -> dict:
    model_dir = model_dir or MODEL_DIR
    path = model_dir / f"{position}_model.joblib"
    if not path.exists():
        raise FileNotFoundError(
            f"Model not found for {position}. Run: python -m src.train --position {position}"
        )
    return joblib.load(path)


def predict_from_features(
    df: pd.DataFrame,
    position: str,
    model_dir: Path | None = None,
) -> pd.DataFrame:
    bundle = load_model(position, model_dir)
    model = bundle["model"]
    X = prepare_feature_matrix(df, position)
    preds = model.predict(X)

    name_col = "player_display_name" if "player_display_name" in df.columns else "player_name"
    if name_col not in df.columns:
        name_col = "player"

    result = pd.DataFrame(
        {
            "Player": df[name_col].values,
            "Projected Points": preds,
        }
    )
    if "team" in df.columns:
        result["Team"] = df["team"].values
    if "opponent" in df.columns:
        result["Opponent"] = df["opponent"].values
    if "week" in df.columns:
        result["Week"] = df["week"].values
    if "season" in df.columns:
        result["Season"] = df["season"].values

    return result.sort_values("Projected Points", ascending=False).reset_index(drop=True)


def predict_upcoming_week(
    position: str,
    season: int | None = None,
    week: int | None = None,
    data_dir: Path | None = None,
    model_dir: Path | None = None,
) -> pd.DataFrame:
    """Predict fantasy points for the next week using latest processed data."""
    data_dir = data_dir or PROCESSED_DATA_DIR
    path = data_dir / f"{position}_mlready.parquet"
    if not path.exists():
        path = data_dir / f"{position}_mlready.csv"
    df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)

    if season is None:
        season = int(df["season"].max())
    if week is None:
        week = int(df[df["season"] == season]["week"].max()) + 1

    subset = df[(df["season"] == season) & (df["week"] == week - 1)].copy()
    if subset.empty:
        subset = df[df["season"] == season].copy()
        subset = (
            subset.sort_values(["player_id", "week"])
            .groupby("player_id", as_index=False)
            .tail(1)
        )
        subset["week"] = week

    return predict_from_features(subset, position, model_dir)


def save_predictions(
    predictions: pd.DataFrame,
    position: str,
    output_dir: Path | None = None,
) -> Path:
    output_dir = output_dir or PREDICTIONS_DIR
    label = {"qb": "QB", "rb": "RB", "wr": "REC"}.get(position, position.upper())
    out_subdir = output_dir / label
    out_subdir.mkdir(parents=True, exist_ok=True)

    date = datetime.now()
    d_string = f"{date.month}{date.day}{date.year}_"
    out_path = out_subdir / f"{d_string}{label}DataPreds.csv"
    predictions.to_csv(out_path, index=False)
    return out_path


def predict_all_positions(
    season: int | None = None,
    week: int | None = None,
) -> dict[str, pd.DataFrame]:
    results = {}
    for position in ("qb", "rb", "wr"):
        preds = predict_upcoming_week(position, season=season, week=week)
        save_predictions(preds, position)
        results[position] = preds
    return results


def get_model_metrics(model_dir: Path | None = None) -> dict:
    model_dir = model_dir or MODEL_DIR
    summary = {}
    for path in model_dir.glob("*_metrics.json"):
        summary[path.stem.replace("_metrics", "")] = json.loads(path.read_text())
    return summary
