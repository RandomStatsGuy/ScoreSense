"""nflverse Next Gen Stats receiving metrics for WR candidate screening."""

from __future__ import annotations

import pandas as pd

from src.etl.nflverse_etl import _import_nfl_data_py

NGS_METRIC_COLS = ("ngs_avg_separation", "ngs_yac_above_expectation")
NGS_RAW_COLS = ("avg_separation", "avg_yac_above_expectation")


def _import_ngs_receiving(seasons: list[int]) -> pd.DataFrame:
    nfl = _import_nfl_data_py()
    return nfl.import_ngs_data(stat_type="receiving", years=seasons)


def _season_bounded_ffill_zero(df: pd.DataFrame, cols: tuple[str, ...]) -> pd.DataFrame:
    """Forward-fill within player-season, then zero-fill unseen players."""
    out = df.sort_values(["player_id", "season", "week"]).copy()
    for col in cols:
        if col not in out.columns:
            out[col] = 0.0
        out[col] = out.groupby(["player_id", "season"], group_keys=False)[col].ffill()
        out[col] = out[col].fillna(0.0)
    return out


def load_ngs_receiving_weekly(seasons: list[int]) -> pd.DataFrame:
    """
    Load weekly NGS receiving metrics with sparsity handling.

  Returns sparse NGS-only rows (player_id, season, week) with dense metrics.
    """
    ngs = _import_ngs_receiving(seasons)
    ngs = ngs[ngs["week"] > 0].copy()
    ngs = ngs[ngs["player_position"].isin(["WR", "TE"])].copy()
    ngs = ngs.rename(
        columns={
            "player_gsis_id": "player_id",
            "avg_separation": "ngs_avg_separation",
            "avg_yac_above_expectation": "ngs_yac_above_expectation",
        }
    )
    keep = ["player_id", "season", "week", *NGS_METRIC_COLS]
    ngs = ngs[[c for c in keep if c in ngs.columns]].copy()
    return _season_bounded_ffill_zero(ngs, NGS_METRIC_COLS)


def merge_ngs_onto_spine(
    spine: pd.DataFrame,
    ngs_weekly: pd.DataFrame,
    *,
    log_coverage: bool = True,
) -> pd.DataFrame:
    """
    Left-join NGS onto weekly spine and re-apply season-bounded ffill + zero-fill.

    Tracks raw-match vs ffill vs zero-fill when log_coverage=True.
    """
    if ngs_weekly.empty:
        for col in NGS_METRIC_COLS:
            spine[col] = 0.0
        if log_coverage:
            print("NGS: no receiving data; all metrics zero-filled")
        return spine

    raw_ngs = ngs_weekly[["player_id", "season", "week", *NGS_METRIC_COLS]].copy()
    raw_ngs = raw_ngs.rename(
        columns={c: f"{c}_raw" for c in NGS_METRIC_COLS}
    )

    merged = spine.merge(raw_ngs, on=["player_id", "season", "week"], how="left")
    for col in NGS_METRIC_COLS:
        raw_col = f"{col}_raw"
        merged[col] = merged[raw_col] if raw_col in merged.columns else float("nan")

    if log_coverage:
        n = len(merged)
        raw_match = merged[f"{NGS_METRIC_COLS[0]}_raw"].notna().sum() if n else 0
        print(
            f"NGS coverage: {raw_match / n:.1%} raw match ({raw_match:,}/{n:,} rows)"
            if n
            else "NGS coverage: no spine rows"
        )

    merged = _season_bounded_ffill_zero(merged, NGS_METRIC_COLS)

    if log_coverage and len(merged):
        raw_col = f"{NGS_METRIC_COLS[0]}_raw"
        had_raw = merged[raw_col].notna()
        used_ffill = (~had_raw) & (merged[NGS_METRIC_COLS[0]] != 0)
        zero_filled = merged[NGS_METRIC_COLS[0]] == 0
        n = len(merged)
        print(f"NGS after ffill: {used_ffill.sum() / n:.1%} inherited ({used_ffill.sum():,} rows)")
        print(f"NGS zero-fill:   {zero_filled.sum() / n:.1%} unseen ({zero_filled.sum():,} rows)")

    drop_raw = [c for c in merged.columns if c.endswith("_raw")]
    merged = merged.drop(columns=drop_raw, errors="ignore")
    return merged
