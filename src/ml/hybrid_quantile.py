"""Hybrid quantile bundle: sklearn P10/P90 + optional LightGBM lambdarank P50."""

from __future__ import annotations

from typing import Any

import pandas as pd

from src.config import PREDICTION_QUANTILES
from src.core.features import prepare_feature_matrix
from src.ml.lgb_ranker import train_p50_ranker
from src.ml.quantile import predict_quantiles, train_quantile_models
from src.ml.ranking_groups import build_weekly_groups, prepare_ranking_frame
from src.ml.training_config import DEFAULT_TRAINING_CONFIG, TrainingConfig

P50_BACKEND_SKLEARN = "sklearn"
P50_BACKEND_LAMBDARANK = "lambdarank"


def train_hybrid_quantile_bundle(
    train_df: pd.DataFrame,
    position: str,
    training_config: TrainingConfig | None = None,
    additional_cols: list[str] | None = None,
    feature_cols_override: list[str] | None = None,
) -> dict[str, Any]:
    """
    Train quantile tails (P10/P90) with sklearn; P50 via lambdarank when configured.

    Production default remains full sklearn via ``train_quantile_models``.
    """
    cfg = training_config or DEFAULT_TRAINING_CONFIG
    if cfg.p50_backend != P50_BACKEND_LAMBDARANK:
        models = train_quantile_models(
            prepare_feature_matrix(
                train_df,
                position,
                additional_cols=additional_cols,
                feature_cols_override=feature_cols_override,
            ),
            train_df["Fpts"].values,
            PREDICTION_QUANTILES,
            training_config=cfg,
            position=position,
        )
        return {
            "quantile_models": models,
            "p50_ranker": None,
            "p50_backend": P50_BACKEND_SKLEARN,
            "training_config": cfg.name,
            "position": position,
        }

    ranked_df, _groups = prepare_ranking_frame(train_df, min_fpts=0.0)
    X_ranked = prepare_feature_matrix(
        ranked_df,
        position,
        additional_cols=additional_cols,
        feature_cols_override=feature_cols_override,
    )
    y = ranked_df["Fpts"].values

    tail_quantiles = (0.1, 0.9)
    quantile_models = train_quantile_models(
        X_ranked,
        y,
        tail_quantiles,
        training_config=cfg,
        position=position,
    )
    p50_ranker = train_p50_ranker(
        X_ranked,
        y,
        build_weekly_groups(ranked_df),
        relevance_method=cfg.relevance_binning,
        relevance_n_tiers=cfg.relevance_n_tiers,
        **cfg.lgb_ranker_overrides,
    )

    return {
        "quantile_models": quantile_models,
        "p50_ranker": p50_ranker,
        "p50_backend": P50_BACKEND_LAMBDARANK,
        "training_config": cfg.name,
        "position": position,
    }


def predict_hybrid_quantiles(bundle: dict[str, Any], X: pd.DataFrame) -> pd.DataFrame:
    """Predict P10/P50/P90 from a sklearn or hybrid bundle."""
    from src.ml.quantile import repair_quantile_order

    preds = predict_quantiles(bundle["quantile_models"], X)
    if bundle.get("p50_backend") == P50_BACKEND_LAMBDARANK and bundle.get("p50_ranker") is not None:
        preds["q50"] = bundle["p50_ranker"].predict(X)
        preds["point"] = preds["q50"]
        # Lambdarank P50 can land outside sklearn P10/P90 — repair tails, keep P50.
        preds = repair_quantile_order(preds)
        preds["point"] = preds["q50"]
    return preds
