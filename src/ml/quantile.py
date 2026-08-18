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


# Display / API column triplets that must obey floor ≤ projected ≤ ceiling.
# P50 is the ranking key; tails are repaired when later transforms move the center.
PROJECTION_QUANTILE_COLUMN_SETS: tuple[tuple[str, str, str], ...] = (
    ("q10", "q50", "q90"),
    ("Low (P10)", "Projected Points", "High (P90)"),
    ("Per-Game Floor", "Per-Game Proj", "Per-Game Ceiling"),
    ("Season P10", "Season P50", "Season P90"),
    ("Season Floor", "Season Proj", "Season Ceiling"),
)


def repair_quantile_arrays(
    q10: np.ndarray,
    q50: np.ndarray,
    q90: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Enforce q10 <= q50 <= q90 while keeping P50 fixed.

    Separate quantile regressors (especially with P90-only calibration weights) can
    occasionally cross; repair tails relative to the median instead of re-sorting all
    three values so rank order stays tied to P50.
    """
    q50_a = np.asarray(q50, dtype=float)
    q10_a = np.asarray(q10, dtype=float)
    q90_a = np.asarray(q90, dtype=float)

    low = np.minimum(q10_a, q50_a)
    high = np.maximum(q90_a, q50_a)

    crossed_low = q10_a > q50_a
    up_spread = np.maximum(high - q50_a, 1.0)
    low[crossed_low] = q50_a[crossed_low] - 0.35 * up_spread[crossed_low]

    crossed_high = q90_a < q50_a
    down_spread = np.maximum(q50_a - low, 1.0)
    high[crossed_high] = q50_a[crossed_high] + 0.35 * down_spread[crossed_high]

    out_q10 = np.minimum(np.maximum(low, 0.0), q50_a)
    out_q90 = np.maximum(high, q50_a)
    return out_q10, q50_a, out_q90


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
    q10, q50, q90 = repair_quantile_arrays(out["q10"], out["q50"], out["q90"])
    out["q10"] = q10
    out["q50"] = q50
    out["q90"] = q90
    return out


def repair_projection_quantiles(
    frame: pd.DataFrame,
    *,
    column_sets: tuple[tuple[str, str, str], ...] | None = None,
) -> pd.DataFrame:
    """Repair every present display/API quantile triplet (SCORE-50).

    Call after any transform that can move P50 without the tails (blend,
    overlays, rolling rate, vet-backup scale, rounding).
    """
    if frame is None or frame.empty:
        return frame

    sets = column_sets or PROJECTION_QUANTILE_COLUMN_SETS
    out = frame
    copied = False
    for low_col, mid_col, high_col in sets:
        if not {low_col, mid_col, high_col}.issubset(out.columns):
            continue
        if not copied:
            out = frame.copy()
            copied = True
        q10, q50, q90 = repair_quantile_arrays(
            out[low_col].to_numpy(dtype=float),
            out[mid_col].to_numpy(dtype=float),
            out[high_col].to_numpy(dtype=float),
        )
        out[low_col] = q10
        out[mid_col] = q50
        out[high_col] = q90
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
