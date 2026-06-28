"""Serializable training configuration for quantile model experiments."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from src.config import BOOM_THRESHOLDS

# Immutable production baseline — omitted from checkpoint hash (backward compatible).
DEFAULT_TRAINING_CONFIG_NAME = "default"


def _normalize_position(position: str) -> str:
    key = position.lower()
    if key in ("rec", "te", "wr_te"):
        return "wr"
    return key


@dataclass(frozen=True)
class TrainingConfig:
    """
    Deterministic experiment spec for walk-forward quantile training.

    Only serializable fields participate in checkpoint hashing. Sample weights
    are derived at fit time from ``boom_weight_p90`` and the training target ``y``.
    """

    name: str = DEFAULT_TRAINING_CONFIG_NAME
    boom_weight_p90: float = 1.0
    regressor_overrides_by_alpha: dict[float, dict[str, Any]] = field(default_factory=dict)
    p50_backend: str = "sklearn"
    lgb_ranker_overrides: dict[str, Any] = field(default_factory=dict)
    relevance_binning: str = "fpts_tiers"
    relevance_n_tiers: int = 30

    def is_default(self) -> bool:
        return (
            self.name == DEFAULT_TRAINING_CONFIG_NAME
            and self.boom_weight_p90 == 1.0
            and not self.regressor_overrides_by_alpha
            and self.p50_backend == "sklearn"
            and not self.lgb_ranker_overrides
            and self.relevance_binning == "fpts_tiers"
            and self.relevance_n_tiers == 30
        )

    def hash_digest(self) -> bytes:
        """Stable digest for cache keying; empty for production default."""
        if self.is_default():
            return b""
        payload = {
            "name": self.name,
            "boom_weight_p90": self.boom_weight_p90,
            "p50_backend": self.p50_backend,
            "relevance_binning": self.relevance_binning,
            "relevance_n_tiers": self.relevance_n_tiers,
            "lgb_ranker_overrides": dict(sorted(self.lgb_ranker_overrides.items())),
            "regressor_overrides_by_alpha": {
                str(alpha): dict(sorted(overrides.items()))
                for alpha, overrides in sorted(self.regressor_overrides_by_alpha.items())
            },
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).digest()

    def resolve_sample_weights_by_alpha(
        self,
        y: np.ndarray,
        position: str,
    ) -> dict[float, np.ndarray] | None:
        """Build per-quantile sample weights. Only P90 may be skewed."""
        if self.boom_weight_p90 <= 1.0:
            return None
        pos = _normalize_position(position)
        threshold = BOOM_THRESHOLDS.get(pos, 20.0)
        weights = np.ones(len(y), dtype=float)
        weights[y >= threshold] = float(self.boom_weight_p90)
        return {0.9: weights}

    def resolve_regressor_overrides_by_alpha(self) -> dict[float, dict[str, Any]]:
        return {float(k): dict(v) for k, v in self.regressor_overrides_by_alpha.items()}


DEFAULT_TRAINING_CONFIG = TrainingConfig()

# WR calibration presets (walk-forward experiments only).
WR_P90_BOOM_WEIGHT_2 = TrainingConfig(name="wr_p90_boom_2", boom_weight_p90=2.0)
WR_P90_BOOM_WEIGHT_3 = TrainingConfig(name="wr_p90_boom_3", boom_weight_p90=3.0)
WR_P90_BOOM_WEIGHT_5 = TrainingConfig(name="wr_p90_boom_5", boom_weight_p90=5.0)
WR_P90_DEPTH_5 = TrainingConfig(
    name="wr_p90_depth_5",
    regressor_overrides_by_alpha={0.9: {"max_depth": 5}},
)
WR_P90_BOOM_3_DEPTH_5 = TrainingConfig(
    name="wr_p90_boom_3_depth_5",
    boom_weight_p90=3.0,
    regressor_overrides_by_alpha={0.9: {"max_depth": 5}},
)

# WR P50 rank regularization (τ=0.5 overrides only; P90 calibration unchanged).
WR_P50_DEPTH_3 = TrainingConfig(
    name="wr_p50_depth_3",
    regressor_overrides_by_alpha={0.5: {"max_depth": 3}},
)
WR_P50_MIN_LEAF_20 = TrainingConfig(
    name="wr_p50_min_leaf_20",
    regressor_overrides_by_alpha={0.5: {"min_samples_leaf": 20}},
)
WR_P50_LR_03 = TrainingConfig(
    name="wr_p50_lr_03",
    regressor_overrides_by_alpha={0.5: {"learning_rate": 0.03, "n_estimators": 150}},
)
WR_P50_REGULARIZED_COMBO = TrainingConfig(
    name="wr_p50_regularized_combo",
    regressor_overrides_by_alpha={
        0.5: {"max_depth": 3, "min_samples_leaf": 20, "subsample": 0.8},
    },
)
WR_P50_LAMBDARANK = TrainingConfig(
    name="wr_p50_lambdarank",
    p50_backend="lambdarank",
    relevance_binning="fpts_tiers",
    relevance_n_tiers=30,
    lgb_ranker_overrides={
        "min_child_samples": 10,
        "lambdarank_truncation_level": 50,
    },
)
WR_P50_LAMBDARANK_LEGACY = TrainingConfig(
    name="wr_p50_lambdarank_legacy",
    p50_backend="lambdarank",
    relevance_binning="rank_scaled",
    relevance_n_tiers=30,
)

# RB P90 calibration (τ=0.9 boom sample weights only).
RB_P90_BOOM_WEIGHT_2 = TrainingConfig(name="rb_p90_boom_2", boom_weight_p90=2.0)
RB_P90_BOOM_WEIGHT_3 = TrainingConfig(name="rb_p90_boom_3", boom_weight_p90=3.0)
RB_P90_BOOM_WEIGHT_5 = TrainingConfig(name="rb_p90_boom_5", boom_weight_p90=5.0)

CALIBRATION_PRESETS: dict[str, TrainingConfig] = {
    "default": DEFAULT_TRAINING_CONFIG,
    "wr_p90_boom_2": WR_P90_BOOM_WEIGHT_2,
    "wr_p90_boom_3": WR_P90_BOOM_WEIGHT_3,
    "wr_p90_boom_5": WR_P90_BOOM_WEIGHT_5,
    "wr_p90_depth_5": WR_P90_DEPTH_5,
    "wr_p90_boom_3_depth_5": WR_P90_BOOM_3_DEPTH_5,
    "wr_p50_depth_3": WR_P50_DEPTH_3,
    "wr_p50_min_leaf_20": WR_P50_MIN_LEAF_20,
    "wr_p50_lr_03": WR_P50_LR_03,
    "wr_p50_regularized_combo": WR_P50_REGULARIZED_COMBO,
    "wr_p50_lambdarank": WR_P50_LAMBDARANK,
    "wr_p50_lambdarank_legacy": WR_P50_LAMBDARANK_LEGACY,
    "rb_p90_boom_2": RB_P90_BOOM_WEIGHT_2,
    "rb_p90_boom_3": RB_P90_BOOM_WEIGHT_3,
    "rb_p90_boom_5": RB_P90_BOOM_WEIGHT_5,
}


def get_training_config(name: str) -> TrainingConfig:
    key = name.strip().lower()
    if key not in CALIBRATION_PRESETS:
        known = ", ".join(sorted(CALIBRATION_PRESETS))
        raise ValueError(f"Unknown training config '{name}'. Known presets: {known}")
    return CALIBRATION_PRESETS[key]
