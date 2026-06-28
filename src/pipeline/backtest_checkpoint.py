"""Deterministic checkpoints for walk-forward backtest quantile models."""

from __future__ import annotations

import hashlib
from pathlib import Path

import joblib
import pandas as pd

from src.config import BACKTEST_CHECKPOINT_VERSION, BACKTEST_CACHE_DIR, PREDICTION_QUANTILES
from src.core.features import prepare_feature_matrix
from src.ml.hybrid_quantile import (
    P50_BACKEND_LAMBDARANK,
    predict_hybrid_quantiles,
    train_hybrid_quantile_bundle,
)
from src.ml.quantile import predict_quantiles, train_quantile_models
from src.ml.training_config import DEFAULT_TRAINING_CONFIG, TrainingConfig

REGULAR_WEEKS = range(1, 19)

_SORT_COLS = ("season", "week", "player_id", "player_display_name", "player_name", "team")


def walk_forward_split(
    df: pd.DataFrame,
    test_season: int,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Training pool strictly before test_season; test = regular weeks of test_season."""
    train_df = df[df["season"] < test_season].copy()
    test_df = df[(df["season"] == test_season) & (df["week"].isin(REGULAR_WEEKS))].copy()
    return train_df, test_df


def _stable_frame_digest(df: pd.DataFrame) -> bytes:
    if df.empty:
        return b"empty"
    sort_cols = [c for c in _SORT_COLS if c in df.columns]
    if not sort_cols:
        sort_cols = list(df.columns[: min(4, len(df.columns))])
    ordered = df.sort_values(sort_cols, kind="mergesort").reset_index(drop=True)
    return pd.util.hash_pandas_object(ordered, index=False).values.tobytes()


def compute_dataset_hash(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    position: str,
    additional_cols: list[str] | None = None,
    feature_cols: list[str] | None = None,
    training_config: TrainingConfig | None = None,
) -> str:
    """
    Content hash for a walk-forward slice.

    When feature_cols is set (screening), the exact column list is part of the hash.
    Non-default TrainingConfig digests are appended for calibration experiment isolation.
    """
    digest = hashlib.sha256()
    digest.update(BACKTEST_CHECKPOINT_VERSION.encode())
    digest.update(position.lower().encode())
    if feature_cols is not None:
        digest.update("cols:".encode())
        digest.update(",".join(sorted(feature_cols)).encode())
    elif additional_cols:
        digest.update(",".join(sorted(additional_cols)).encode())
    cfg = training_config or DEFAULT_TRAINING_CONFIG
    cfg_digest = cfg.hash_digest()
    if cfg_digest:
        digest.update(b"traincfg:")
        digest.update(cfg_digest)
    digest.update(str(train_df.shape).encode())
    digest.update(str(test_df.shape).encode())
    digest.update(_stable_frame_digest(train_df))
    digest.update(_stable_frame_digest(test_df))
    return digest.hexdigest()


def checkpoint_path(
    test_season: int,
    position: str,
    state_hash: str,
    *,
    screening: bool = False,
    training_config: TrainingConfig | None = None,
) -> Path:
    cfg = training_config or DEFAULT_TRAINING_CONFIG
    if screening:
        root = BACKTEST_CACHE_DIR / "screening"
    elif cfg.p50_backend == P50_BACKEND_LAMBDARANK:
        root = BACKTEST_CACHE_DIR / "ranking" / cfg.name
    elif cfg.is_default():
        root = BACKTEST_CACHE_DIR
    else:
        root = BACKTEST_CACHE_DIR / "calibration" / cfg.name
    return root / f"{test_season}_{position.lower()}_{state_hash}.joblib"


def load_or_train_quantile_models(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    position: str,
    test_season: int,
    additional_cols: list[str] | None = None,
    feature_cols_override: list[str] | None = None,
    use_checkpoint: bool = True,
    training_config: TrainingConfig | None = None,
) -> tuple[dict, bool]:
    """
    Return (quantile_models, cache_hit).

    On miss, train and persist to BACKTEST_CACHE_DIR (or screening/ / calibration/ subdirs).
    """
    extra = additional_cols or []
    screening = feature_cols_override is not None
    cfg = training_config or DEFAULT_TRAINING_CONFIG
    state_hash = compute_dataset_hash(
        train_df,
        test_df,
        position,
        additional_cols=None if screening else extra,
        feature_cols=feature_cols_override,
        training_config=cfg,
    )
    cache_path = checkpoint_path(
        test_season,
        position,
        state_hash,
        screening=screening,
        training_config=cfg,
    )

    if use_checkpoint and cache_path.exists():
        return joblib.load(cache_path), True

    extra_cols = None if screening else extra
    if cfg.p50_backend == P50_BACKEND_LAMBDARANK:
        bundle = train_hybrid_quantile_bundle(
            train_df,
            position,
            training_config=cfg,
            additional_cols=extra_cols,
            feature_cols_override=feature_cols_override,
        )
        if use_checkpoint:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            joblib.dump(bundle, cache_path)
        return bundle, False

    X_train = prepare_feature_matrix(
        train_df,
        position,
        additional_cols=extra_cols,
        feature_cols_override=feature_cols_override,
    )
    models = train_quantile_models(
        X_train,
        train_df["Fpts"].values,
        PREDICTION_QUANTILES,
        training_config=cfg,
        position=position,
    )
    if use_checkpoint:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(models, cache_path)
    del X_train
    return models, False


def predict_walk_forward_season(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    position: str,
    test_season: int,
    additional_cols: list[str] | None = None,
    feature_cols_override: list[str] | None = None,
    use_checkpoint: bool = True,
    training_config: TrainingConfig | None = None,
) -> tuple[pd.DataFrame, bool]:
    """Run cached walk-forward quantile predictions; returns (qpreds_df, cache_hit)."""
    extra = additional_cols or []
    models, cache_hit = load_or_train_quantile_models(
        train_df,
        test_df,
        position,
        test_season,
        extra,
        feature_cols_override=feature_cols_override,
        use_checkpoint=use_checkpoint,
        training_config=training_config,
    )
    X_test = prepare_feature_matrix(
        test_df,
        position,
        additional_cols=None if feature_cols_override is not None else extra,
        feature_cols_override=feature_cols_override,
    )
    if isinstance(models, dict) and models.get("p50_backend") == P50_BACKEND_LAMBDARANK:
        qpreds = predict_hybrid_quantiles(models, X_test)
    else:
        quantile_models = (
            models["quantile_models"] if isinstance(models, dict) and "quantile_models" in models else models
        )
        qpreds = predict_quantiles(quantile_models, X_test)
    del X_test, models
    return qpreds, cache_hit
