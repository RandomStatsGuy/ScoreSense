"""Walk-forward P90 calibration precision reports (position-agnostic)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from src.products.accuracy_report import _load_position_df
from src.analytics.upside_eval import (
    backtest_one_season_with_quantiles,
    boom_recall,
    composite_score,
    compute_metrics,
    interval_precision_metrics,
)
from src.config import PROCESSED_DATA_DIR
from src.core.memory_utils import release_memory
from src.ml.training_config import get_training_config


def _aggregate(rows: list[dict]) -> dict:
    if not rows:
        return {}
    keys = [
        "mae",
        "spearman",
        "boom_recall",
        "boom_p90_coverage",
        "false_ceiling_rate",
        "avg_interval_width",
        "median_interval_width",
        "avg_p90",
        "avg_p90_non_boom",
        "composite_score",
    ]
    out: dict = {}
    for key in keys:
        vals = [r[key] for r in rows if key in r and r[key] == r[key]]
        out[f"avg_{key}"] = round(float(np.mean(vals)), 4) if vals else float("nan")
    return out


def build_calibration_precision_report(
    configs: list[str],
    test_seasons: list[int],
    position: str = "wr",
    data_dir: Path | None = None,
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    base_df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    reports: dict[str, dict] = {}
    for name in configs:
        cfg = get_training_config(name)
        season_rows = []
        frames = []

        for season in test_seasons:
            frame = backtest_one_season_with_quantiles(
                position,
                season,
                data_dir,
                df=base_df,
                training_config=cfg,
            )
            if frame.empty:
                release_memory()
                continue

            mae_metrics = compute_metrics(frame["Fpts"], frame["model_pred"])
            precision = interval_precision_metrics(frame, position)
            recall = boom_recall(frame, position)
            composite = composite_score(mae_metrics["mae"], recall)

            season_rows.append(
                {
                    "season": season,
                    **mae_metrics,
                    "boom_recall": recall,
                    "composite_score": composite,
                    **precision,
                }
            )
            frames.append(frame)
            del frame
            release_memory()

        combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        del frames
        combined_precision = interval_precision_metrics(combined, position) if not combined.empty else {}

        reports[name] = {
            "training_config": name,
            "seasons": test_seasons,
            "season_detail": season_rows,
            "summary": {
                **_aggregate(season_rows),
                **{f"pooled_{k}": v for k, v in combined_precision.items()},
            },
        }
        del combined
        release_memory()

    del base_df
    release_memory()
    return reports
