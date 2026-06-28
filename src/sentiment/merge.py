"""Join sentiment features onto mlready frames for feature screening."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.config import PROCESSED_DATA_DIR, SENTIMENT_FEATURES_PATH
from src.sentiment.aggregate import FEATURE_COLUMNS, load_sentiment_features


def sentiment_feature_columns() -> list[str]:
    return [c for c in FEATURE_COLUMNS if c != "yt_top_snippet"]


def merge_sentiment_into_mlready(
    position: str,
    mlready_dir: Path | None = None,
    sentiment_path: Path | None = None,
) -> pd.DataFrame:
    mlready_dir = mlready_dir or PROCESSED_DATA_DIR
    sentiment_path = sentiment_path or SENTIMENT_FEATURES_PATH
    base_path = mlready_dir / f"{position}_mlready.parquet"
    if not base_path.exists():
        raise FileNotFoundError(f"Missing mlready file: {base_path}")

    base = pd.read_parquet(base_path)
    if not sentiment_path.exists():
        return base

    sentiment = load_sentiment_features(sentiment_path)
    if sentiment.empty:
        return base

    pos = position.upper()
    if pos == "WR":
        sentiment = sentiment[sentiment["position"].isin(["WR", "TE"])]
    else:
        sentiment = sentiment[sentiment["position"] == pos]

    merge_cols = [c for c in sentiment_feature_columns() if c not in base.columns]
    if not merge_cols:
        merge_cols = [c for c in sentiment_feature_columns() if c in sentiment.columns]

    numeric_cols = [c for c in merge_cols if c != "yt_top_snippet"]
    merged = base.merge(
        sentiment[["player_id", "season", "week", *merge_cols]],
        on=["player_id", "season", "week"],
        how="left",
    )
    for col in numeric_cols:
        if col in merged.columns:
            merged[col] = pd.to_numeric(merged[col], errors="coerce").fillna(0.0)
    if "yt_top_snippet" in merged.columns:
        merged["yt_top_snippet"] = merged["yt_top_snippet"].fillna("")
    return merged
