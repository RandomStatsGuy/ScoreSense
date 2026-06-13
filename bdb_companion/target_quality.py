"""
Big Data Bowl 2026 companion: target quality metrics for receivers.

This module scaffolds tracking-derived features that can be merged into
ScoreSense WR projections once NGS/BDB tracking data is available.

BDB 2026 task: predict player movement after the ball is thrown using
pre-pass tracking data. We derive "target quality" proxies from available
nflverse pass play data as a bridge until full tracking is loaded.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from src.config import BDB_DIR, DEFAULT_TRAIN_SEASONS


def _import_nfl_data_py():
    import nfl_data_py as nfl
    return nfl


def build_pass_target_quality(seasons: list[int] | None = None) -> pd.DataFrame:
    """
    Build receiver target quality scores from nflverse play-by-play.

    Proxies for BDB tracking concepts:
    - air_yards: depth of target (throw difficulty)
    - cpoe: completion probability over expected (QB accuracy context)
    - yards_after_catch: YAC opportunity
    """
    seasons = seasons or DEFAULT_TRAIN_SEASONS + [2024]
    nfl = _import_nfl_data_py()

    pbp = nfl.import_pbp_data(
        years=seasons,
        columns=[
            "season",
            "week",
            "passer_player_id",
            "passer",
            "receiver_player_id",
            "receiver",
            "receiver_player_name",
            "air_yards",
            "yards_after_catch",
            "complete_pass",
            "pass_touchdown",
            "cpoe",
            "epa",
            "xyac_epa",
            "down",
            "ydstogo",
            "pass",
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
        pbp.groupby(
            ["season", "week", "receiver_player_id", "receiver", "receiver_player_name"],
            as_index=False,
        )
        .agg(
            targets=("complete_pass", "count"),
            avg_air_yards=("air_yards", "mean"),
            avg_cpoe=("cpoe", "mean"),
            avg_xyac_epa=("xyac_epa", "mean"),
            target_quality_score=("target_quality_raw", "mean"),
            td_rate=("pass_touchdown", "mean"),
        )
    )
    agg["target_quality_score"] = (
        agg["target_quality_score"] - agg["target_quality_score"].mean()
    ) / agg["target_quality_score"].std()
    agg["target_quality_score"] = agg["target_quality_score"].fillna(0).clip(-3, 3)

    return agg.sort_values(["season", "week", "target_quality_score"], ascending=False)


def merge_target_quality_into_wr_features(
    wr_df: pd.DataFrame,
    target_quality: pd.DataFrame,
) -> pd.DataFrame:
    """Merge rolling target quality into WR training/inference rows."""
    tq = target_quality.rename(
        columns={
            "receiver_player_id": "player_id",
            "target_quality_score": "target_quality_lead",
        }
    )
    merged = wr_df.merge(
        tq[["player_id", "season", "week", "target_quality_lead", "avg_air_yards"]],
        on=["player_id", "season", "week"],
        how="left",
    )
    merged["target_quality_lead"] = merged["target_quality_lead"].fillna(0)
    merged["target_quality_avg"] = (
        merged.groupby("player_id")["target_quality_lead"]
        .apply(lambda s: s.shift(1).expanding(min_periods=1).mean())
        .reset_index(level=0, drop=True)
    )
    return merged.fillna(0)


def save_target_quality_report(output_dir: Path | None = None) -> Path:
    output_dir = output_dir or BDB_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    tq = build_pass_target_quality()
    out_path = output_dir / "target_quality_scores.csv"
    tq.to_csv(out_path, index=False)

    leaders = (
        tq.groupby(["receiver", "season"])
        .agg(avg_tq=("target_quality_score", "mean"), targets=("targets", "sum"))
        .reset_index()
        .query("targets >= 50")
        .sort_values("avg_tq", ascending=False)
        .head(25)
    )
    leaders_path = output_dir / "target_quality_leaders.csv"
    leaders.to_csv(leaders_path, index=False)

    readme = output_dir / "README.md"
    readme.write_text(
        """# BDB Companion: Target Quality

This folder supports a Big Data Bowl-style analytics project linked to ScoreSense.

## Concept
**Target Quality Score** combines air yards, CPOE, and expected YAC from nflverse
play-by-play as a proxy for the separation/throw-quality metrics available in
full NGS tracking data.

## Files
- `target_quality_scores.csv` — weekly receiver target quality
- `target_quality_leaders.csv` — season leaders (min 50 targets)

## Next steps with BDB 2026 NGS data
1. Replace proxy metrics with separation at throw and defender closing speed
2. Build broadcast visualization of predicted vs actual in-air movement
3. Feed `target_quality_avg` into the ScoreSense WR model as a feature

## Run
```bash
python -m bdb_companion.target_quality
```
"""
    )
    print(f"Wrote {out_path} ({len(tq):,} rows)")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build BDB target quality metrics")
    parser.add_argument("--output-dir", type=Path, default=BDB_DIR)
    args = parser.parse_args()
    save_target_quality_report(args.output_dir)


if __name__ == "__main__":
    main()
