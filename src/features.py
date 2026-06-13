"""Unified feature definitions for training and inference."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np
import pandas as pd

from src.config import FANTASY_SCORING


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
    ),
)

FEATURE_REGISTRY: dict[str, PositionFeatures] = {
    "qb": QB_FEATURES,
    "rb": RB_FEATURES,
    "wr": WR_FEATURES,
}


def get_position_features(position: str) -> PositionFeatures:
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
) -> pd.DataFrame:
    """Select and fill unified model feature columns."""
    spec = get_position_features(position)
    matrix = pd.DataFrame(index=df.index)
    for col in spec.feature_cols:
        if col in df.columns:
            matrix[col] = df[col]
        else:
            matrix[col] = fill_value
    return matrix.fillna(fill_value)


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
