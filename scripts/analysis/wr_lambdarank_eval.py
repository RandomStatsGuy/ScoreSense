"""Walk-forward eval: sklearn P50 baseline vs LightGBM lambdarank P50."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.products.accuracy_report import _load_position_df
from src.analytics.upside_eval import backtest_one_season_with_quantiles
from src.pipeline.backtest import compute_metrics, top_n_accuracy
from src.config import ANALYTICS_DIR, PROCESSED_DATA_DIR
from src.core.memory_utils import release_memory
from src.ml.training_config import (
    DEFAULT_TRAINING_CONFIG,
    WR_P50_LAMBDARANK,
    WR_P50_LAMBDARANK_LEGACY,
    get_training_config,
)

DEFAULT_SEASONS = [2019, 2020, 2021, 2022, 2023, 2024]
HOLDOUT = 2024
SPEARMAN_TARGET = 0.58


def _eval_config(cfg_name: str, training_config, seasons: list[int], base_df: pd.DataFrame) -> dict:
    frames = []
    by_season = {}
    for season in seasons:
        frame = backtest_one_season_with_quantiles(
            "wr",
            season,
            PROCESSED_DATA_DIR,
            df=base_df,
            training_config=training_config,
        )
        if frame.empty:
            continue
        m = compute_metrics(frame["Fpts"], frame["model_pred"])
        top12 = top_n_accuracy(frame, "model_pred", 12)
        by_season[str(season)] = {
            **{k: round(v, 4) if isinstance(v, float) else v for k, v in m.items()},
            "top12_hit_rate": round(top12, 4),
        }
        frames.append(frame)
        del frame
        release_memory()

    pooled = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    pooled_m = compute_metrics(pooled["Fpts"], pooled["model_pred"]) if not pooled.empty else {}
    pooled_top12 = top_n_accuracy(pooled, "model_pred", 12) if not pooled.empty else float("nan")
    del frames, pooled
    release_memory()

    holdout = by_season.get(str(HOLDOUT), {})
    return {
        "config": cfg_name,
        "2024_holdout": {
            "spearman": holdout.get("spearman"),
            "top12_hit_rate": holdout.get("top12_hit_rate"),
            "mae": holdout.get("mae"),
        },
        "pooled": {
            "spearman": round(pooled_m.get("spearman", float("nan")), 4),
            "top12_hit_rate": round(pooled_top12, 4),
            "mae": round(pooled_m.get("mae", float("nan")), 4),
        },
        "by_season": by_season,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="WR lambdarank P50 walk-forward eval")
    parser.add_argument("--seasons", type=int, nargs="+", default=DEFAULT_SEASONS)
    parser.add_argument(
        "--configs",
        nargs="+",
        default=["default", "wr_p50_lambdarank", "wr_p50_lambdarank_legacy"],
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ANALYTICS_DIR / "wr_lambdarank_eval.json",
    )
    args = parser.parse_args()

    base_df = _load_position_df("wr", PROCESSED_DATA_DIR).sort_values(["season", "week"])
    results = []
    for name in args.configs:
        cfg = get_training_config(name)
        print(f"Evaluating {name}...")
        results.append(_eval_config(name, cfg, args.seasons, base_df))
    del base_df
    release_memory()

    baseline = next(r for r in results if r["config"] == "default")
    tuned = next((r for r in results if r["config"] == "wr_p50_lambdarank"), results[-1])
    base_s = baseline["2024_holdout"].get("spearman") or float("nan")
    base_top12 = baseline["2024_holdout"].get("top12_hit_rate") or float("nan")
    rank_s = tuned["2024_holdout"].get("spearman") or float("nan")
    rank_top12 = tuned["2024_holdout"].get("top12_hit_rate") or float("nan")

    comparison = {
        "spearman_target": SPEARMAN_TARGET,
        "baseline_2024_spearman": base_s,
        "baseline_2024_top12_hit_rate": base_top12,
        "lambdarank_2024_spearman": rank_s,
        "lambdarank_2024_top12_hit_rate": rank_top12,
        "spearman_delta": round(rank_s - base_s, 4) if rank_s == rank_s and base_s == base_s else None,
        "top12_delta": round(rank_top12 - base_top12, 4)
        if rank_top12 == rank_top12 and base_top12 == base_top12
        else None,
        "gate_passed": rank_s > SPEARMAN_TARGET if rank_s == rank_s else False,
        "note": "Lambdarank MAE is not meaningful — scores are relevance ranks, not Fpts.",
        "configs": results,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(comparison, indent=2))
    print(json.dumps(comparison, indent=2))
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
