"""Tests for quantile regression utilities."""

import numpy as np
import pandas as pd

from src.ml.quantile import (
    interval_coverage,
    predict_quantiles,
    repair_projection_quantiles,
    repair_quantile_arrays,
    repair_quantile_order,
    train_quantile_models,
)


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


def test_repair_quantile_arrays_keeps_p50_fixed():
    """Cousins-style weekly inversion: P50 above P90 — repair tails, keep P50."""
    q10, q50, q90 = repair_quantile_arrays(
        np.array([6.0, 1.4]),
        np.array([12.0, 15.3]),  # second row: Purdy-style P50 above raw ceiling
        np.array([10.0, 10.4]),
    )
    assert q50[0] == 12.0
    assert q50[1] == 15.3
    assert q10[0] <= q50[0] <= q90[0]
    assert q10[1] <= q50[1] <= q90[1]
    assert q90[1] >= 15.3


def test_repair_projection_quantiles_weekly_cousins_fixture():
    frame = pd.DataFrame(
        {
            "Player": ["Kirk Cousins"],
            "Projected Points": [18.2],
            "Low (P10)": [9.0],
            "High (P90)": [14.5],  # P50 outside Low–High
        }
    )
    fixed = repair_projection_quantiles(frame)
    assert fixed.loc[0, "Projected Points"] == 18.2
    assert fixed.loc[0, "Low (P10)"] <= fixed.loc[0, "Projected Points"]
    assert fixed.loc[0, "Projected Points"] <= fixed.loc[0, "High (P90)"]


def test_repair_projection_quantiles_purdy_per_game_fixture():
    """Season totals can look ordered while per-game bar is inverted after blend."""
    frame = pd.DataFrame(
        {
            "Player": ["Brock Purdy"],
            "Per-Game Proj": [15.3],
            "Per-Game Floor": [1.4],
            "Per-Game Ceiling": [10.4],
            "Season Proj": [138.0],
            "Season Floor": [88.0],
            "Season Ceiling": [183.0],
            "Season P10": [88.0],
            "Season P50": [138.0],
            "Season P90": [183.0],
        }
    )
    fixed = repair_projection_quantiles(frame)
    assert fixed.loc[0, "Per-Game Proj"] == 15.3
    assert fixed.loc[0, "Per-Game Floor"] <= fixed.loc[0, "Per-Game Proj"]
    assert fixed.loc[0, "Per-Game Proj"] <= fixed.loc[0, "Per-Game Ceiling"]
    assert fixed.loc[0, "Season Floor"] <= fixed.loc[0, "Season Proj"]
    assert fixed.loc[0, "Season Proj"] <= fixed.loc[0, "Season Ceiling"]


def test_repair_quantile_order_dataframe():
    preds = pd.DataFrame({"q10": [5.0], "q50": [4.0], "q90": [3.0]})
    fixed = repair_quantile_order(preds)
    assert fixed.loc[0, "q50"] == 4.0
    assert fixed.loc[0, "q10"] <= fixed.loc[0, "q50"] <= fixed.loc[0, "q90"]
