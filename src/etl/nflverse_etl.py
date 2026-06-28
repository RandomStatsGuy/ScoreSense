"""Reproducible nflverse ETL for ScoreSense training data."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import DEFAULT_ETL_SEASONS, DEFAULT_TRAIN_SEASONS, PROCESSED_DATA_DIR, write_parquet
from src.core.memory_utils import release_memory
from src.core.features import (
    FEATURE_REGISTRY,
    add_rolling_averages,
    calc_fantasy_points_ppr,
    get_position_features,
    safe_div,
)

try:
    from src.analytics.candidate_etl import build_candidate_features
    from src.analytics.historical_injury import add_historical_injury_features
except ImportError:
    build_candidate_features = None
    add_historical_injury_features = None

try:
    from bdb_companion.target_quality import merge_target_quality_into_wr_features
except ImportError:
    merge_target_quality_into_wr_features = None


def _import_nfl_data_py():
    try:
        import nfl_data_py as nfl
    except ImportError as exc:
        raise ImportError(
            "nfl_data_py is required. Install with: pip install nfl_data_py"
        ) from exc
    return nfl


def _normalize_weekly_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Align nflverse weekly schemas across player_stats and stats_player_week releases."""
    out = df.copy()
    if "recent_team" in out.columns:
        if "team" not in out.columns:
            out["team"] = out["recent_team"]
        out = out.drop(columns=["recent_team"])
    if "passing_interceptions" in out.columns and "interceptions" not in out.columns:
        out["interceptions"] = out["passing_interceptions"]
    if "opponent_team" in out.columns:
        if "opponent" not in out.columns:
            out["opponent"] = out["opponent_team"]
        out = out.drop(columns=["opponent_team"])
    return out.loc[:, ~out.columns.duplicated()]


def _load_weekly_season(season: int) -> pd.DataFrame:
    nfl = _import_nfl_data_py()
    try:
        return _normalize_weekly_columns(nfl.import_weekly_data(years=[season], downcast=True))
    except Exception:
        alt_url = (
            "https://github.com/nflverse/nflverse-data/releases/download/"
            f"stats_player/stats_player_week_{season}.parquet"
        )
        return _normalize_weekly_columns(pd.read_parquet(alt_url))


def load_weekly_player_stats(seasons: list[int]) -> pd.DataFrame:
    frames = [_load_weekly_season(season) for season in seasons]
    weekly = pd.concat(frames, ignore_index=True)
    if "week" not in weekly.columns:
        raise ValueError("Weekly data missing 'week' column")
    return weekly


def load_schedules(seasons: list[int]) -> pd.DataFrame:
    nfl = _import_nfl_data_py()
    schedules = nfl.import_schedules(years=seasons)
    schedules["gameday"] = pd.to_datetime(schedules["gameday"])
    return schedules


def load_team_epa(seasons: list[int]) -> pd.DataFrame:
    """Aggregate opponent defensive EPA allowed by season/week/team."""
    nfl = _import_nfl_data_py()
    pbp = nfl.import_pbp_data(
        years=seasons,
        columns=[
            "season",
            "week",
            "defteam",
            "epa",
            "play_type",
            "pass",
            "rush",
        ],
        downcast=True,
    )
    pbp = pbp[pbp["play_type"].isin(["pass", "run"])].copy()

    pass_epa = (
        pbp[pbp["pass"] == 1]
        .groupby(["season", "week", "defteam"], as_index=False)["epa"]
        .mean()
        .rename(columns={"defteam": "opponent", "epa": "opponent_pass_epa_allowed"})
    )
    rush_epa = (
        pbp[pbp["rush"] == 1]
        .groupby(["season", "week", "defteam"], as_index=False)["epa"]
        .mean()
        .rename(columns={"defteam": "opponent", "epa": "opponent_rush_epa_allowed"})
    )
    return pass_epa.merge(rush_epa, on=["season", "week", "opponent"], how="outer")


def _position_filter(df: pd.DataFrame, position: str) -> pd.DataFrame:
    pos_map = {
        "qb": ["QB"],
        "rb": ["RB", "FB"],
        "wr": ["WR", "TE"],
    }
    allowed = pos_map[position]
    return df[df["position"].isin(allowed)].copy()


def _team_targets(season_df: pd.DataFrame) -> pd.DataFrame:
    team_col = "team" if "team" in season_df.columns else "recent_team"
    team_week = (
        season_df.groupby(["season", "week", team_col], as_index=False)
        .agg(team_targets=("targets", "sum"), team_carries=("carries", "sum"))
    )
    return season_df.merge(
        team_week,
        on=["season", "week", team_col],
        how="left",
    )


