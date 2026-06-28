"""Compare ScoreSense residuals vs baselines to surface feature-engineering gaps."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.products.accuracy_report import backtest_one_season
from src.config import ANALYTICS_DIR, DEFAULT_ACCURACY_SEASONS, PROCESSED_DATA_DIR

DEFAULT_OUTPUT = ANALYTICS_DIR / "projection_gap_report.json"
GAP_THRESHOLD = 2.0

FEATURE_BUCKETS = {
    "target_share_avg": [0.15, 0.22],
    "offense_snaps_avg": [30, 45],
    "implied_team_total_avg": [21, 24],
    "carry_share_avg": [0.35, 0.55],
}


def _bucket_label(col: str, value: float) -> str:
    bounds = FEATURE_BUCKETS.get(col)
    if bounds is None or not np.isfinite(value):
        return "unknown"
    lo, hi = bounds
    if value < lo:
        return f"low_{col}"
    if value > hi:
        return f"high_{col}"
    return f"mid_{col}"


def build_gap_frame(
    position: str,
    seasons: list[int],
    gap_threshold: float = GAP_THRESHOLD,
) -> pd.DataFrame:
    frames = []
    for season in seasons:
        frame = backtest_one_season(position, season, PROCESSED_DATA_DIR, include_espn=True)
        if frame.empty:
            continue
        frame = frame.copy()
        frame["ss_err"] = frame["model_pred"] - frame["Fpts"]
        frame["ss_abs_err"] = frame["ss_err"].abs()
        frame["composite_err"] = frame["site_composite_proj"] - frame["Fpts"]
        frame["composite_abs_err"] = frame["composite_err"].abs()
        frame["composite_beats_ss"] = frame["composite_abs_err"] + gap_threshold < frame["ss_abs_err"]
        if "espn_proj" in frame.columns:
            frame["espn_abs_err"] = (frame["espn_proj"] - frame["Fpts"]).abs()
            frame["espn_beats_ss"] = frame["espn_abs_err"] + gap_threshold < frame["ss_abs_err"]
        else:
            frame["espn_beats_ss"] = False
        if "fantasypros_proj" in frame.columns:
            frame["fp_abs_err"] = (frame["fantasypros_proj"] - frame["Fpts"]).abs()
            frame["fp_beats_ss"] = frame["fp_abs_err"] + gap_threshold < frame["ss_abs_err"]
        else:
            frame["fp_beats_ss"] = False
        frames.append(frame)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def summarize_gaps(df: pd.DataFrame, position: str) -> dict:
    if df.empty:
        return {"position": position, "n": 0, "slices": []}

    slices = []
    for col in FEATURE_BUCKETS:
        if col not in df.columns:
            continue
        tagged = df.assign(bucket=df[col].map(lambda v: _bucket_label(col, float(v) if pd.notna(v) else float("nan"))))
        for bucket, group in tagged.groupby("bucket"):
            if bucket == "unknown" or len(group) < 25:
                continue
            comp_wins = group["composite_beats_ss"].mean()
            espn_wins = group["espn_beats_ss"].mean() if "espn_beats_ss" in group.columns else float("nan")
            fp_wins = group["fp_beats_ss"].mean() if "fp_beats_ss" in group.columns else float("nan")
            slices.append(
                {
                    "feature": col,
                    "bucket": bucket,
                    "n": int(len(group)),
                    "avg_ss_abs_err": round(float(group["ss_abs_err"].mean()), 3),
                    "avg_composite_abs_err": round(float(group["composite_abs_err"].mean()), 3),
                    "composite_beats_ss_rate": round(float(comp_wins), 3),
                    "espn_beats_ss_rate": round(float(espn_wins), 3) if pd.notna(espn_wins) else None,
                    "fp_beats_ss_rate": round(float(fp_wins), 3) if pd.notna(fp_wins) else None,
                    "ss_mean_bias": round(float(group["ss_err"].mean()), 3),
                }
            )

    slices.sort(key=lambda s: s["composite_beats_ss_rate"], reverse=True)
    return {
        "position": position,
        "n": int(len(df)),
        "gap_threshold_pts": GAP_THRESHOLD,
        "overall_composite_beats_ss_rate": round(float(df["composite_beats_ss"].mean()), 3),
        "overall_espn_beats_ss_rate": round(float(df["espn_beats_ss"].mean()), 3)
        if "espn_beats_ss" in df.columns
        else None,
        "overall_fp_beats_ss_rate": round(float(df["fp_beats_ss"].mean()), 3)
        if "fp_beats_ss" in df.columns
        else None,
        "slices": slices[:12],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Projection gap analysis vs baselines")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=DEFAULT_ACCURACY_SEASONS,
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    positions = ("qb", "rb", "wr") if args.position == "all" else (args.position,)
    report = {"seasons": args.seasons, "positions": {}}
    for pos in positions:
        frame = build_gap_frame(pos, args.seasons)
        report["positions"][pos] = summarize_gaps(frame, pos)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2))
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
