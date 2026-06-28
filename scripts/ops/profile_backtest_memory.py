#!/usr/bin/env python3
"""
Measure peak RSS during a forced WR (or QB/RB) walk-forward cache miss.

Bypasses checkpoint files so the run reflects worst-case training memory.
Requires: pip install psutil

Usage:
  PYTHONPATH=. python scripts/profile_backtest_memory.py
  PYTHONPATH=. python scripts/profile_backtest_memory.py --position wr --test-season 2024
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    import psutil
except ImportError as exc:
    raise SystemExit(
        "psutil is required for RSS profiling. Install with: pip install psutil"
    ) from exc

import pandas as pd

from src.pipeline.backtest_checkpoint import REGULAR_WEEKS, walk_forward_split
from src.config import PREDICTION_QUANTILES, PROCESSED_DATA_DIR
from src.core.features import prepare_feature_matrix
from src.core.memory_utils import release_memory
from src.ml.quantile import train_quantile_models


def rss_mb() -> float:
    return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)


def load_position_df(position: str) -> pd.DataFrame:
    parquet = PROCESSED_DATA_DIR / f"{position}_mlready.parquet"
    csv_path = PROCESSED_DATA_DIR / f"{position}_mlready.csv"
    if parquet.exists():
        return pd.read_parquet(parquet)
    if csv_path.exists():
        return pd.read_csv(csv_path)
    raise FileNotFoundError(f"No mlready data for {position} under {PROCESSED_DATA_DIR}")


def profile_cache_miss(position: str = "wr", test_season: int = 2024) -> dict:
    position = position.lower()
    print("=" * 60)
    print(f" BACKTEST MEMORY PROFILE - {position.upper()} (force cache miss)")
    print(f" Test season: {test_season}  |  train pool: season < {test_season}")
    print("=" * 60)

    metrics: dict[str, float] = {}
    start_mem = rss_mb()
    metrics["baseline_mb"] = start_mem
    print(f"[*] Baseline RSS: {start_mem:.2f} MB")

    t0 = time.time()
    df = load_position_df(position).sort_values(["season", "week"])
    post_load = rss_mb()
    metrics["after_load_mb"] = post_load
    metrics["load_delta_mb"] = post_load - start_mem
    disk_mb = (PROCESSED_DATA_DIR / f"{position}_mlready.parquet").stat().st_size / (1024 * 1024)
    print(
        f"[+] Loaded {position} mlready ({len(df):,} rows, {df.shape[1]} cols, "
        f"{disk_mb:.2f} MB on disk). RSS: {post_load:.2f} MB "
        f"(+{metrics['load_delta_mb']:.2f} MB)"
    )

    train_df, test_df = walk_forward_split(df, test_season)
    post_slice = rss_mb()
    metrics["after_slice_mb"] = post_slice
    print(f"[+] Walk-forward slice: train={len(train_df):,}, test={len(test_df):,}. RSS: {post_slice:.2f} MB")

    print("[*] Building feature matrix...")
    X_train = prepare_feature_matrix(train_df, position)
    post_matrix = rss_mb()
    metrics["after_matrix_mb"] = post_matrix
    metrics["matrix_shape_rows"] = float(X_train.shape[0])
    metrics["matrix_shape_cols"] = float(X_train.shape[1])
    print(
        f"[+] Feature matrix {X_train.shape}. RSS: {post_matrix:.2f} MB "
        f"(+{post_matrix - start_mem:.2f} MB from baseline)"
    )

    print(f"[*] Training quantile GBMs {list(PREDICTION_QUANTILES)}...")
    peak_during_train = post_matrix
    models = train_quantile_models(X_train, train_df["Fpts"].values, PREDICTION_QUANTILES)
    post_train = rss_mb()
    peak_during_train = max(peak_during_train, post_train)
    metrics["after_train_mb"] = post_train
    metrics["train_delta_mb"] = post_train - start_mem
    metrics["duration_s"] = time.time() - t0

    print(f"\n[+] Training finished in {metrics['duration_s']:.2f}s")
    print(f"[+] Post-training RSS: {post_train:.2f} MB")
    print(f"[!] Total delta from baseline: {metrics['train_delta_mb']:.2f} MB")

    print("\n[*] Explicit cleanup + gc.collect()...")
    del df, train_df, test_df, X_train, models
    release_memory()
    final_mem = rss_mb()
    metrics["after_cleanup_mb"] = final_mem
    metrics["leak_mb"] = final_mem - start_mem
    print(f"[+] Post-cleanup RSS: {final_mem:.2f} MB")
    print(f"[+] Unrecovered overhead (leak factor): {metrics['leak_mb']:.2f} MB")
    print("=" * 60)

    if metrics["train_delta_mb"] < 250:
        print("Assessment: peak RSS well under 250 MB - memory is not a current bottleneck.")
    elif metrics["train_delta_mb"] < 1024:
        print("Assessment: moderate RSS — fine on 8 GB hosts with headroom for API + worker.")
    else:
        print("Assessment: high RSS — consider streaming reads or narrower feature sets.")

    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Profile walk-forward backtest peak memory")
    parser.add_argument("--position", default="wr", choices=["qb", "rb", "wr"])
    parser.add_argument(
        "--test-season",
        type=int,
        default=2024,
        help="Heaviest train pool is typically the latest test season",
    )
    args = parser.parse_args()
    profile_cache_miss(args.position, args.test_season)


if __name__ == "__main__":
    main()
