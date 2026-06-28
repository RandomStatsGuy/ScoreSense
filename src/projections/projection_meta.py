"""Available seasons/weeks/teams for dashboard projection controls."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.config import PROCESSED_DATA_DIR
from src.core.projection_context import (
    is_nfl_offseason,
    nfl_calendar_season,
    resolve_projection_context,
    season_in_mlready,
    upcoming_season,
)
from src.core.schedule_utils import regular_season_weeks

_META_CACHE: dict[str, tuple[str, dict]] = {}


def _meta_fingerprint(position: str, data_dir: Path) -> str:
    path = data_dir / f"{position}_mlready.parquet"
    if path.exists():
        return f"{position}:{path.stat().st_mtime_ns}"
    path = data_dir / f"{position}_mlready.csv"
    if path.exists():
        return f"{position}:{path.stat().st_mtime_ns}"
    return position


def get_projection_meta(position: str, data_dir: Path | None = None) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise ValueError("position must be qb, rb, or wr")

    fp = _meta_fingerprint(position, data_dir)
    cached = _META_CACHE.get(position)
    if cached is not None and cached[0] == fp:
        return cached[1].copy()

    path = data_dir / f"{position}_mlready.parquet"
    if not path.exists():
        path = data_dir / f"{position}_mlready.csv"
    if not path.exists():
        raise FileNotFoundError(f"No data for {position}")

    df = (
        pd.read_parquet(path, columns=["season", "week", "team"])
        if path.suffix == ".parquet"
        else pd.read_csv(path, usecols=["season", "week", "team"])
    )
    data_season = int(df["season"].max())
    seasons = [int(s) for s in sorted(df["season"].unique())]
    weeks_by_season = {
        str(season): [int(w) for w in sorted(df.loc[df["season"] == season, "week"].unique())]
        for season in seasons
    }

    upcoming = upcoming_season(data_season)
    offseason = is_nfl_offseason()
    preseason_mode = False
    if upcoming not in seasons:
        seasons = sorted(set(seasons + [upcoming]))
        weeks_by_season[str(upcoming)] = regular_season_weeks(upcoming)
        preseason_mode = True

    teams = sorted(t for t in df["team"].dropna().unique().tolist() if t)

    default_season, default_week = resolve_projection_context(df)
    preseason_mode = preseason_mode or not season_in_mlready(df, default_season)

    result = {
        "position": position,
        "seasons": seasons,
        "weeks_by_season": weeks_by_season,
        "teams": teams,
        "default_season": int(default_season),
        "default_week": int(default_week),
        "upcoming_season": int(upcoming),
        "calendar_season": nfl_calendar_season(),
        "is_offseason": offseason,
        "preseason_mode": preseason_mode,
    }
    _META_CACHE[position] = (fp, result)
    return result.copy()
