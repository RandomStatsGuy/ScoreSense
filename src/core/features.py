"""Unified feature definitions for training and inference."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable

import numpy as np
import pandas as pd

from src.config import FANTASY_SCORING

FP_FEATURE_COLS = ("fp_consensus_ppr", "fp_ecr")
STAT_AVG_RENAMES = {
    "passing_tds": "pass_tds_avg",
    "interceptions": "ints_avg",
    "attempts": "pass_attmpt_avg",
    "carries": "rush_attmpt_avg",
    "rushing_tds": "rush_tds_avg",
    "receiving_air_yards": "air_yards_avg",
    "target_quality_score": "target_quality_avg",
}


def completed_game_profiles(history: pd.DataFrame) -> pd.DataFrame:
    """Advance pre-game averages through the last completed game.

    Keep the trained expanding-average definition. Changing the window to recent
    games is a separate model experiment, not an inference-only transformation.
    Callers must exclude the target game and all later games first.
    """
    out = history.sort_values(["player_id", "season", "week"]).copy()
    # Older ETL files retained only share averages. Reconstruct raw shares with
    # the same position-pool denominator used by that ETL, when possible.
    if "team" in out.columns:
        for share, count in (("carry_share", "carries"), ("target_share", "targets"), ("air_yards_share", "receiving_air_yards")):
            raw = f"{count}_lead"
            if f"{share}_lead" not in out and f"{share}_avg" in out and raw in out:
                total = out.groupby(["season", "week", "team"])[raw].transform("sum")
                out[f"{share}_lead"] = safe_div(out[raw], total)
        if "wopr_lead" not in out and {"target_share_lead", "air_yards_share_lead"}.issubset(out):
            out["wopr_lead"] = 1.5 * out["target_share_lead"] + 0.7 * out["air_yards_share_lead"]
    for raw in [c for c in out.columns if c.endswith("_lead")]:
        stat = raw.removesuffix("_lead")
        avg = STAT_AVG_RENAMES.get(stat, f"{stat}_avg")
        if avg in out.columns:
            values = pd.to_numeric(out[raw], errors="coerce")
            totals = values.fillna(0.).groupby(out["player_id"]).cumsum()
            counts = values.notna().astype(int).groupby(out["player_id"]).cumsum()
            out[avg] = totals / counts.replace(0, np.nan)
    # Availability allocation is a current-role heuristic, separate from the
    # trained career averages. Preserve an injured player's last observed role.
    for share in ("carry_share", "target_share"):
        raw = f"{share}_lead"
        if raw in out and "team" in out:
            out[f"_opportunity_{share}"] = out.groupby(["player_id", "season", "team"])[raw].transform(
                lambda s: pd.to_numeric(s, errors="coerce").rolling(3, min_periods=1).mean()
            )
    out["_opportunity_observed"] = True
    return out


def feature_completeness(df: pd.DataFrame, feature_cols: Iterable[str]) -> dict:
    """Audit model inputs before any compatibility imputation conceals gaps."""
    cols = list(dict.fromkeys(feature_cols))
    present = [c for c in cols if c in df]
    numeric = df[present].apply(pd.to_numeric, errors="coerce")
    missing = [c for c in cols if c not in df]
    null_counts = {c: int(n) for c, n in numeric.isna().sum().items() if n}
    zeros = [c for c in present if len(df) and numeric[c].notna().all() and numeric[c].eq(0).all()]
    return {"rows": len(df), "expected_features": len(cols), "missing_columns": missing,
            "null_counts": null_counts, "all_zero_columns": zeros,
            "complete": bool(len(df)) and not missing and not null_counts}


@dataclass(frozen=True)
class PositionFeatures:
    position: str
    stat_cols: tuple[str, ...]
    avg_cols: tuple[str, ...]
    extra_cols: tuple[str, ...] = ()

    @property
    def feature_cols(self) -> tuple[str, ...]:
        return self.avg_cols + self.extra_cols


QB_FEATURES = PositionFeatures(
    position="qb",
    stat_cols=(
        "passing_yards",
        "passing_tds",
        "interceptions",
        "completions",
        "attempts",
        "carries",
        "rushing_yards",
        "rushing_tds",
        "fumbles",
        "fumbles_lost",
        "passing_epa",
        "rushing_epa",
    ),
    avg_cols=(
        "passing_yards_avg",
        "pass_tds_avg",
        "ints_avg",
        "completions_avg",
        "pass_attmpt_avg",
        "rush_attmpt_avg",
        "rushing_yards_avg",
        "rush_tds_avg",
        "fumbles_avg",
        "passing_epa_avg",
        "rushing_epa_avg",
    ),
    extra_cols=(
        "target_share_avg",
        "wopr_avg",
        "opponent_pass_epa_allowed",
        "days_rest",
        "is_home",
    ),
)

RB_FEATURES = PositionFeatures(
    position="rb",
    stat_cols=(
        "receiving_yards",
        "receiving_tds",
        "receptions",
        "targets",
        "carries",
        "rushing_yards",
        "rushing_tds",
        "fumbles",
        "fumbles_lost",
        "rushing_epa",
        "receiving_epa",
    ),
    avg_cols=(
        "receiving_yards_avg",
        "receiving_tds_avg",
        "receptions_avg",
        "targets_avg",
        "rush_attmpt_avg",
        "rushing_yards_avg",
        "rush_tds_avg",
        "fumbles_avg",
        "rushing_epa_avg",
        "receiving_epa_avg",
    ),
    extra_cols=(
        "target_share_avg",
        "carry_share_avg",
        "opponent_rush_epa_allowed",
        "days_rest",
        "is_home",
    ),
)

WR_FEATURES = PositionFeatures(
    position="wr",
    stat_cols=(
        "receiving_yards",
        "receiving_tds",
        "receptions",
        "targets",
        "fumbles",
        "fumbles_lost",
        "receiving_epa",
        "receiving_air_yards",
    ),
    avg_cols=(
        "receiving_yards_avg",
        "receiving_tds_avg",
        "receptions_avg",
        "targets_avg",
        "fumbles_avg",
        "receiving_epa_avg",
        "air_yards_avg",
    ),
    extra_cols=(
        "target_share_avg",
        "air_yards_share_avg",
        "wopr_avg",
        "opponent_pass_epa_allowed",
        "days_rest",
        "is_home",
        "target_quality_avg",
        "separation_at_throw_avg",
        "defender_closing_speed_avg",
    ),
)

FEATURE_REGISTRY: dict[str, PositionFeatures] = {
    "qb": QB_FEATURES,
    "rb": RB_FEATURES,
    "wr": WR_FEATURES,
}


def fantasypros_features_enabled() -> bool:
    return os.getenv("FANTASYPROS_USE_AS_FEATURE", "false").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def get_position_features(position: str) -> PositionFeatures:
    key = position.lower()
    if key in ("rec", "te", "wr_te"):
        key = "wr"
    if key not in FEATURE_REGISTRY:
        raise ValueError(f"Unknown position: {position}")
    spec = FEATURE_REGISTRY[key]
    extra = spec.extra_cols
    if fantasypros_features_enabled():
        extra = extra + FP_FEATURE_COLS
    try:
        from src.analytics.promoted_features import get_promoted_features

        promoted = tuple(get_promoted_features(key))
    except ImportError:
        promoted = ()
    if not promoted and extra == spec.extra_cols:
        return spec
    return PositionFeatures(
        position=spec.position,
        stat_cols=spec.stat_cols,
        avg_cols=spec.avg_cols,
        extra_cols=extra + promoted,
    )


def get_core_position_features(position: str) -> PositionFeatures:
    """Registry spec only — no promoted gate or USAGE_BUNDLE (for feature screening)."""
    key = position.lower()
    if key in ("rec", "te", "wr_te"):
        key = "wr"
    if key not in FEATURE_REGISTRY:
        raise ValueError(f"Unknown position: {position}")
    return FEATURE_REGISTRY[key]


def calc_fantasy_points_ppr(df: pd.DataFrame) -> pd.Series:
    """Compute PPR fantasy points from weekly stat columns."""
    if "fantasy_points_ppr" in df.columns and df["fantasy_points_ppr"].notna().any():
        return df["fantasy_points_ppr"].fillna(0.0)

    total = pd.Series(0.0, index=df.index)
    mapping = {
        "passing_yards": "passing_yards",
        "passing_tds": "passing_tds",
        "interceptions": "interceptions",
        "rushing_yards": "rushing_yards",
        "rushing_tds": "rushing_tds",
        "receptions": "receptions",
        "receiving_yards": "receiving_yards",
        "receiving_tds": "receiving_tds",
        "fumbles_lost": "fumbles_lost",
    }
    for col, src in mapping.items():
        if src in df.columns:
            total += df[src].fillna(0) * FANTASY_SCORING[col]
    return total


def add_rolling_averages(
    df: pd.DataFrame,
    group_col: str,
    stat_cols: Iterable[str],
    suffix: str = "_avg",
    min_periods: int = 1,
) -> pd.DataFrame:
    """Compute pre-game rolling averages (exclude current game)."""
    out = df.copy()
    out = out.sort_values([group_col, "season", "week"])

    for col in stat_cols:
        if col not in out.columns:
            out[col] = 0.0
        avg_col = col.replace("_lead", suffix) if col.endswith("_lead") else f"{col}{suffix}"
        if not avg_col.endswith(suffix):
            avg_col = f"{col}{suffix}"
        out[avg_col] = (
            out.groupby(group_col)[col]
            .apply(lambda s: s.shift(1).expanding(min_periods=min_periods).mean())
            .reset_index(level=0, drop=True)
        )
    return out


def prepare_feature_matrix(
    df: pd.DataFrame,
    position: str,
    fill_value: float = 0.0,
    additional_cols: list[str] | None = None,
    feature_cols_override: list[str] | None = None,
) -> pd.DataFrame:
    """Select and fill unified model feature columns."""
    if feature_cols_override is not None:
        cols = list(dict.fromkeys(feature_cols_override))
    else:
        spec = get_position_features(position)
        cols = list(spec.feature_cols)
        if additional_cols:
            cols.extend(c for c in additional_cols if c not in cols)
    matrix = pd.DataFrame(index=df.index)
    for col in cols:
        if col in df.columns:
            matrix[col] = df[col]
        else:
            matrix[col] = fill_value
    matrix = matrix.fillna(fill_value)
    matrix.attrs["input_quality"] = feature_completeness(df, cols)
    return matrix


def season_average_baseline(df: pd.DataFrame) -> pd.Series:
    """Baseline: player's season-to-date average before each game."""
    return (
        df.groupby(["player_id", "season"])["Fpts"]
        .apply(lambda s: s.shift(1).expanding(min_periods=1).mean())
        .reset_index(level=[0, 1], drop=True)
    )


def last_game_baseline(df: pd.DataFrame) -> pd.Series:
    """Baseline: player's previous game fantasy points."""
    return df.groupby("player_id")["Fpts"].shift(1)


def safe_div(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    denom = denominator.replace(0, np.nan)
    return (numerator / denom).fillna(0.0)
