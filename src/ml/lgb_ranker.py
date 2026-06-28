"""LightGBM lambdarank P50 head (experimental — walk-forward only)."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from src.ml.ranking_groups import build_relevance_labels, prepare_ranking_frame

DEFAULT_LGB_RANK_PARAMS: dict[str, Any] = {
    "objective": "lambdarank",
    "metric": "ndcg",
    "n_estimators": 200,
    "learning_rate": 0.05,
    "num_leaves": 31,
    "max_depth": 4,
    "min_child_samples": 10,
    "lambdarank_truncation_level": 50,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "random_state": 42,
    "verbose": -1,
}


def build_lgb_ranker(**overrides: Any):
    import lightgbm as lgb

    params = {**DEFAULT_LGB_RANK_PARAMS, **overrides}
    return lgb.LGBMRanker(**params)


def train_p50_ranker(
    X: pd.DataFrame,
    y: np.ndarray,
    group: list[int],
    *,
    relevance_method: str = "fpts_tiers",
    relevance_n_tiers: int = 30,
    eval_at: list[int] | None = None,
    **overrides: Any,
):
    """Train list-wise P50 ranker; ``group`` is consecutive weekly slate sizes."""
    fit_eval_at = overrides.pop("eval_at", eval_at or [50])
    relevance = build_relevance_labels(
        y,
        group,
        max_relevance=relevance_n_tiers,
        method=relevance_method,
    )
    model = build_lgb_ranker(**overrides)
    model.fit(X, relevance, group=group, eval_at=fit_eval_at)
    return model


def train_p50_ranker_from_frame(
    train_df: pd.DataFrame,
    X: pd.DataFrame,
    *,
    min_fpts: float = 0.0,
    **overrides: Any,
):
    """
    Align ``X`` rows with a filtered/sorted training frame and fit lambdarank.

    ``X`` must be built from the same ``train_df`` row order before sorting;
    this helper reindexes features to the ranking frame.
    """
    ranked_df, groups = prepare_ranking_frame(train_df, min_fpts=min_fpts)
    X_ranked = X.loc[ranked_df.index] if not ranked_df.index.equals(X.index) else X
    if len(X_ranked) != len(ranked_df):
        X_ranked = X.reindex(ranked_df.index)
    y = ranked_df["Fpts"].values
    return train_p50_ranker(X_ranked, y, groups, **overrides)
