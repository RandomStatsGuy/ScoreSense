"""SCORE-3: calibrate risk_z as a week-to-week variance signal before shipping RAAV.

Uses archived weekly actuals: players flagged high-risk (risk_z above the
position median, computed from week-1 schedule-aware season P10/P50/P90) should
realize higher within-season week-to-week fantasy-point variance than low-risk
peers at a similar median projection.

This is the gating check before shipping RISK_WEIGHT != 0 as a default-on
feature. Run via:

    PYTHONPATH=. .venv/bin/python -m src.analytics.raav_backtest --position rb
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.analytics.season_long_eval import MIN_GAMES_PLAYED, _draft_cohort_player_ids
from src.analytics.season_quantile_coverage_eval import _week1_frame
from src.config import ANALYTICS_DIR, DEFAULT_ACCURACY_SEASONS, PROCESSED_DATA_DIR
from src.core.projection_context import REGULAR_SEASON_MAX_WEEK
from src.draft_hub.auction_values import RISK_WEIGHT, risk_z_scores, season_cv
from src.pipeline.backtest_checkpoint import walk_forward_split
from src.products.accuracy_report import _load_position_df
from src.projections.season_quantiles import (
    METHOD_MC_SCHEDULE_V1,
    SeasonQuantileParams,
    aggregate_season_quantiles_mc,
)

RAAV_BACKTEST_PATH = ANALYTICS_DIR / "raav_backtest.json"


def _weekly_actual_variance(df: pd.DataFrame, season: int) -> pd.DataFrame:
    """Per-player week-to-week Fpts std and mean for a season."""
    reg = df[(df["season"] == season) & (df["week"].between(1, REGULAR_SEASON_MAX_WEEK))]
    if reg.empty:
        return pd.DataFrame(columns=["player_id", "weekly_std", "weekly_mean", "games_played"])
    return (
        reg.groupby("player_id", as_index=False)
        .agg(
            weekly_std=("Fpts", "std"),
            weekly_mean=("Fpts", "mean"),
            games_played=("week", "nunique"),
        )
        .assign(season=season)
    )


def calibration_for_season(
    df: pd.DataFrame,
    position: str,
    season: int,
    *,
    params: SeasonQuantileParams | None = None,
    draft_cohort_only: bool = True,
) -> dict:
    """Compare realized weekly variance for high vs low risk_z cohorts."""
    _, test_df_slice = walk_forward_split(df, season)
    week1 = _week1_frame(df, test_df_slice, position, season)
    if week1.empty:
        return {"season": season, "position": position, "n": 0}

    result = aggregate_season_quantiles_mc(
        week1["q10"],
        week1["q50"],
        week1["q90"],
        week1["team"],
        week1["games_expected"],
        season,
        params=params,
    )
    week1 = week1.assign(
        season_p10=result.season_p10,
        season_p50=result.season_p50,
        season_p90=result.season_p90,
    )
    week1["cv"] = [
        season_cv(p10, p50, p90)
        for p10, p50, p90 in zip(week1["season_p10"], week1["season_p50"], week1["season_p90"])
    ]
    week1["risk_z"] = risk_z_scores(week1["cv"].tolist())

    actual_var = _weekly_actual_variance(df, season)
    frame = week1.merge(actual_var, on="player_id", how="inner")
    frame = frame[frame["games_played"] >= MIN_GAMES_PLAYED]
    frame = frame[frame["weekly_std"].notna()]
    if draft_cohort_only:
        cohort = _draft_cohort_player_ids(df, position, season)
        if cohort:
            frame = frame[frame["player_id"].astype(str).isin(cohort)]

    if len(frame) < 8:
        return {"season": season, "position": position, "n": int(len(frame))}

    # Match high/low risk cohorts on median projection bands (terciles of season_p50).
    frame = frame.copy()
    frame["median_band"] = pd.qcut(frame["season_p50"], q=3, labels=False, duplicates="drop")
    risk_med = float(frame["risk_z"].median())
    high = frame[frame["risk_z"] > risk_med]
    low = frame[frame["risk_z"] <= risk_med]

    band_deltas: list[float] = []
    for band in sorted(frame["median_band"].dropna().unique()):
        hi_band = high[high["median_band"] == band]
        lo_band = low[low["median_band"] == band]
        if len(hi_band) < 2 or len(lo_band) < 2:
            continue
        band_deltas.append(float(hi_band["weekly_std"].mean() - lo_band["weekly_std"].mean()))

    high_std = float(high["weekly_std"].mean()) if len(high) else None
    low_std = float(low["weekly_std"].mean()) if len(low) else None
    delta = (high_std - low_std) if high_std is not None and low_std is not None else None
    median_matched_delta = float(np.mean(band_deltas)) if band_deltas else None

    return {
        "season": season,
        "position": position,
        "n": int(len(frame)),
        "n_high_risk": int(len(high)),
        "n_low_risk": int(len(low)),
        "risk_z_median": round(risk_med, 4),
        "high_risk_weekly_std": round(high_std, 3) if high_std is not None else None,
        "low_risk_weekly_std": round(low_std, 3) if low_std is not None else None,
        "std_delta": round(delta, 3) if delta is not None else None,
        "median_matched_std_delta": (
            round(median_matched_delta, 3) if median_matched_delta is not None else None
        ),
        "calibrated": bool(median_matched_delta is not None and median_matched_delta > 0),
        "risk_weight": RISK_WEIGHT,
        "method": METHOD_MC_SCHEDULE_V1,
    }


def build_raav_calibration_report(
    position: str,
    seasons: list[int] | None = None,
    *,
    data_dir: Path | None = None,
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    seasons = seasons or DEFAULT_ACCURACY_SEASONS
    df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    by_season = [calibration_for_season(df, position, season) for season in seasons]
    by_season = [r for r in by_season if r.get("n", 0) > 0]
    deltas = [r["median_matched_std_delta"] for r in by_season if r.get("median_matched_std_delta") is not None]
    calibrated_share = (
        round(float(np.mean([1.0 if r.get("calibrated") else 0.0 for r in by_season])), 4)
        if by_season
        else None
    )
    return {
        "position": position,
        "risk_weight": RISK_WEIGHT,
        "seasons": [r["season"] for r in by_season],
        "by_season": by_season,
        "avg_median_matched_std_delta": round(float(np.mean(deltas)), 3) if deltas else None,
        "calibrated_season_share": calibrated_share,
        # Gate: majority of seasons show higher realized variance for high risk_z.
        "gate_pass": bool(calibrated_share is not None and calibrated_share >= 0.6),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="SCORE-3 RAAV risk_z calibration backtest")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument("--seasons", type=int, nargs="+", default=DEFAULT_ACCURACY_SEASONS)
    parser.add_argument("--output", type=Path, default=RAAV_BACKTEST_PATH)
    args = parser.parse_args()

    positions = ["qb", "rb", "wr"] if args.position == "all" else [args.position]
    reports: dict[str, dict] = {}
    for position in positions:
        print(f"Evaluating RAAV risk calibration for {position}...")
        reports[position] = build_raav_calibration_report(position, args.seasons)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(reports, indent=2))
    for position, report in reports.items():
        print(
            f"{position}: avg_std_delta={report['avg_median_matched_std_delta']} "
            f"gate_pass={report['gate_pass']}"
        )


if __name__ == "__main__":
    main()