def build_position_dataset(
    weekly: pd.DataFrame,
    schedules: pd.DataFrame,
    team_epa: pd.DataFrame,
    position: str,
) -> pd.DataFrame:
    spec = get_position_features(position)
    df = _position_filter(weekly, position)
    if df.empty:
        return df

    df = df.rename(columns={"opponent_team": "opponent"})
    if "team" not in df.columns and "recent_team" in df.columns:
        df = df.rename(columns={"recent_team": "team"})
    if "opponent" in df.columns and "opponent_team" in df.columns:
        df = df.drop(columns=["opponent_team"])
    df = df.loc[:, ~df.columns.duplicated()]
    df["Fpts"] = calc_fantasy_points_ppr(df)

    numeric_defaults = {
        "completions": 0,
        "attempts": 0,
        "carries": 0,
        "targets": 0,
        "receptions": 0,
        "passing_epa": 0,
        "rushing_epa": 0,
        "receiving_epa": 0,
        "receiving_air_yards": 0,
        "fumbles": 0,
        "fumbles_lost": 0,
    }
    for col, default in numeric_defaults.items():
        if col not in df.columns:
            df[col] = default
        df[col] = df[col].fillna(default)

    df = _team_targets(df)
    df["target_share"] = safe_div(df["targets"], df["team_targets"])
    df["carry_share"] = safe_div(df["carries"], df["team_carries"])
    df["air_yards_share"] = safe_div(
        df["receiving_air_yards"],
        df.groupby(["season", "week", "team"])["receiving_air_yards"].transform("sum"),
    )
    df["wopr"] = 1.5 * df["target_share"] + 0.7 * df["air_yards_share"]

    sched_home = schedules[
        ["season", "week", "home_team", "away_team", "gameday"]
    ].copy()
    sched_home["team"] = sched_home["home_team"]
    sched_home["is_home"] = 1
    sched_away = schedules[
        ["season", "week", "home_team", "away_team", "gameday"]
    ].copy()
    sched_away["team"] = sched_away["away_team"]
    sched_away["is_home"] = 0
    sched_long = pd.concat(
        [
            sched_home[["season", "week", "team", "gameday", "is_home"]],
            sched_away[["season", "week", "team", "gameday", "is_home"]],
        ],
        ignore_index=True,
    )
    df = df.merge(sched_long, on=["season", "week", "team"], how="left")
    df["gameday"] = pd.to_datetime(df["gameday"])
    df = df.sort_values(["player_id", "season", "week"])
    df["days_rest"] = (
        df.groupby("player_id")["gameday"].diff().dt.days.fillna(7).clip(3, 14)
    )

    df = df.merge(
        team_epa,
        left_on=["season", "week", "opponent"],
        right_on=["season", "week", "opponent"],
        how="left",
    )
    df["opponent_pass_epa_allowed"] = df["opponent_pass_epa_allowed"].fillna(0)
    df["opponent_rush_epa_allowed"] = df["opponent_rush_epa_allowed"].fillna(0)

    share_cols = ["target_share", "carry_share", "air_yards_share", "wopr"]
    avg_stat_cols = list(spec.stat_cols)
    df = add_rolling_averages(df, "player_id", avg_stat_cols)
    df = add_rolling_averages(df, "player_id", share_cols)

    rename_map = {
        "passing_tds_avg": "pass_tds_avg",
        "interceptions_avg": "ints_avg",
        "attempts_avg": "pass_attmpt_avg",
        "carries_avg": "rush_attmpt_avg",
        "rushing_tds_avg": "rush_tds_avg",
        "receiving_air_yards_avg": "air_yards_avg",
    }
    df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})

    lead_rename = {c: f"{c}_lead" for c in spec.stat_cols if c in df.columns}
    df = df.rename(columns=lead_rename)

    keep = [
        "player_id",
        "player_name",
        "player_display_name",
        "position",
        "season",
        "week",
        "team",
        "opponent",
        "gameday",
        "Fpts",
        "is_home",
        "days_rest",
        "opponent_pass_epa_allowed",
        "opponent_rush_epa_allowed",
    ]
    keep += [c for c in df.columns if c.endswith("_lead") or c.endswith("_avg")]
    keep = list(dict.fromkeys([c for c in keep if c in df.columns]))
    out = df[keep].copy()
    out = out[out["Fpts"].notna()]
    return out.replace([np.inf, -np.inf], 0).fillna(0)


def build_all_datasets(
    seasons: list[int] | None = None,
    output_dir: Path | None = None,
    enrich_analytics: bool = True,
) -> dict[str, Path]:
    seasons = seasons or DEFAULT_ETL_SEASONS
    output_dir = output_dir or PROCESSED_DATA_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    if enrich_analytics and build_candidate_features is not None:
        print("Building analytics candidate features...")
        for position in FEATURE_REGISTRY:
            build_candidate_features(position, seasons)

    weekly = load_weekly_player_stats(seasons)
    schedules = load_schedules(seasons)
    team_epa = load_team_epa(seasons)

    paths: dict[str, Path] = {}
    for position in FEATURE_REGISTRY:
        dataset = build_position_dataset(weekly, schedules, team_epa, position)
        if enrich_analytics and build_candidate_features is not None:
            from src.analytics.candidate_etl import merge_candidates_into_mlready
            from src.config import CANDIDATE_DATA_DIR

            try:
                path = output_dir / f"{position}_mlready.parquet"
                write_parquet(dataset, path)
                dataset = merge_candidates_into_mlready(position, output_dir, CANDIDATE_DATA_DIR)
            except FileNotFoundError:
                pass
        if enrich_analytics and add_historical_injury_features is not None:
            dataset = add_historical_injury_features(dataset)
        if position == "wr" and merge_target_quality_into_wr_features is not None:
            dataset = merge_target_quality_into_wr_features(dataset)
        path = output_dir / f"{position}_mlready.parquet"
        write_parquet(dataset, path)
        paths[position] = path
        print(f"Wrote {position}: {len(dataset):,} rows -> {path}")
        del dataset
        release_memory()

    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Build nflverse training datasets")
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=DEFAULT_ETL_SEASONS,
        help="Seasons to include",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROCESSED_DATA_DIR,
        help="Output directory for processed datasets",
    )
    args = parser.parse_args()
    build_all_datasets(seasons=args.seasons, output_dir=args.output_dir)


if __name__ == "__main__":
    main()
