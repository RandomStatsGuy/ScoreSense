"""Screen composite ranking keys on cached walk-forward WR predictions (no retrain)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from src.products.accuracy_report import _load_position_df
from src.analytics.upside_eval import (
    backtest_one_season_with_quantiles,
    evaluate_composite_ranking_strategies,
)
from src.config import ANALYTICS_DIR, PROCESSED_DATA_DIR
from src.core.memory_utils import release_memory
from src.ml.training_config import get_training_config


def run_rank_screen(
    seasons: list[int],
    training_config_name: str = "wr_p90_boom_3",
    position: str = "wr",
) -> dict:
    cfg = get_training_config(training_config_name)
    base_df = _load_position_df(position, PROCESSED_DATA_DIR).sort_values(["season", "week"])

    season_results = {}
    frames = []
    for season in seasons:
        frame = backtest_one_season_with_quantiles(
            position,
            season,
            PROCESSED_DATA_DIR,
            df=base_df,
            training_config=cfg,
        )
        if frame.empty:
            continue
        season_results[str(season)] = evaluate_composite_ranking_strategies(frame)
        frames.append(frame)
        del frame
        release_memory()

    pooled = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    del frames, base_df
    release_memory()

    return {
        "training_config": training_config_name,
        "seasons": seasons,
        "by_season": season_results,
        "pooled": evaluate_composite_ranking_strategies(pooled) if not pooled.empty else {},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="WR composite rank Spearman screen")
    parser.add_argument("--seasons", type=int, nargs="+", default=[2024])
    parser.add_argument(
        "--training-config",
        default="wr_p90_boom_3",
        help="Use calibrated P90 from this preset (P50 unchanged vs default)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ANALYTICS_DIR / "wr_composite_rank_screen.json",
    )
    args = parser.parse_args()

    report = run_rank_screen(args.seasons, args.training_config)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2))

    pooled = report.get("pooled", {})
    print(json.dumps(pooled, indent=2))
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
