"""Analytics-only ETL for Tier A nflverse candidate features."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import CANDIDATE_DATA_DIR, DEFAULT_ETL_SEASONS, DEFAULT_TRAIN_SEASONS, PROCESSED_DATA_DIR, write_parquet
from src.etl.nflverse_etl import (
    _import_nfl_data_py,
    _position_filter,
    _team_targets,
    load_schedules,
    load_weekly_player_stats,
)
from src.core.features import add_rolling_averages, safe_div
from src.analytics.ngs_candidate_etl import load_ngs_receiving_weekly, merge_ngs_onto_spine


def _load_snap_counts(seasons: list[int]) -> pd.DataFrame:
    nfl = _import_nfl_data_py()
    snaps = nfl.import_snap_counts(years=seasons)
    snaps = snaps.rename(columns={"player": "player_name", "team": "team"})
    if "position" not in snaps.columns and "position_group" in snaps.columns:
        snaps["position"] = snaps["position_group"]
    agg = (
        snaps.groupby(["season", "week", "player_id", "team"], as_index=False)
        .agg(offense_snaps=("offense_snaps", "sum"), offense_pct=("offense_pct", "mean"))
    )
    return agg


def _load_pbp_features(seasons: list[int]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    nfl = _import_nfl_data_py()
    pbp = nfl.import_pbp_data(
        years=seasons,
        columns=[
            "season",
            "week",
            "posteam",
            "defteam",
            "play_type",
            "pass",
            "rush",
            "pass_attempt",
            "rush_attempt",
            "complete_pass",
            "yards_gained",
            "air_yards",
            "touchdown",
            "yardline_100",
            "receiver_player_id",
            "rusher_player_id",
            "pass_oe",
        ],
        downcast=True,
    )
    pbp = pbp[pbp["play_type"].isin(["pass", "run"])].copy()
    pass_plays = pbp[pbp["pass_attempt"] == 1].copy()
    pass_plays["is_deep"] = pass_plays["air_yards"] >= 20
    targeted = pass_plays[pass_plays["receiver_player_id"].notna()].copy()

    team_week = (
        pbp.groupby(["season", "week", "posteam"], as_index=False)
        .agg(
            team_plays=("play_type", "count"),
            pass_plays=("pass", "sum"),
            rush_plays=("rush", "sum"),
        )
        .rename(columns={"posteam": "team"})
    )
    team_pass_attempts = (
        pass_plays.groupby(["season", "week", "posteam"], as_index=False)
        .size()
        .rename(columns={"size": "team_pass_attempts", "posteam": "team"})
    )
    team_week = team_week.merge(team_pass_attempts, on=["season", "week", "team"], how="left")
    team_week["team_pass_attempts"] = team_week["team_pass_attempts"].fillna(0)
    team_week["team_pass_rate"] = safe_div(team_week["pass_plays"], team_week["team_plays"])
    team_proe = (
        pbp.groupby(["season", "week", "posteam"], as_index=False)["pass_oe"]
        .mean()
        .rename(columns={"posteam": "team", "pass_oe": "team_proe"})
    )
    team_week = team_week.merge(team_proe, on=["season", "week", "team"], how="left")
    team_week["team_proe"] = team_week["team_proe"].fillna(0)

    opp_week = (
        pbp.groupby(["season", "week", "defteam"], as_index=False)
        .agg(
            def_plays=("play_type", "count"),
            def_pass_plays=("pass", "sum"),
        )
        .rename(columns={"defteam": "opponent"})
    )
    opp_week["opponent_pass_rate_allowed"] = safe_div(
        opp_week["def_pass_plays"], opp_week["def_plays"]
    )

    def_plays = pass_plays.groupby(["season", "week", "defteam"], as_index=False).agg(
        def_pass_attempts=("pass_attempt", "count"),
        def_deep_passes=("is_deep", "sum"),
    )
    def_plays["def_deep_pass_rate"] = safe_div(def_plays["def_deep_passes"], def_plays["def_pass_attempts"])
    def_plays = def_plays.sort_values(["defteam", "season", "week"])
    def_plays["def_deep_pass_rate_allowed_avg"] = (
        def_plays.groupby("defteam")["def_deep_pass_rate"]
        .transform(lambda s: s.shift(1).rolling(4, min_periods=2).mean())
        .fillna(0.0)
    )
    def_opp = def_plays[["season", "week", "defteam", "def_deep_pass_rate_allowed_avg"]].rename(
        columns={"defteam": "opponent"}
    )
    opp_week = opp_week.merge(def_opp, on=["season", "week", "opponent"], how="left")
    opp_week["def_deep_pass_rate_allowed_avg"] = opp_week["def_deep_pass_rate_allowed_avg"].fillna(0.0)

    explosive = pbp[pbp["yards_gained"] >= 20].copy()
    recv_exp = (
        explosive[explosive["receiver_player_id"].notna()]
        .groupby(["season", "week", "receiver_player_id"], as_index=False)
        .size()
        .rename(columns={"size": "explosive_plays", "receiver_player_id": "player_id"})
    )
    rush_exp = (
        explosive[explosive["rusher_player_id"].notna()]
        .groupby(["season", "week", "rusher_player_id"], as_index=False)
        .size()
        .rename(columns={"size": "explosive_rush_plays", "rusher_player_id": "player_id"})
    )
    player_exp = recv_exp.merge(
        rush_exp, on=["season", "week", "player_id"], how="outer"
    ).fillna(0)
    player_exp["explosive_plays"] = player_exp["explosive_plays"] + player_exp["explosive_rush_plays"]

    rz = pbp[pbp["yardline_100"] <= 20].copy()
    rz_recv = (
        rz[rz["receiver_player_id"].notna()]
        .groupby(["season", "week", "receiver_player_id"], as_index=False)
        .size()
        .rename(columns={"size": "rz_targets", "receiver_player_id": "player_id"})
    )
    rz_rush = (
        rz[rz["rusher_player_id"].notna()]
        .groupby(["season", "week", "rusher_player_id"], as_index=False)
        .size()
        .rename(columns={"size": "rz_carries", "rusher_player_id": "player_id"})
    )
    player_rz = rz_recv.merge(rz_rush, on=["season", "week", "player_id"], how="outer").fillna(0)

    player_pbp = player_exp.merge(player_rz, on=["season", "week", "player_id"], how="outer").fillna(0)

    ay = targeted["air_yards"]
    targeted = targeted.copy()
    targeted["is_short"] = (ay >= 0) & (ay < 10)
    targeted["is_intermediate"] = (ay >= 10) & (ay < 20)
    recv_pass = targeted.groupby(["season", "week", "receiver_player_id"], as_index=False).agg(
        routes=("pass_attempt", "count"),
        adot=("air_yards", "mean"),
        short_targets=("is_short", "sum"),
        intermediate_targets=("is_intermediate", "sum"),
        deep_targets=("is_deep", "sum"),
    )
    recv_pass = recv_pass.rename(columns={"receiver_player_id": "player_id"})
    player_pbp = player_pbp.merge(recv_pass, on=["season", "week", "player_id"], how="left")
    for col in ("routes", "adot", "short_targets", "intermediate_targets", "deep_targets"):
        player_pbp[col] = player_pbp[col].fillna(0)

    return team_week, opp_week, player_pbp


def _schedule_implied_totals(schedules: pd.DataFrame) -> pd.DataFrame:
    home = schedules[
        ["season", "week", "home_team", "spread_line", "total_line"]
    ].copy()
    home["team"] = home["home_team"]
    home["implied_team_total"] = home["total_line"] / 2 - home["spread_line"] / 2
    away = schedules[
        ["season", "week", "away_team", "spread_line", "total_line"]
    ].copy()
    away["team"] = away["away_team"]
    away["team_spread"] = -away["spread_line"]
    away["implied_team_total"] = away["total_line"] / 2 + away["spread_line"] / 2
    home = home.rename(columns={"spread_line": "team_spread"})
    return pd.concat(
        [
            home[["season", "week", "team", "team_spread", "implied_team_total", "total_line"]].rename(
                columns={"team_spread": "spread_line"}
            ),
            away[["season", "week", "team", "team_spread", "implied_team_total", "total_line"]].rename(
                columns={"team_spread": "spread_line"}
            ),
        ],
        ignore_index=True,
    )


def _usage_volatility_and_trend(df: pd.DataFrame, col: str) -> pd.DataFrame:
    out = df.copy()
    out = out.sort_values(["player_id", "season", "week"])
    vol_col = f"{col}_volatility"
    trend_col = f"{col}_trend"
    out[vol_col] = (
        out.groupby("player_id")[col]
        .apply(lambda s: s.shift(1).rolling(4, min_periods=2).std())
        .reset_index(level=0, drop=True)
    )
    out[trend_col] = (
        out.groupby("player_id")[col]
        .apply(lambda s: s.shift(1).rolling(4, min_periods=2).apply(
            lambda x: np.polyfit(range(len(x)), x, 1)[0] if len(x) >= 2 else 0.0,
            raw=False,
        ))
        .reset_index(level=0, drop=True)
    )
    return out


def build_candidate_features(
    position: str,
    seasons: list[int] | None = None,
    output_dir: Path | None = None,
) -> pd.DataFrame:
    seasons = seasons or DEFAULT_ETL_SEASONS
    output_dir = output_dir or CANDIDATE_DATA_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    weekly = load_weekly_player_stats(seasons)
    schedules = load_schedules(seasons)
    team_week, opp_week, player_pbp = _load_pbp_features(seasons)
    implied = _schedule_implied_totals(schedules)

    try:
        snaps = _load_snap_counts(seasons)
    except Exception:
        snaps = pd.DataFrame(columns=["season", "week", "player_id", "offense_snaps", "offense_pct"])

    df = _position_filter(weekly, position)
    df = df.rename(columns={"opponent_team": "opponent"})
    if "team" not in df.columns and "recent_team" in df.columns:
        df = df.rename(columns={"recent_team": "team"})
    df = df.loc[:, ~df.columns.duplicated()]

    df = df.merge(implied, on=["season", "week", "team"], how="left")
    df = df.merge(team_week, on=["season", "week", "team"], how="left")
    df = df.merge(opp_week, on=["season", "week", "opponent"], how="left")
    df = df.merge(player_pbp, on=["season", "week", "player_id"], how="left")
    if not snaps.empty:
        df = df.merge(snaps[["season", "week", "player_id", "offense_snaps", "offense_pct"]], on=["season", "week", "player_id"], how="left")

    df = _team_targets(df)
    df["target_share"] = safe_div(df["targets"], df["team_targets"])
    df["carry_share"] = safe_div(df["carries"], df["team_carries"])

    stat_cols = [
        "implied_team_total",
        "total_line",
        "spread_line",
        "team_pass_rate",
        "team_plays",
        "team_pass_attempts",
        "team_proe",
        "opponent_pass_rate_allowed",
        "explosive_plays",
        "rz_targets",
        "rz_carries",
        "routes",
        "offense_snaps",
        "offense_pct",
        "target_share",
        "carry_share",
    ]
    if position == "wr":
        ngs_weekly = load_ngs_receiving_weekly(seasons)
        df = merge_ngs_onto_spine(df, ngs_weekly)
        if "receiving_air_yards" not in df.columns:
            df["receiving_air_yards"] = 0.0
        df["receiving_air_yards"] = df["receiving_air_yards"].fillna(0.0)
        df["air_yards_share"] = safe_div(
            df["receiving_air_yards"],
            df.groupby(["season", "week", "team"])["receiving_air_yards"].transform("sum"),
        )
        df["wopr"] = 1.5 * df["target_share"] + 0.7 * df["air_yards_share"]
        stat_cols.extend(["adot", "wopr"])
        for col in ("short_targets", "intermediate_targets", "deep_targets"):
            if col not in df.columns:
                df[col] = 0.0
            df[col] = df[col].fillna(0.0)
        binned_total = df["short_targets"] + df["intermediate_targets"] + df["deep_targets"]
        df["deep_target_share"] = safe_div(df["deep_targets"], binned_total)
        stat_cols = list(dict.fromkeys(stat_cols + ["deep_target_share", "ngs_avg_separation", "ngs_yac_above_expectation"]))
    for col in stat_cols:
        if col not in df.columns:
            df[col] = 0.0
        df[col] = df[col].fillna(0.0)

    df = add_rolling_averages(df, "player_id", stat_cols)
    trend_base = "target_share_avg" if "target_share_avg" in df.columns else "target_share"
    df = _usage_volatility_and_trend(df, trend_base)
    if position in ("rb", "qb"):
        carry_base = "carry_share_avg" if "carry_share_avg" in df.columns else "carry_share"
        df = _usage_volatility_and_trend(df, carry_base)
    if position == "wr":
        for base in ("routes_avg", "wopr_avg", "adot_avg", "deep_target_share_avg"):
            if base in df.columns:
                df = _usage_volatility_and_trend(df, base)

    keep = ["player_id", "season", "week", "team", "opponent", "position"]
    keep += [c for c in df.columns if c.endswith("_avg") or c.endswith("_volatility") or c.endswith("_trend")]
    out = df[list(dict.fromkeys(keep))].copy()

    path = output_dir / f"candidate_features_{position}.parquet"
    write_parquet(out, path)
    print(f"Wrote {position} candidates: {len(out):,} rows -> {path}")
    return out


def merge_candidates_into_mlready(
    position: str,
    mlready_dir: Path | None = None,
    candidate_dir: Path | None = None,
) -> pd.DataFrame:
    mlready_dir = mlready_dir or PROCESSED_DATA_DIR
    candidate_dir = candidate_dir or CANDIDATE_DATA_DIR
    base_path = mlready_dir / f"{position}_mlready.parquet"
    cand_path = candidate_dir / f"candidate_features_{position}.parquet"
    if not base_path.exists() or not cand_path.exists():
        raise FileNotFoundError("Run nflverse ETL and candidate ETL first")
    base = pd.read_parquet(base_path)
    cand = pd.read_parquet(cand_path)
    merge_cols = [
        c
        for c in cand.columns
        if c not in ("team", "opponent", "position") and c not in base.columns
    ]
    if not merge_cols:
        return base
    merged = base.merge(
        cand[["player_id", "season", "week", *merge_cols]],
        on=["player_id", "season", "week"],
        how="left",
    )
    return merged.fillna(0)


def build_all_candidates(seasons: list[int] | None = None) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for position in ("qb", "rb", "wr"):
        build_candidate_features(position, seasons)
        paths[position] = CANDIDATE_DATA_DIR / f"candidate_features_{position}.parquet"
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Build analytics candidate features")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument("--seasons", type=int, nargs="+", default=DEFAULT_ETL_SEASONS)
    args = parser.parse_args()
    if args.position == "all":
        build_all_candidates(args.seasons)
    else:
        build_candidate_features(args.position, args.seasons)


if __name__ == "__main__":
    main()
