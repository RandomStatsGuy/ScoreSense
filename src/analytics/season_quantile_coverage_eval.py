"""SCORE-2: offline coverage eval for schedule-aware season quantiles.

Walk-forward week-1 (q10, q50, q90) -> `aggregate_season_quantiles_mc` season
P10/P90 -> compare against actual regular-season PPR totals. Reports empirical
interval coverage (share of players whose actual total lands in [P10, P90])
by position, target ~80% per the SCORE-2 acceptance criteria (75-85%).

Reuses the same walk-forward training/backtest infra as
`src.analytics.season_long_eval` so results are consistent with the existing
season-long accuracy report; run via:

    PYTHONPATH=. .venv/bin/python -m src.analytics.season_quantile_coverage_eval --position qb
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.analytics.season_long_eval import MIN_GAMES_PLAYED, _actual_season_totals, _draft_cohort_player_ids
from src.config import ANALYTICS_DIR, DEFAULT_ACCURACY_SEASONS, PROCESSED_DATA_DIR
from src.pipeline.backtest_checkpoint import predict_walk_forward_season, walk_forward_split
from src.products.accuracy_report import _load_position_df
from src.projections.season_blend import expected_preseason_games, prior_year_games_map
from src.projections.season_quantiles import (
    METHOD_INDEPENDENT_SCALE,
    METHOD_MC_SCHEDULE_V1,
    SeasonQuantileParams,
    aggregate_season_quantiles_mc,
    legacy_scale_season_quantiles,
)

SEASON_QUANTILE_COVERAGE_PATH = ANALYTICS_DIR / "season_quantile_coverage.json"


def _week1_frame(df: pd.DataFrame, test_df: pd.DataFrame, position: str, season: int) -> pd.DataFrame:
    """Walk-forward week-1 (player_id, team, q10, q50, q90, games_expected)."""
    train_df, test_df_slice = walk_forward_split(df, season)
    if train_df.empty or test_df_slice.empty:
        return pd.DataFrame()
    qpreds, _ = predict_walk_forward_season(train_df, test_df_slice, position, season)
    week1_mask = (test_df_slice["week"] == 1).to_numpy()
    week1 = test_df_slice.loc[week1_mask, ["player_id", "team"]].reset_index(drop=True)
    q = qpreds.loc[week1_mask, ["q10", "q50", "q90"]].reset_index(drop=True)
    week1 = pd.concat([week1, q], axis=1)
    prior_games = prior_year_games_map(df, season)
    week1["games_expected"] = expected_preseason_games(week1["player_id"], prior_games)
    return week1


def coverage_for_season(
    df: pd.DataFrame,
    position: str,
    season: int,
    *,
    method: str = METHOD_MC_SCHEDULE_V1,
    params: SeasonQuantileParams | None = None,
    draft_cohort_only: bool = True,
) -> dict:
    """Interval-coverage report for one position/season on holdout actuals."""
    _, test_df_slice = walk_forward_split(df, season)
    week1 = _week1_frame(df, test_df_slice, position, season)
    if week1.empty:
        return {"season": season, "position": position, "n": 0, "coverage": None}

    if method == METHOD_MC_SCHEDULE_V1:
        result = aggregate_season_quantiles_mc(
            week1["q10"], week1["q50"], week1["q90"], week1["team"], week1["games_expected"], season, params=params
        )
    else:
        result = legacy_scale_season_quantiles(week1["q10"], week1["q50"], week1["q90"], 17)

    week1 = week1.assign(
        season_p10=result.season_p10,
        season_p50=result.season_p50,
        season_p90=result.season_p90,
    )

    actual = _actual_season_totals(df, season)
    frame = week1.merge(actual, on="player_id", how="inner")
    frame = frame[frame["games_played"] >= MIN_GAMES_PLAYED]
    if draft_cohort_only:
        cohort = _draft_cohort_player_ids(df, position, season)
        if cohort:
            frame = frame[frame["player_id"].astype(str).isin(cohort)]

    if frame.empty:
        return {"season": season, "position": position, "n": 0, "coverage": None}

    within = (frame["actual_total"] >= frame["season_p10"]) & (frame["actual_total"] <= frame["season_p90"])
    return {
        "season": season,
        "position": position,
        "method": method,
        "n": int(len(frame)),
        "coverage": round(float(within.mean()), 4),
        "avg_spread": round(float((frame["season_p90"] - frame["season_p10"]).mean()), 1),
        "below_p10_rate": round(float((frame["actual_total"] < frame["season_p10"]).mean()), 4),
        "above_p90_rate": round(float((frame["actual_total"] > frame["season_p90"]).mean()), 4),
    }


def build_coverage_report(
    position: str,
    seasons: list[int] | None = None,
    *,
    data_dir: Path | None = None,
    method: str = METHOD_MC_SCHEDULE_V1,
    compare_legacy: bool = True,
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    seasons = seasons or DEFAULT_ACCURACY_SEASONS
    df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    by_season = [coverage_for_season(df, position, season, method=method) for season in seasons]
    by_season = [r for r in by_season if r.get("n", 0) > 0]
    coverages = [r["coverage"] for r in by_season if r.get("coverage") is not None]
    avg_coverage = round(float(np.mean(coverages)), 4) if coverages else None

    report = {
        "position": position,
        "method": method,
        "seasons": [r["season"] for r in by_season],
        "by_season": by_season,
        "avg_coverage": avg_coverage,
        "target_coverage": 0.80,
        "within_target_band": (
            bool(0.75 <= avg_coverage <= 0.85) if avg_coverage is not None else None
        ),
    }
    if compare_legacy:
        legacy_by_season = [
            coverage_for_season(df, position, season, method=METHOD_INDEPENDENT_SCALE) for season in seasons
        ]
        legacy_by_season = [r for r in legacy_by_season if r.get("n", 0) > 0]
        legacy_coverages = [r["coverage"] for r in legacy_by_season if r.get("coverage") is not None]
        report["legacy_avg_coverage"] = round(float(np.mean(legacy_coverages)), 4) if legacy_coverages else None
        report["legacy_by_season"] = legacy_by_season
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="SCORE-2 season quantile interval-coverage eval")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument("--seasons", type=int, nargs="+", default=DEFAULT_ACCURACY_SEASONS)
    parser.add_argument("--output", type=Path, default=SEASON_QUANTILE_COVERAGE_PATH)
    parser.add_argument("--no-legacy-compare", action="store_true")
    args = parser.parse_args()

    positions = ["qb", "rb", "wr"] if args.position == "all" else [args.position]
    reports = {}
    for position in positions:
        print(f"Evaluating season quantile coverage for {position}...")
        reports[position] = build_coverage_report(
            position, args.seasons, compare_legacy=not args.no_legacy_compare
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(reports, indent=2))
    for position, report in reports.items():
        print(f"{position}: avg_coverage={report['avg_coverage']} (legacy={report.get('legacy_avg_coverage')})")


if __name__ == "__main__":
    main()
