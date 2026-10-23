"""Available seasons/weeks/teams for dashboard projection controls."""

from __future__ import annotations

from pathlib import Path
from functools import lru_cache

import pandas as pd

from src.config import PROCESSED_DATA_DIR
from src.core.projection_context import (
    REGULAR_SEASON_MAX_WEEK,
    is_nfl_offseason,
    nfl_calendar_season,
    resolve_projection_context,
    season_in_mlready,
    upcoming_season,
)
from src.core.schedule_utils import regular_season_weeks

_META_CACHE: dict[tuple[str, str], tuple[str, pd.DataFrame]] = {}


@lru_cache(maxsize=6)
def _context_source(path: str, mtime: int, size: int, ctime: int) -> pd.DataFrame:
    columns = ["season", "week", "team"]
    return pd.read_parquet(path, columns=columns) if Path(path).suffix == ".parquet" else pd.read_csv(path, usecols=columns)


def resolve_cached_context(position: str, season: int | None, week: int | None) -> tuple[int, int]:
    """Resolve each request's clock against cached sources, without provider I/O."""
    if season is not None and week is not None:
        return int(season), int(week)
    path = PROCESSED_DATA_DIR / f"{position}_mlready.parquet"
    if not path.exists():
        path = path.with_suffix(".csv")
    stat = path.stat()
    frame = _context_source(str(path), stat.st_mtime_ns, stat.st_size, stat.st_ctime_ns)
    return resolve_projection_context(frame, season, week, allow_fetch=False)


def resolve_projection_read_context(season: int | None, week: int | None) -> tuple[int, int]:
    """Share cached calendar facts while preserving every explicit dimension."""
    if season is not None and week is not None:
        return int(season), int(week)
    meta = get_projection_meta("qb")
    target_season = int(season) if season is not None else int(meta["default_season"])
    if week is not None:
        return target_season, int(week)
    if target_season == int(meta["default_season"]):
        target_week = int(meta["default_week"])
    elif target_season > int(meta["default_season"]):
        target_week = 1
    else:
        recorded_weeks = [int(w) for w in meta["weeks_by_season"].get(str(target_season), [])
                          if 1 <= int(w) <= REGULAR_SEASON_MAX_WEEK]
        target_week = max(recorded_weeks, default=REGULAR_SEASON_MAX_WEEK)
    return target_season, target_week


def _meta_fingerprint(position: str, data_dir: Path) -> str:
    path = data_dir / f"{position}_mlready.parquet"
    if path.exists():
        return f"{path.resolve()}:{path.stat().st_mtime_ns}:{path.stat().st_size}"
    path = data_dir / f"{position}_mlready.csv"
    if path.exists():
        return f"{path.resolve()}:{path.stat().st_mtime_ns}:{path.stat().st_size}"
    return position


def get_projection_meta(position: str, data_dir: Path | None = None) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise ValueError("position must be qb, rb, or wr")

    fp = _meta_fingerprint(position, data_dir)
    cache_key = (position, str(data_dir.resolve()))
    cached = _META_CACHE.get(cache_key)
    if cached is not None and cached[0] == fp:
        df = cached[1]
    else:
        path = data_dir / f"{position}_mlready.parquet"
        if not path.exists():
            path = data_dir / f"{position}_mlready.csv"
        if not path.exists():
            raise FileNotFoundError(f"No data for {position}")
        df = (
            pd.read_parquet(path, columns=["season", "week", "team"])
            if path.suffix == ".parquet"
            else pd.read_csv(path, usecols=["season", "week", "team"])
        ).drop_duplicates()
        _META_CACHE[cache_key] = (fp, df)
    # Cache source facts, not the calendar answer: next week's default must
    # advance even when no new training rows have arrived.
    data_season = int(df["season"].max())
    seasons = [int(s) for s in sorted(df["season"].unique())]
    weeks_by_season = {
        str(season): [int(w) for w in sorted(df.loc[df["season"] == season, "week"].unique())]
        for season in seasons
    }

    upcoming = upcoming_season(data_season)
    offseason = is_nfl_offseason()
    if upcoming not in seasons:
        seasons = sorted(set(seasons + [upcoming]))
        # The future-season option does not require a published schedule.
        weeks_by_season[str(upcoming)] = list(range(1, REGULAR_SEASON_MAX_WEEK + 1))

    teams = sorted(t for t in df["team"].dropna().unique().tolist() if t)

    default_season, default_week = resolve_projection_context(df, allow_fetch=False)
    preseason_mode = offseason or not season_in_mlready(df, default_season)
    # Played weeks are historical observations; the current board also needs
    # the upcoming regular-season slate and future forecast weeks as options.
    weeks_by_season[str(default_season)] = sorted(
        set(weeks_by_season.get(str(default_season), []))
        | set(regular_season_weeks(default_season))
    )

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
    return result
