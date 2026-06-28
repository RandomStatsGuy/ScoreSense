"""Quantile regression model utilities."""

from __future__ import annotations

from typing import Any, Dict

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

from src.ml.training_config import DEFAULT_TRAINING_CONFIG, TrainingConfig

DEFAULT_QUANTILES = (0.1, 0.5, 0.9)

_DEFAULT_GBM_PARAMS = {
    "n_estimators": 200,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.8,
}


def build_quantile_regressor(
    alpha: float,
    random_state: int = 42,
    **overrides: Any,
) -> GradientBoostingRegressor:
    params = {**_DEFAULT_GBM_PARAMS, **overrides}
    return GradientBoostingRegressor(
        loss="quantile",
        alpha=alpha,
        random_state=random_state,
        **params,
    )


def train_quantile_models(
    X: pd.DataFrame,
    y: np.ndarray,
    quantiles: tuple[float, ...] = DEFAULT_QUANTILES,
    training_config: TrainingConfig | None = None,
    position: str = "wr",
) -> Dict[float, GradientBoostingRegressor]:
    """
    Train one GBR per quantile level.

    P10/P50 use uniform weights unless explicitly overridden. P90 may receive
    boom-upweighted ``sample_weight`` via ``TrainingConfig`` without touching
    median rank ordering.
    """
    cfg = training_config or DEFAULT_TRAINING_CONFIG
    sample_weights_by_alpha = cfg.resolve_sample_weights_by_alpha(y, position) or {}
    regressor_overrides_by_alpha = cfg.resolve_regressor_overrides_by_alpha()

    models: Dict[float, GradientBoostingRegressor] = {}
    for alpha in quantiles:
        fit_kwargs: dict[str, Any] = {}
        if alpha in sample_weights_by_alpha:
            fit_kwargs["sample_weight"] = sample_weights_by_alpha[alpha]
        overrides = regressor_overrides_by_alpha.get(alpha, {})
        model = build_quantile_regressor(alpha, **overrides)
        model.fit(X, y, **fit_kwargs)
        models[alpha] = model
    return models


def repair_quantile_order(preds: pd.DataFrame) -> pd.DataFrame:
    """
    Enforce q10 <= q50 <= q90 while keeping P50 fixed.

    Separate quantile regressors (especially with P90-only calibration weights) can
    occasionally cross; repair tails relative to the median instead of re-sorting all
    three values so rank order stays tied to P50.
    """
    if not {"q10", "q50", "q90"}.issubset(preds.columns):
        return preds

    out = preds.copy()
    q50 = out["q50"].to_numpy(dtype=float)
    q10 = out["q10"].to_numpy(dtype=float)
    q90 = out["q90"].to_numpy(dtype=float)

    low = np.minimum(q10, q50)
    high = np.maximum(q90, q50)

    crossed_low = q10 > q50
    up_spread = np.maximum(high - q50, 1.0)
    low[crossed_low] = q50[crossed_low] - 0.35 * up_spread[crossed_low]

    crossed_high = q90 < q50
    down_spread = np.maximum(q50 - low, 1.0)
    high[crossed_high] = q50[crossed_high] + 0.35 * down_spread[crossed_high]

    out["q10"] = np.minimum(np.maximum(low, 0.0), q50)
    out["q90"] = np.maximum(high, q50)
    return out


def predict_quantiles(
    models: Dict[float, GradientBoostingRegressor],
    X: pd.DataFrame,
) -> pd.DataFrame:
    preds = pd.DataFrame(index=X.index)
    for alpha, model in sorted(models.items()):
        col = f"q{int(alpha * 100)}"
        preds[col] = model.predict(X)
    preds = repair_quantile_order(preds)
    if "q50" in preds.columns:
        preds["point"] = preds["q50"]
    return preds


def interval_coverage(actual: pd.Series, low: pd.Series, high: pd.Series) -> float:
    mask = actual.notna() & low.notna() & high.notna()
    if mask.sum() == 0:
        return float("nan")
    inside = (actual[mask] >= low[mask]) & (actual[mask] <= high[mask])
    return float(inside.mean())
