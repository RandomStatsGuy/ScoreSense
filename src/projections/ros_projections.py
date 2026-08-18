"""Rest-of-season and full-season projection aggregation.

SCORE-32 — ROS opportunity decay
---------------------------------
Weekly single-week projections still apply the full current-week opportunity
adjustment (unchanged).

ROS / season totals must **not** multiply that current-week opportunity into
every remaining game. When injury adjustments are enabled:

1. Baseline rate comes from no-injury weekly (rolling P50 when available).
2. Current-week opportunity delta (inj − baseline) is credited only over a
   near-term return-window horizon with linear decay
   (``src.core.opportunity.effective_ros_opportunity_weeks``).
3. Questionable defaults to a 1-week horizon → opportunity affects this week
   only in ROS totals.
"""

from __future__ import annotations

import pandas as pd

from src.config import GAMES_PER_SEASON, PROCESSED_DATA_DIR, MODEL_DIR
from src.core.opportunity import (
    OPPORTUNITY_ADJUSTMENT_COL,
    OPPORTUNITY_ADJUSTMENT_LEGACY_COL,
    effective_ros_opportunity_weeks,
    ensure_opportunity_adjustment_columns,
    ros_opportunity_horizon_weeks,
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


def _load_or_predict_weekly(
    position: str,
    season: int,
    target_week: int,
    *,
    apply_injury_adjustments: bool,
    data_dir,
    model_dir,
    df: pd.DataFrame,
) -> pd.DataFrame:
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
    return weekly


def _apply_rolling_rate(weekly: pd.DataFrame, rolling: pd.DataFrame) -> pd.DataFrame:
    if rolling.empty or "player_id" not in weekly.columns:
        return weekly
    out = weekly.merge(
        rolling.rename(columns={"Projected Points": "_rolling_p50"}),
        on="player_id",
        how="left",
    )
    # SCORE-50: rolling overwrites P50 only — shift tails by the same delta, then repair.
    if {"Low (P10)", "High (P90)", "Projected Points"}.issubset(out.columns):
        old_p50 = out["Projected Points"].astype(float)
        new_p50 = out["_rolling_p50"].astype(float)
        shift = (new_p50 - old_p50).fillna(0.0)
        out["Projected Points"] = new_p50.fillna(old_p50)
        out["Low (P10)"] = (out["Low (P10)"].astype(float) + shift).clip(lower=0.0)
        out["High (P90)"] = out["High (P90)"].astype(float) + shift
        from src.ml.quantile import repair_projection_quantiles

        out = repair_projection_quantiles(
            out,
            column_sets=(("Low (P10)", "Projected Points", "High (P90)"),),
        )
    else:
        out["Projected Points"] = out["_rolling_p50"].fillna(out["Projected Points"])
    return out.drop(columns=["_rolling_p50"], errors="ignore")


def _scale_ros_with_opportunity_decay(out: pd.DataFrame) -> pd.DataFrame:
    """Blend baseline ROS rate with near-term decayed opportunity deltas.

    Expects columns:
      base_p50 / base_p10 / base_p90 — no-injury per-game rates
      Projected Points / Low (P10) / High (P90) — injury-on current-week rates
      weeks_remaining, Injury Note (optional)
    """
    note_col = "Injury Note" if "Injury Note" in out.columns else None
    effective_weeks: list[float] = []
    for _, row in out.iterrows():
        base = float(row.get("base_p50") or 0.0)
        inj = float(row.get("Projected Points") or 0.0)
        delta = inj - base
        note = str(row.get(note_col) or "") if note_col else ""
        horizon = ros_opportunity_horizon_weeks(
            injury_note=note,
            has_opportunity=abs(delta) >= 1e-9,
        )
        effective_weeks.append(
            effective_ros_opportunity_weeks(horizon, int(row.get("weeks_remaining") or 0))
        )
    out = out.copy()
    out["_opp_eff_weeks"] = effective_weeks
    remaining = out["weeks_remaining"].astype(float)

    for base_col, inj_col, dst in (
        ("base_p50", "Projected Points", "ros_proj"),
        ("base_p10", "Low (P10)", "ros_low"),
        ("base_p90", "High (P90)", "ros_high"),
    ):
        if base_col not in out.columns:
            # Fall back to injury-on rate without decay if baseline missing.
            out[dst] = out[inj_col] * remaining
            continue
        base_rate = out[base_col].astype(float)
        inj_rate = out[inj_col].astype(float) if inj_col in out.columns else base_rate
        delta = inj_rate - base_rate
        out[dst] = base_rate * remaining + delta * out["_opp_eff_weeks"]

    from src.ml.quantile import repair_projection_quantiles

    out = repair_projection_quantiles(
        out,
        column_sets=(("ros_low", "ros_proj", "ros_high"),),
    )
    return out.drop(columns=["_opp_eff_weeks"], errors="ignore")


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

    When ``apply_injury_adjustments`` is True, ROS opportunity is limited to a
    return-window decay horizon (see module docstring) rather than applied to
    every remaining week.
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

    # Baseline (no-injury) rate — always the ROS backbone when injury mode is on.
    weekly_base = _load_or_predict_weekly(
        position,
        season,
        target_week,
        apply_injury_adjustments=False,
        data_dir=data_dir,
        model_dir=model_dir,
        df=df,
    )
    rolling_base = _rolling_weekly_p50(
        position,
        season,
        target_week,
        apply_injury_adjustments=False,
    )
    weekly_base = _apply_rolling_rate(weekly_base, rolling_base)

    if apply_injury_adjustments:
        weekly_inj = _load_or_predict_weekly(
            position,
            season,
            target_week,
            apply_injury_adjustments=True,
            data_dir=data_dir,
            model_dir=model_dir,
            df=df,
        )
        # Keep current-week injury/opportunity on the inj frame; do not roll
        # historical injury into the opportunity delta.
        weekly = weekly_inj.copy()
        if "player_id" in weekly.columns and "player_id" in weekly_base.columns:
            base_cols = weekly_base[
                [c for c in ("player_id", "Projected Points", "Low (P10)", "High (P90)") if c in weekly_base.columns]
            ].rename(
                columns={
                    "Projected Points": "base_p50",
                    "Low (P10)": "base_p10",
                    "High (P90)": "base_p90",
                }
            )
            weekly = weekly.merge(base_cols, on="player_id", how="left")
        else:
            weekly["base_p50"] = weekly_base["Projected Points"].values
            if "Low (P10)" in weekly_base.columns:
                weekly["base_p10"] = weekly_base["Low (P10)"].values
            if "High (P90)" in weekly_base.columns:
                weekly["base_p90"] = weekly_base["High (P90)"].values
        for col, base_col in (
            ("Projected Points", "base_p50"),
            ("Low (P10)", "base_p10"),
            ("High (P90)", "base_p90"),
        ):
            if base_col in weekly.columns and col in weekly.columns:
                weekly[base_col] = weekly[base_col].fillna(weekly[col])
    else:
        weekly = weekly_base.copy()
        weekly["base_p50"] = weekly["Projected Points"]
        if "Low (P10)" in weekly.columns:
            weekly["base_p10"] = weekly["Low (P10)"]
        if "High (P90)" in weekly.columns:
            weekly["base_p90"] = weekly["High (P90)"]

    out = weekly.merge(ytd, on="player_id", how="left")
    out["fpts_ytd"] = out["fpts_ytd"].fillna(0.0)
    out["games_played"] = out["games_played"].fillna(0).astype(int)
    out["weeks_remaining"] = out["games_played"].map(
        lambda gp: games_remaining_in_season(gp, GAMES_PER_SEASON)
    )

    if apply_injury_adjustments:
        out = _scale_ros_with_opportunity_decay(out)
    else:
        remaining = out["weeks_remaining"]
        out["ros_proj"] = out["Projected Points"] * remaining
        out["ros_low"] = out["Low (P10)"] * remaining if "Low (P10)" in out.columns else out["ros_proj"]
        out["ros_high"] = out["High (P90)"] * remaining if "High (P90)" in out.columns else out["ros_proj"]

    out["season_proj"] = out["fpts_ytd"] + out["ros_proj"]
    out["season_low"] = out["fpts_ytd"] + out["ros_low"]
    out["season_high"] = out["fpts_ytd"] + out["ros_high"]

    # Next Week P50 should reflect the current-week view (injury-on when requested).
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
