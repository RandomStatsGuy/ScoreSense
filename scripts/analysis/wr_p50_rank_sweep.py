"""
Walk-forward WR P50 hyperparameter regularization sweep.

Overrides apply strictly to τ=0.5; P10/P90 use default regressors (isolated from
production wr_model_calibrated.joblib P90 boom weights).

Success gate: 2024 holdout Spearman > 0.58, MAE within +0.05 of baseline.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.products.accuracy_report import _load_position_df
from src.analytics.upside_eval import backtest_one_season_with_quantiles
from src.pipeline.backtest import compute_metrics
from src.config import ANALYTICS_DIR, PROCESSED_DATA_DIR
from src.core.memory_utils import release_memory
from src.ml.training_config import CALIBRATION_PRESETS, DEFAULT_TRAINING_CONFIG, get_training_config

MAE_GUARDRAIL = 0.05
SPEARMAN_TARGET = 0.58
DEFAULT_SEASONS = [2019, 2020, 2021, 2022, 2023, 2024]
HOLDOUT_SEASON = 2024

P50_SWEEP_CONFIGS = [
    "default",
    "wr_p50_depth_3",
    "wr_p50_min_leaf_20",
    "wr_p50_lr_03",
    "wr_p50_regularized_combo",
]


def _metrics_block(df: pd.DataFrame) -> dict[str, float]:
    if df.empty:
        return {"spearman": float("nan"), "mae": float("nan"), "n": 0}
    m = compute_metrics(df["Fpts"], df["model_pred"])
    return {"spearman": round(m["spearman"], 4), "mae": round(m["mae"], 4), "n": int(m["n"])}


def evaluate_p50_config(
    config_name: str,
    seasons: list[int],
    base_df: pd.DataFrame,
) -> dict:
    cfg = get_training_config(config_name)
    season_frames: list[pd.DataFrame] = []
    by_season: dict[str, dict] = {}

    for season in seasons:
        frame = backtest_one_season_with_quantiles(
            "wr",
            season,
            PROCESSED_DATA_DIR,
            df=base_df,
            training_config=cfg,
        )
        if frame.empty:
            continue
        by_season[str(season)] = _metrics_block(frame)
        season_frames.append(frame)
        del frame
        release_memory()

    pooled = pd.concat(season_frames, ignore_index=True) if season_frames else pd.DataFrame()
    del season_frames
    release_memory()

    holdout = by_season.get(str(HOLDOUT_SEASON), {"spearman": float("nan"), "mae": float("nan")})
    pooled_metrics = _metrics_block(pooled)
    del pooled

    return {
        "training_config": config_name,
        "2024_holdout": holdout,
        "pooled_6_season": pooled_metrics,
        "by_season": by_season,
    }


def run_p50_sweep(
    configs: list[str],
    seasons: list[int],
) -> dict:
    base_df = _load_position_df("wr", PROCESSED_DATA_DIR).sort_values(["season", "week"])
    results: dict[str, dict] = {}

    for config_name in configs:
        print(f"Evaluating {config_name}...")
        results[config_name] = evaluate_p50_config(config_name, seasons, base_df)
        release_memory()

    del base_df
    release_memory()
    return results


def _guardrail_status(mae: float, baseline_mae: float) -> str:
    if mae != mae or baseline_mae != baseline_mae:
        return "UNKNOWN"
    return "PASSED" if mae - baseline_mae <= MAE_GUARDRAIL else "FAILED (MAE REGRESSION)"


def _spearman_gate(spearman: float) -> str:
    if spearman != spearman:
        return "UNKNOWN"
    return "PASSED" if spearman > SPEARMAN_TARGET else "BELOW TARGET"


def print_summary(results: dict) -> None:
    baseline_mae = results.get("default", {}).get("2024_holdout", {}).get("mae", float("nan"))
    print("\n=== P50 RANK SWEEP READOUT ===")
    print(
        f"{'Config':<28} | {'2024 Spearman':<14} | {'2024 MAE':<10} | "
        f"{'Pooled Spearman':<16} | {'MAE Guard':<22} | {'Spearman Gate'}"
    )
    print("-" * 110)
    for cfg, data in results.items():
        h24 = data["2024_holdout"]
        pooled = data["pooled_6_season"]
        print(
            f"{cfg:<28} | {h24.get('spearman', float('nan')):<14} | "
            f"{h24.get('mae', float('nan')):<10} | "
            f"{pooled.get('spearman', float('nan')):<16} | "
            f"{_guardrail_status(h24.get('mae', float('nan')), baseline_mae):<22} | "
            f"{_spearman_gate(h24.get('spearman', float('nan')))}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="WR P50 regularization rank sweep")
    parser.add_argument(
        "--configs",
        nargs="+",
        default=P50_SWEEP_CONFIGS,
        choices=sorted(CALIBRATION_PRESETS.keys()),
    )
    parser.add_argument("--seasons", type=int, nargs="+", default=DEFAULT_SEASONS)
    parser.add_argument(
        "--output",
        type=Path,
        default=ANALYTICS_DIR / "wr_p50_rank_sweep_results.json",
    )
    args = parser.parse_args()

    results = run_p50_sweep(args.configs, args.seasons)
    baseline = results.get("default", {})
    payload = {
        "seasons": args.seasons,
        "holdout_season": HOLDOUT_SEASON,
        "mae_guardrail": MAE_GUARDRAIL,
        "spearman_target": SPEARMAN_TARGET,
        "baseline_2024_mae": baseline.get("2024_holdout", {}).get("mae"),
        "results": results,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2))
    print_summary(results)
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
