"""Full walk-forward RB P90 calibration report with precision diagnostics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from src.config import ANALYTICS_DIR
from src.analytics.calibration_precision import build_calibration_precision_report


def main() -> None:
    parser = argparse.ArgumentParser(description="RB calibration walk-forward precision")
    parser.add_argument(
        "--configs",
        nargs="+",
        default=["default", "rb_p90_boom_2", "rb_p90_boom_3", "rb_p90_boom_5"],
    )
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=[2019, 2020, 2021, 2022, 2023, 2024],
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ANALYTICS_DIR / "rb_calibration_precision_2019_2024.json",
    )
    args = parser.parse_args()

    reports = build_calibration_precision_report(args.configs, args.seasons, position="rb")

    table = []
    default_summary = reports.get("default", {}).get("summary", {})
    default_fc = default_summary.get("pooled_false_ceiling_rate", float("nan"))
    default_width = default_summary.get("pooled_avg_interval_width", float("nan"))
    default_boom_cov = default_summary.get("pooled_boom_p90_coverage", float("nan"))

    for name, report in reports.items():
        s = report["summary"]
        table.append(
            {
                "config": name,
                "avg_spearman": s.get("avg_spearman"),
                "avg_mae": s.get("avg_mae"),
                "avg_boom_recall": s.get("avg_boom_recall"),
                "pooled_boom_p90_coverage": s.get("pooled_boom_p90_coverage"),
                "boom_p90_coverage_delta": round(
                    (s.get("pooled_boom_p90_coverage") or float("nan")) - default_boom_cov, 4
                )
                if name != "default"
                else 0.0,
                "pooled_false_ceiling_rate": s.get("pooled_false_ceiling_rate"),
                "false_ceiling_delta_vs_default": round(
                    (s.get("pooled_false_ceiling_rate") or float("nan")) - default_fc, 4
                )
                if name != "default"
                else 0.0,
                "pooled_avg_interval_width": s.get("pooled_avg_interval_width"),
                "interval_width_delta_vs_default": round(
                    (s.get("pooled_avg_interval_width") or float("nan")) - default_width, 4
                )
                if name != "default"
                else 0.0,
            }
        )

    payload = {"position": "rb", "comparison": table, "reports": reports}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2))
    print(json.dumps(table, indent=2))
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
