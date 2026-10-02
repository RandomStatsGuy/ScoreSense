"""Reproducible nflverse ETL for ScoreSense training data."""

from __future__ import annotations

import argparse
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

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
    from bdb_companion.target_quality import build_target_quality, merge_target_quality_into_wr_features
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
    # nflverse reports separate rushing/receiving/sack fumbles in older schemas
    # and totals in the newer feed. Do not turn every player's fumbles into zero.
    for dest, total, components in (
        ("fumbles", "fumbles_total", ("rushing_fumbles", "receiving_fumbles", "sack_fumbles")),
        ("fumbles_lost", "fumbles_lost_total", ("rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost")),
    ):
        present = [c for c in components if c in out]
        values = out[present].sum(axis=1, min_count=1) if present else pd.Series(np.nan, index=out.index)
        if total in out:
            values = out[total].combine_first(values)
        out[dest] = out[dest].combine_first(values) if dest in out else values
    if "opponent_team" in out.columns:
        if "opponent" not in out.columns:
            out["opponent"] = out["opponent_team"]
        out = out.drop(columns=["opponent_team"])
    return out.loc[:, ~out.columns.duplicated()]


def _load_weekly_season(season: int) -> pd.DataFrame:
    # Prefer the current release for every year, not only years where the old
    # player_stats feed happens to fail. This keeps appearance/zero-score cohorts
    # and feature-gate fingerprints reproducible across local and production jobs.
    url = ("https://github.com/nflverse/nflverse-data/releases/download/"
           f"stats_player/stats_player_week_{season}.parquet")
    try:
        return _normalize_weekly_columns(pd.read_parquet(url))
    except Exception as exc:
        print(f"Current weekly feed unavailable for {season}; trying legacy source: {exc}")
        nfl = _import_nfl_data_py()
        return _normalize_weekly_columns(nfl.import_weekly_data(years=[season], downcast=False))


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


def load_play_by_play(seasons: list[int]) -> pd.DataFrame:
    """One shared PBP import for base and candidate features.

    None of these aggregations needs participation. Requesting it can make a
    valid current-season PBP feed fail when participation has not been published.
    """
    nfl = _import_nfl_data_py()
    return nfl.import_pbp_data(
        years=seasons,
        columns=[
            "season", "week", "posteam", "defteam", "epa", "play_type", "pass", "rush",
            "pass_attempt", "rush_attempt", "complete_pass", "yards_gained", "air_yards",
            "touchdown", "yardline_100", "receiver_player_id", "rusher_player_id", "pass_oe",
            "receiver", "cpoe", "xyac_epa", "pass_touchdown",
        ],
        include_participation=False,
        # Aggregate the published precision consistently. GBM casts its final
        # matrix later; earlier downcasting changes means and source fingerprints.
        downcast=False,
    )


def load_team_epa(seasons: list[int], pbp: pd.DataFrame | None = None) -> pd.DataFrame:
    """Aggregate realized defensive EPA; versioned model inputs lag it later."""
    pbp = load_play_by_play(seasons) if pbp is None else pbp
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

    lead_rename = {c: f"{c}_lead" for c in (*spec.stat_cols, *share_cols) if c in df.columns}
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
    candidate_dir: Path | None = None,
) -> dict[str, Path]:
    seasons = seasons or DEFAULT_ETL_SEASONS
    output_dir = output_dir or PROCESSED_DATA_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    weekly = load_weekly_player_stats(seasons)
    schedules = load_schedules(seasons)
    # Save the same fresh game context used by ETL for gated training and
    # upcoming inference. An isolated research rebuild keeps its own snapshot.
    schedule_targets = [output_dir / "nfl_schedules.parquet"]
    if output_dir.resolve() == PROCESSED_DATA_DIR.resolve():
        from src.core.schedule_utils import SCHEDULE_CACHE
        schedule_targets.append(SCHEDULE_CACHE)
    snapshot = schedules.assign(market_fetched_at_utc=datetime.now(timezone.utc).isoformat())
    from src.core.schedule_utils import save_schedule_snapshot

    for schedule_path in schedule_targets if not schedules.empty else []:
        save_schedule_snapshot(snapshot, schedule_path)
    pbp = load_play_by_play(seasons)
    team_epa = load_team_epa(seasons, pbp=pbp)
    # Import after module initialization: candidate_etl uses our loaders. An
    # eager import here silently disabled both enrichers on the normal job path.
    if enrich_analytics:
        from src.analytics.candidate_etl import _load_snap_counts, build_candidate_features, merge_candidate_frame
        from src.analytics.historical_injury import add_historical_injury_features
        from src.config import CANDIDATE_DATA_DIR
        candidate_dir = candidate_dir or CANDIDATE_DATA_DIR
        try:
            snaps = _load_snap_counts(seasons)
        except Exception as exc:
            print(f"Snap source unavailable; retaining missing observations: {exc}")
            snaps = pd.DataFrame()
        print("Building analytics candidate features...")
        for position in FEATURE_REGISTRY:
            build_candidate_features(position, seasons, output_dir=candidate_dir,
                                     weekly=weekly, schedules=schedules, pbp=pbp, snap_counts=snaps)
    target_quality = None
    if merge_target_quality_into_wr_features is not None:
        target_quality = build_target_quality(seasons=seasons, pbp=pbp)
    del pbp
    release_memory()

    paths: dict[str, Path] = {}
    for position in FEATURE_REGISTRY:
        dataset = build_position_dataset(weekly, schedules, team_epa, position)
        if enrich_analytics:
            candidates = pd.read_parquet(candidate_dir / f"candidate_features_{position}.parquet")
            dataset = merge_candidate_frame(dataset, candidates)
            dataset = add_historical_injury_features(dataset)
        if position == "wr" and merge_target_quality_into_wr_features is not None:
            dataset = merge_target_quality_into_wr_features(dataset, target_quality=target_quality)
        path = output_dir / f"{position}_mlready.parquet"
        temporary = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
        try:
            write_parquet(dataset, temporary)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
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
    parser.add_argument("--candidate-dir", type=Path, help="Optional isolated enrichment output directory")
    args = parser.parse_args()
    build_all_datasets(seasons=args.seasons, output_dir=args.output_dir, candidate_dir=args.candidate_dir)


if __name__ == "__main__":
    main()
