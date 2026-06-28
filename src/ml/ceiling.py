"""Compositional WR ceiling head (Phase 2 fallback — not used in production)."""

from __future__ import annotations

from typing import Any, Protocol

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

from src.ml.quantile import build_quantile_regressor


class CeilingModel(Protocol):
    """Protocol for optional ceiling overlays trained off the main quantile trio."""

    def fit(self, X: pd.DataFrame, y: np.ndarray, **kwargs: Any) -> CeilingModel: ...

    def predict(self, X: pd.DataFrame) -> np.ndarray: ...


def compose_p90(
    base_p90: np.ndarray | pd.Series,
    ceiling_p90: np.ndarray | pd.Series,
    *,
    mode: str = "max",
) -> np.ndarray:
    """
    Merge base quantile P90 with a parallel ceiling head prediction.

    ``max`` raises the ceiling without lowering it; ``replace`` uses the head only.
    """
    base = np.asarray(base_p90, dtype=float)
    ceil = np.asarray(ceiling_p90, dtype=float)
    if mode == "replace":
        return ceil
    if mode == "max":
        return np.maximum(base, ceil)
    raise ValueError(f"Unknown compose mode: {mode}")


def train_ceiling_residual_head(
    X: pd.DataFrame,
    y: np.ndarray,
    base_p50: np.ndarray,
    *,
    alpha: float = 0.9,
    random_state: int = 42,
) -> GradientBoostingRegressor:
    """
    Train a residual ceiling regressor on excess points above the P50 baseline.

    Experimental only — intended for walk-forward calibration, not production inference.
    """
    residual = np.maximum(y - base_p50, 0.0)
    model = build_quantile_regressor(alpha, random_state=random_state)
    model.fit(X, residual)
    return model


def predict_ceiling_p90(
    ceiling_model: GradientBoostingRegressor,
    X: pd.DataFrame,
    base_p50: np.ndarray,
    *,
    compose_mode: str = "max",
    base_p90: np.ndarray | None = None,
) -> np.ndarray:
    """Predict composed P90 from a residual ceiling head plus base quantiles."""
    residual = ceiling_model.predict(X)
    ceiling_p90 = base_p50 + residual
    if base_p90 is None:
        return ceiling_p90
    return compose_p90(base_p90, ceiling_p90, mode=compose_mode)
