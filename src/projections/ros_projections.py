"""Rest-of-season and full-season projection aggregation."""

from __future__ import annotations

import pandas as pd

from src.config import GAMES_PER_SEASON, PROCESSED_DATA_DIR, MODEL_DIR
from src.core.opportunity import (
    OPPORTUNITY_ADJUSTMENT_COL,
    OPPORTUNITY_ADJUSTMENT_LEGACY_COL,
    ensure_opportunity_adjustment_columns,
)
from src.core.projection_context import REGULAR_SEASON_MAX_WEEK, build_inference_roster, resolve_projection_context
from src.projections.predict import predict_from_features
from src.projections.season_blend import ROS_ROLLING_WEEKS, games_remaining_in_season
from src.projections.weekly_cache import load_weekly_prediction


def _weeks_remaining(target_week: int) -> int:
    """Deprecated: use games_remaining_in_season with per-player games played."""
    if target_week > REGULAR_SEASON_MAX_WEEK:
        return 0
    return max(0, REGULAR_SEASON_MAX_WEEK - target_week + 1)


def _rolling_weekly_p50(
    position: str,
    season: int,
    target_week: int,
    *,
    apply_injury_adjustments: bool,
    window: int = ROS_ROLLING_WEEKS,
) -> pd.DataFrame:
    """Mean P50 across the last ``window`` weekly projections (inclusive)."""
    start_week = max(1, target_week - window + 1)
    frames: list[pd.DataFrame] = []
    for week in range(start_week, target_week + 1):
        weekly = load_weekly_prediction(
            position,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
            allow_compute=False,
        )
        if weekly.empty:
            continue
        frames.append(weekly[["player_id", "Projected Points"]].copy())
    if not frames:
        return pd.DataFrame(columns=["player_id", "Projected Points"])
    merged = pd.concat(frames, ignore_index=True)
    return merged.groupby("player_id", as_index=False)["Projected Points"].mean()


def _regular_season_ytd(season_df: pd.DataFrame, target_week: int) -> pd.DataFrame:
    """Sum fantasy points through completed regular-season weeks only."""
    reg = season_df[season_df["week"].between(1, REGULAR_SEASON_MAX_WEEK)]
    if target_week <= REGULAR_SEASON_MAX_WEEK:
        reg = reg[reg["week"] < target_week]
    return reg.groupby("player_id", as_index=False).agg(
        fpts_ytd=("Fpts", "sum"),
        games_played=("week", "nunique"),
    )


def predict_rest_of_season(
    position: str,
    season: int | None = None,
    week: int | None = None,
    data_dir=None,
    model_dir=None,
    apply_injury_adjustments: bool = True,
) -> pd.DataFrame:
    """
    Sum weekly quantile projections over remaining regular-season weeks.

    Uses rolling mean of recent weekly P50 as per-game rate when artifacts exist.
    Season total = points scored so far + rate × games remaining (17 − games played).
    """
    data_dir = data_dir or PROCESSED_DATA_DIR
    model_dir = model_dir or MODEL_DIR
    path = data_dir / f"{position}_mlready.parquet"
    if not path.exists():
        path = data_dir / f"{position}_mlready.csv"
    df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)

    season, target_week = resolve_projection_context(df, season, week)
    season_df = df[df["season"] == season]

    ytd = _regular_season_ytd(season_df, target_week)

    weekly = load_weekly_prediction(
        position,
        season=season,
        week=target_week,
        apply_injury_adjustments=apply_injury_adjustments,
    )
    if weekly.empty:
        roster, _inference_meta = build_inference_roster(df, position, season, target_week)
        weekly = predict_from_features(
            roster,
            position,
            model_dir,
            apply_injury_adjustments=apply_injury_adjustments,
        )

    rolling = _rolling_weekly_p50(
        position,
        season,
        target_week,
        apply_injury_adjustments=apply_injury_adjustments,
    )
    if not rolling.empty and "player_id" in weekly.columns:
        weekly = weekly.merge(
            rolling.rename(columns={"Projected Points": "_rolling_p50"}),
            on="player_id",
            how="left",
        )
        weekly["Projected Points"] = weekly["_rolling_p50"].fillna(weekly["Projected Points"])
        weekly = weekly.drop(columns=["_rolling_p50"], errors="ignore")

    out = weekly.merge(ytd, on="player_id", how="left")
    out["fpts_ytd"] = out["fpts_ytd"].fillna(0.0)
    out["games_played"] = out["games_played"].fillna(0).astype(int)
    out["weeks_remaining"] = out["games_played"].map(
        lambda gp: games_remaining_in_season(gp, GAMES_PER_SEASON)
    )

    for src, dst in (
        ("Projected Points", "ros_proj"),
        ("Low (P10)", "ros_low"),
        ("High (P90)", "ros_high"),
    ):
        out[dst] = out[src] * out["weeks_remaining"]

    out["season_proj"] = out["fpts_ytd"] + out["ros_proj"]
    out["season_low"] = out["fpts_ytd"] + out["ros_low"]
    out["season_high"] = out["fpts_ytd"] + out["ros_high"]

    result = pd.DataFrame(
        {
            "Player": out["Player"],
            "Team": out["Team"] if "Team" in out.columns else None,
            "player_id": out["player_id"] if "player_id" in out.columns else None,
            "Season": season,
            "From Week": target_week,
            "Games Played": out["games_played"],
            "Weeks Remaining": out["weeks_remaining"],
            "Games Remaining": out["weeks_remaining"],
            "Reg Season Pts": out["fpts_ytd"].round(1),
            "Next Week P50": out["Projected Points"].round(1),
            "ROS P50": out["ros_proj"].round(1),
            "ROS P10": out["ros_low"].round(1),
            "ROS P90": out["ros_high"].round(1),
            "Season P50": out["season_proj"].round(1),
            "Season P10": out["season_low"].round(1),
            "Season P90": out["season_high"].round(1),
        }
    )
    out_norm = ensure_opportunity_adjustment_columns(out)
    if OPPORTUNITY_ADJUSTMENT_COL in out_norm.columns:
        result[OPPORTUNITY_ADJUSTMENT_COL] = out_norm[OPPORTUNITY_ADJUSTMENT_COL].fillna(0.0)
        result[OPPORTUNITY_ADJUSTMENT_LEGACY_COL] = result[OPPORTUNITY_ADJUSTMENT_COL]

    numeric_cols = [
        "Reg Season Pts",
        "Next Week P50",
        "ROS P50",
        "ROS P10",
        "ROS P90",
        "Season P50",
        "Season P10",
        "Season P90",
        OPPORTUNITY_ADJUSTMENT_COL,
        OPPORTUNITY_ADJUSTMENT_LEGACY_COL,
    ]
    for col in numeric_cols:
        if col in result.columns:
            result[col] = result[col].fillna(0.0)

    return result.sort_values("Season P50", ascending=False).reset_index(drop=True)
