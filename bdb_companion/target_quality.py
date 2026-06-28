"""
Target quality metrics for receivers — NGS tracking when available, pbp fallback.

Big Data Bowl 2026 NGS data should be placed in data/raw/ngs/. When present,
separation at throw and defender closing speed replace nflverse proxies.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from bdb_companion.ngs_tracking import build_ngs_features, save_ngs_features
from src.config import BDB_DIR, DEFAULT_ETL_SEASONS, DEFAULT_TRAIN_SEASONS
from src.core.features import add_rolling_averages


def _import_nfl_data_py():
    import nfl_data_py as nfl
    return nfl


def build_pbp_target_quality(seasons: list[int] | None = None) -> pd.DataFrame:
    """Fallback target quality from nflverse play-by-play (pre-NGS)."""
    seasons = seasons or DEFAULT_ETL_SEASONS
    nfl = _import_nfl_data_py()

    pbp = nfl.import_pbp_data(
        years=seasons,
        columns=[
            "season", "week", "receiver_player_id", "receiver",
            "air_yards", "cpoe", "epa", "xyac_epa", "pass_touchdown", "pass",
        ],
        downcast=True,
    )
    pbp = pbp[pbp["receiver_player_id"].notna() & (pbp["pass"] == 1)].copy()
    pbp["target_quality_raw"] = (
        pbp["air_yards"].fillna(0) * 0.05
        + pbp["cpoe"].fillna(0) * 0.1
        + pbp["xyac_epa"].fillna(0)
        + pbp["epa"].fillna(0)
    )

    agg = (
        pbp.groupby(["season", "week", "receiver_player_id", "receiver"], as_index=False)
        .agg(
            targets=("pass", "count"),
            avg_air_yards=("air_yards", "mean"),
            avg_cpoe=("cpoe", "mean"),
            target_quality_score=("target_quality_raw", "mean"),
            td_rate=("pass_touchdown", "mean"),
        )
        .rename(columns={"receiver_player_id": "player_id"})
    )
    std = agg["target_quality_score"].std()
    if std and std > 0:
        agg["target_quality_score"] = (
            (agg["target_quality_score"] - agg["target_quality_score"].mean()) / std
        ).clip(-3, 3)
    agg["data_source"] = "pbp_proxy"
    return agg


def build_target_quality(seasons: list[int] | None = None) -> pd.DataFrame:
    """Prefer NGS tracking features; fall back to pbp proxies."""
    ngs = build_ngs_features()
    if not ngs.empty:
        ngs = ngs.copy()
        ngs["data_source"] = "ngs_tracking"
        if "receiver" not in ngs.columns:
            ngs["receiver"] = ngs["player_id"]
        return ngs
    return build_pbp_target_quality(seasons)


def merge_target_quality_into_wr_features(
    wr_df: pd.DataFrame,
    target_quality: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Merge rolling target quality / NGS metrics into WR training rows."""
    tq = target_quality if target_quality is not None else build_target_quality()
    if tq.empty:
        return wr_df

    merge_cols = ["player_id", "season", "week"]
    metric_cols = [
        c
        for c in (
            "target_quality_score",
            "separation_at_throw",
            "defender_closing_speed",
        )
        if c in tq.columns
    ]
    merged = wr_df.merge(tq[merge_cols + metric_cols], on=merge_cols, how="left")

    for col in metric_cols:
        merged[col] = merged[col].fillna(0)
        merged = add_rolling_averages(merged, "player_id", [col])
        if col == "target_quality_score" and "target_quality_score_avg" in merged.columns:
            merged["target_quality_avg"] = merged["target_quality_score_avg"]
        if col == "separation_at_throw" and "separation_at_throw_avg" in merged.columns:
            pass  # already named correctly
        if col == "defender_closing_speed" and "defender_closing_speed_avg" in merged.columns:
            pass

    return merged.fillna(0)


def save_target_quality_report(output_dir: Path | None = None) -> Path:
    output_dir = output_dir or BDB_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    ngs_path = save_ngs_features(output_dir)
    tq = build_target_quality()
    out_path = output_dir / "target_quality_scores.csv"
    tq.to_csv(out_path, index=False)

    name_col = "receiver" if "receiver" in tq.columns else "player_id"
    leaders = (
        tq.groupby([name_col, "season"])
        .agg(
            avg_tq=("target_quality_score", "mean"),
            plays=("target_quality_score", "count"),
        )
        .reset_index()
        .query("plays >= 20")
        .sort_values("avg_tq", ascending=False)
        .head(25)
    )
    leaders.to_csv(output_dir / "target_quality_leaders.csv", index=False)

    source = tq["data_source"].iloc[0] if "data_source" in tq.columns and len(tq) else "unknown"
    readme = output_dir / "README.md"
    readme.write_text(
        f"""# BDB Companion: Target Quality

**Data source:** `{source}`

## Files
- `target_quality_scores.csv` — weekly receiver target quality
- `target_quality_leaders.csv` — season leaders
- `ngs_tracking_features.csv` — NGS-only features (when raw tracking present)

## NGS setup
Place BDB 2026 tracking CSVs/parquet in `data/raw/ngs/` then run:
```bash
python -m bdb_companion.target_quality
```
"""
    )
    print(f"Wrote {out_path} ({len(tq):,} rows, source={source})")
    if ngs_path:
        print(f"NGS features: {ngs_path}")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build target quality / NGS metrics")
    parser.add_argument("--output-dir", type=Path, default=BDB_DIR)
    args = parser.parse_args()
    save_target_quality_report(args.output_dir)


if __name__ == "__main__":
    main()
