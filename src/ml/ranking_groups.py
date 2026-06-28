"""Weekly slate grouping for list-wise rank training (LightGBM lambdarank)."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import rankdata

REGULAR_WEEKS = range(1, 19)
GROUP_KEYS = ("season", "week")
ROW_SORT_KEYS = ("season", "week", "player_id")


def filter_ranking_rows(df: pd.DataFrame, min_fpts: float = 0.0) -> pd.DataFrame:
    """Keep regular-season rows; optionally drop non-positive Fpts (training default)."""
    if df.empty:
        return df.copy()
    out = df[df["week"].isin(REGULAR_WEEKS)].copy()
    if min_fpts > 0 and "Fpts" in out.columns:
        out = out[out["Fpts"] > min_fpts]
    return out


def sort_for_ranking(df: pd.DataFrame) -> pd.DataFrame:
    """Stable sort so weekly slates are contiguous for LightGBM ``group`` arrays."""
    sort_cols = [c for c in ROW_SORT_KEYS if c in df.columns]
    if not sort_cols:
        raise ValueError("ranking frame requires season/week columns")
    return df.sort_values(sort_cols, kind="mergesort").reset_index(drop=True)


def build_weekly_groups(df: pd.DataFrame) -> list[int]:
    """
    Consecutive group sizes per (season, week) slate.

    ``df`` must already be sorted via ``sort_for_ranking``.
    """
    if df.empty:
        return []
    _assert_contiguous_slates(df)
    return df.groupby(list(GROUP_KEYS), sort=False).size().tolist()


def build_relevance_labels(
    y: np.ndarray,
    group: list[int],
    *,
    max_relevance: int = 30,
    method: str = "fpts_tiers",
) -> np.ndarray:
    """
    Integer relevance labels for LightGBM lambdarank (0 .. max_relevance).

    fpts_tiers: equal-frequency Fpts bins per weekly slate — near-ties map to the
    same tier so LambdaRank ignores micro-variance.

    rank_scaled: legacy ordinal-rank scaling (top-heavy NDCG gradients).
    """
    if method == "rank_scaled":
        return _relevance_from_rank_scaling(y, group, max_relevance=max_relevance)
    if method == "fpts_tiers":
        return _relevance_from_fpts_tiers(y, group, max_relevance=max_relevance)
    raise ValueError(f"Unknown relevance method: {method}")


def _relevance_from_rank_scaling(
    y: np.ndarray,
    group: list[int],
    *,
    max_relevance: int,
) -> np.ndarray:
    labels = np.empty(len(y), dtype=np.int32)
    start = 0
    for g in group:
        sl = y[start : start + g]
        if g <= 1:
            labels[start] = 0
        else:
            ranks = rankdata(sl, method="ordinal") - 1
            scaled = np.round(ranks / (g - 1) * max_relevance).astype(np.int32)
            labels[start : start + g] = np.clip(scaled, 0, max_relevance)
        start += g
    return labels


def _relevance_from_fpts_tiers(
    y: np.ndarray,
    group: list[int],
    *,
    max_relevance: int,
) -> np.ndarray:
    labels = np.empty(len(y), dtype=np.int32)
    start = 0
    n_tier_levels = max_relevance + 1
    for g in group:
        sl = y[start : start + g]
        if g <= 1 or np.all(sl == sl[0]):
            labels[start : start + g] = 0
        else:
            n_bins = min(n_tier_levels, g)
            try:
                tiers = pd.qcut(sl, q=n_bins, labels=False, duplicates="drop")
                tiers = np.asarray(tiers, dtype=float)
            except ValueError:
                tiers = rankdata(sl, method="dense") - 1
            tmax = np.nanmax(tiers)
            if not np.isfinite(tmax) or tmax <= 0:
                labels[start : start + g] = 0
            else:
                scaled = np.round(tiers / tmax * max_relevance).astype(np.int32)
                labels[start : start + g] = np.clip(scaled, 0, max_relevance)
        start += g
    return labels


def validate_groups(df: pd.DataFrame, groups: list[int]) -> None:
    if sum(groups) != len(df):
        raise ValueError(f"group sum {sum(groups)} != row count {len(df)}")
    if any(g <= 0 for g in groups):
        raise ValueError("all group sizes must be positive")


def prepare_ranking_frame(
    df: pd.DataFrame,
    *,
    min_fpts: float = 0.0,
) -> tuple[pd.DataFrame, list[int]]:
    """Filter, sort, and build LightGBM group sizes for rank training."""
    filtered = filter_ranking_rows(df, min_fpts=min_fpts)
    sorted_df = sort_for_ranking(filtered)
    groups = build_weekly_groups(sorted_df)
    validate_groups(sorted_df, groups)
    return sorted_df, groups


def _assert_contiguous_slates(df: pd.DataFrame) -> None:
    """Ensure rows are grouped by (season, week) without interleaving."""
    if len(df) < 2:
        return
    keys = df[list(GROUP_KEYS)].astype(str).agg("-".join, axis=1)
    slate_change = keys != keys.shift()
    # Each slate should appear in one contiguous block
    block_ids = slate_change.cumsum()
    if block_ids.groupby(keys).nunique().max() > 1:
        raise ValueError("rows are not contiguous by (season, week); call sort_for_ranking first")
