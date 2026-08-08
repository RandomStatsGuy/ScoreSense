"""Resolve which season/week to project and build the inference roster."""

from __future__ import annotations

from datetime import datetime

import pandas as pd

from src.integrations.sleeper import get_nfl_state

# Weeks with a full NFL slate (all 32 teams represented)
MIN_TEAMS_FOR_FULL_SLATE = 26
REGULAR_SEASON_MAX_WEEK = 18


def nfl_calendar_season() -> int | None:
    """Current NFL season from Sleeper state, if available."""
    try:
        state = get_nfl_state()
        return int(state.get("season") or state.get("league_season") or 0) or None
    except Exception:
        return None


def is_nfl_offseason() -> bool:
    try:
        state = get_nfl_state()
        return str(state.get("season_type", "off")).lower() == "off"
    except Exception:
        return False


def upcoming_season(data_season: int) -> int:
    cal = nfl_calendar_season()
    if cal and cal > data_season:
        return cal
    return data_season + 1


def season_in_mlready(df: pd.DataFrame, season: int) -> bool:
    return season in set(int(s) for s in df["season"].unique())


def is_preseason_projection(df: pd.DataFrame, season: int, week: int) -> bool:
    """Target season/week has no played games in mlready yet."""
    if week > REGULAR_SEASON_MAX_WEEK:
        return False
    season_df = df[df["season"] == season]
    if season_df.empty:
        return True
    return season_df[season_df["week"] < week].empty


def last_full_slate_week(season_df: pd.DataFrame) -> int:
    """Latest week in the season with a near-complete team slate."""
    for week in range(REGULAR_SEASON_MAX_WEEK, 0, -1):
        week_df = season_df[season_df["week"] == week]
        if week_df["team"].nunique() >= MIN_TEAMS_FOR_FULL_SLATE:
            return week
    return int(season_df["week"].max())


def resolve_projection_context(
    df: pd.DataFrame,
    season: int | None = None,
    week: int | None = None,
    *,
    now: datetime | None = None,
) -> tuple[int, int]:
    """
    Choose target season/week for projections.

    Defaults to the next regular-season week that still has football to play,
    advancing at Tuesday 00:00 Eastern (12am after Monday Night Football).

    Avoids defaulting to Super Bowl week (22), which only includes two teams.
    """
    if season is not None and week is not None:
        return season, week

    data_season = int(df["season"].max())
    available_seasons = set(int(s) for s in df["season"].unique())

    try:
        state = get_nfl_state()
        st_season = int(state.get("season") or state.get("league_season") or data_season)
        st_week = int(state.get("week") or 0)
        st_type = str(state.get("season_type", "off")).lower()

        # Offseason / preseason boards → upcoming (or current) regular season week 1.
        if st_type in {"off", "pre"} and season is None and week is None:
            target_season = st_season if st_type == "pre" else upcoming_season(data_season)
            if st_type == "off" and not season_in_mlready(df, target_season):
                return target_season, 1
            if st_type == "pre":
                return (target_season if target_season in available_seasons else upcoming_season(data_season)), 1

        # Regular / post: schedule-based "next week with football", Mon-night rollover.
        if st_type in {"regular", "post", "playoffs"} or (st_type not in {"off", "pre"} and st_week > 0):
            cal_season = st_season
            from src.core.schedule_utils import current_projection_week

            proj_week = current_projection_week(cal_season, now=now)
            if proj_week is not None:
                if week is not None:
                    return (season or cal_season), week
                # Prefer calendar season even if mlready is still prior year (preseason overlay).
                return cal_season, proj_week

            # Regular season fully rolled over (playoffs / off).
            if st_type in {"post", "playoffs"} and st_week > 0:
                return cal_season, min(st_week, REGULAR_SEASON_MAX_WEEK)
    except Exception:
        pass

    season = season or data_season
    season_df = df[df["season"] == season]
    if week is None:
        # Schedule fallback when Sleeper state is unavailable.
        try:
            from src.core.schedule_utils import current_projection_week

            proj_week = current_projection_week(int(season), now=now)
            if proj_week is not None:
                return int(season), proj_week
        except Exception:
            pass
        week = last_full_slate_week(season_df) + 1
        if week > REGULAR_SEASON_MAX_WEEK:
            week = REGULAR_SEASON_MAX_WEEK
    return season, week


def _latest_prior_season_df(df: pd.DataFrame, season: int) -> pd.DataFrame:
    """Most recent season in df strictly before ``season``."""
    prior_seasons = [int(s) for s in df["season"].unique() if int(s) < season]
    if not prior_seasons:
        return pd.DataFrame()
    return df[df["season"] == max(prior_seasons)]


def feature_season_for_inference(df: pd.DataFrame, season: int, target_week: int = 1) -> int:
    """Season whose stats feed the inference roster (latest available prior year when needed)."""
    season_df = df[df["season"] == season]
    history = season_df[season_df["week"] < target_week]
    if not history.empty:
        return season
    prior = _latest_prior_season_df(df, season)
    if not prior.empty:
        return int(prior["season"].iloc[0])
    return max(int(season) - 1, int(df["season"].min()))


def build_projection_roster(
    df: pd.DataFrame,
    season: int,
    target_week: int,
) -> pd.DataFrame:
    """
    Latest feature row per player before target_week.

    Uses each player's most recent game in the season so the full league is
    included, not just teams that played in a single postseason week.
    """
    season_df = df[df["season"] == season].copy()
    history = season_df[season_df["week"] < target_week]

    if history.empty:
        # Week 1 (or pre-season): carry forward the latest available prior season.
        history = _latest_prior_season_df(df, season)
        if history.empty:
            history = season_df

    roster = (
        history.sort_values(["player_id", "week"])
        .groupby("player_id", as_index=False)
        .tail(1)
    )
    roster = roster.copy()
    roster["week"] = target_week
    return roster


def build_inference_roster(
    df: pd.DataFrame,
    position: str,
    season: int,
    target_week: int,
    *,
    depth_mode: str = "starter",
) -> tuple[pd.DataFrame, dict]:
    """
    Roster for weekly inference, with Sleeper overlay when projecting a future season.

    depth_mode: ``starter`` (weekly slate) or ``draft`` (auction / preseason boards).
    """
    from src.integrations.sleeper import apply_sleeper_roster_overlay

    roster = build_projection_roster(df, season, target_week)
    meta: dict = {
        "preseason_mode": is_preseason_projection(df, season, target_week),
        "feature_season": feature_season_for_inference(df, season, target_week),
        "roster_overlay": {"applied": False},
        "depth_mode": depth_mode,
    }
    if meta["preseason_mode"] and meta["feature_season"] < season:
        roster, overlay = apply_sleeper_roster_overlay(
            roster,
            position,
            season=season,
            target_week=target_week,
            add_rookies=True,
            add_emerging=depth_mode == "draft",
        )
        meta["roster_overlay"] = overlay

    if meta["preseason_mode"]:
        from src.core.depth_chart import filter_depth_chart_starters

        roster, depth_meta = filter_depth_chart_starters(
            roster,
            position,
            df,
            int(meta["feature_season"]),
            depth_mode=depth_mode,
        )
        meta["depth_chart"] = depth_meta

    return roster, meta
