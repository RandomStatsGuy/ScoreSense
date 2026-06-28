"""Tests for TrainingConfig and calibration checkpoint hashing."""

import numpy as np
import pandas as pd

from src.pipeline.backtest_checkpoint import compute_dataset_hash
from src.ml.training_config import (
    DEFAULT_TRAINING_CONFIG,
    WR_P90_BOOM_WEIGHT_3,
    get_training_config,
)
from src.ml.quantile import train_quantile_models


def _mini_frames():
    train_df = pd.DataFrame(
        {
            "season": [2022, 2022],
            "week": [1, 2],
            "player_id": ["a", "b"],
            "Fpts": [10.0, 25.0],
        }
    )
    test_df = pd.DataFrame(
        {
            "season": [2023, 2023],
            "week": [1, 2],
            "player_id": ["a", "b"],
            "Fpts": [12.0, 18.0],
        }
    )
    return train_df, test_df


def test_default_config_is_empty_hash_digest():
    assert DEFAULT_TRAINING_CONFIG.hash_digest() == b""
    assert DEFAULT_TRAINING_CONFIG.is_default()


def test_non_default_config_changes_dataset_hash():
    train_df, test_df = _mini_frames()
    base = compute_dataset_hash(train_df, test_df, "wr")
    tuned = compute_dataset_hash(train_df, test_df, "wr", training_config=WR_P90_BOOM_WEIGHT_3)
    assert base != tuned


def test_boom_weights_only_apply_to_p90():
    rng = np.random.default_rng(7)
    X = pd.DataFrame({"f1": rng.normal(size=120)})
    y = np.concatenate([rng.normal(8, 2, size=100), np.full(20, 28.0)])

    baseline = train_quantile_models(X, y, quantiles=(0.9,), position="wr")
    weighted = train_quantile_models(
        X,
        y,
        quantiles=(0.9,),
        training_config=WR_P90_BOOM_WEIGHT_3,
        position="wr",
    )
    base_p90 = baseline[0.9].predict(X)
    weighted_p90 = weighted[0.9].predict(X)
    assert not np.allclose(base_p90, weighted_p90)


def test_get_training_config_presets():
    cfg = get_training_config("wr_p90_boom_3")
    assert cfg.boom_weight_p90 == 3.0
    assert cfg.name == "wr_p90_boom_3"
