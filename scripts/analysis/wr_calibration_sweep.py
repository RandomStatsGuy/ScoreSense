"""Walk-forward WR calibration preset comparison (2022–2024 fast slice)."""

from __future__ import annotations

import argparse
import json

import numpy as np

from src.analytics.upside_eval import build_upside_report
from src.ml.training_config import CALIBRATION_PRESETS, DEFAULT_TRAINING_CONFIG


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare WR calibration training presets")
    parser.add_argument(
        "--configs",
        nargs="+",
        default=[
            "default",
            "wr_p90_boom_2",
            "wr_p90_boom_3",
            "wr_p90_boom_5",
            "wr_p90_depth_5",
            "wr_p90_boom_3_depth_5",
        ],
        choices=sorted(CALIBRATION_PRESETS.keys()),
    )
    parser.add_argument("--seasons", type=int, nargs="+", default=[2022, 2023, 2024])
    args = parser.parse_args()

    baseline = build_upside_report(
        "wr",
        test_seasons=args.seasons,
        training_config=DEFAULT_TRAINING_CONFIG,
    )
    baseline_spearman = float(
        np.nanmean([s.get("spearman", float("nan")) for s in baseline["season_detail"]])
    )

    rows = []
    for name in args.configs:
        cfg = CALIBRATION_PRESETS[name]
        report = build_upside_report("wr", test_seasons=args.seasons, training_config=cfg)
        summary = report["summary"]
        spearman = float(
            np.nanmean([s.get("spearman", float("nan")) for s in report["season_detail"]])
        )
        rows.append(
            {
                "config": name,
                "avg_mae": summary["avg_mae"],
                "avg_boom_recall": summary["avg_boom_recall"],
                "avg_boom_p90_coverage": summary["avg_boom_p90_coverage"],
                "avg_composite": summary["avg_composite_score"],
                "avg_spearman": round(spearman, 4),
                "spearman_delta_vs_default": round(spearman - baseline_spearman, 4),
            }
        )

    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
