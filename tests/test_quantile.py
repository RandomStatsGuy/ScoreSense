"""Tests for quantile regression utilities."""

import numpy as np
import pandas as pd

from src.ml.quantile import interval_coverage, predict_quantiles, train_quantile_models


def test_quantile_training_and_intervals():
    rng = np.random.default_rng(42)
    X = pd.DataFrame({"f1": rng.normal(size=200), "f2": rng.normal(size=200)})
    y = X["f1"] * 2 + rng.normal(scale=2, size=200)

    models = train_quantile_models(X, y.values, quantiles=(0.1, 0.5, 0.9))
    preds = predict_quantiles(models, X)

    assert "q10" in preds.columns
    assert "q50" in preds.columns
    assert "q90" in preds.columns
    assert (preds["q10"] <= preds["q50"]).mean() > 0.9
    assert (preds["q50"] <= preds["q90"]).mean() > 0.9


def test_interval_coverage():
    actual = pd.Series([10, 12, 8, 15])
    low = pd.Series([8, 10, 7, 12])
    high = pd.Series([12, 14, 11, 16])
    cov = interval_coverage(actual, low, high)
    assert cov == 1.0
