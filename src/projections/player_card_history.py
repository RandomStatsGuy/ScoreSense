"""Read recorded player results and saved preseason forecasts without inference."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from src.config import DRAFT_POOL_DIR, PROCESSED_DATA_DIR
from src.core.projection_context import REGULAR_SEASON_MAX_WEEK
from src.core.schedule_utils import SCHEDULE_CACHE


def _number(value: Any) -> float | None:
    try:
        number = float(value)
        return number if pd.notna(number) and abs(number) != float("inf") else None
    except (TypeError, ValueError):
        return None


@lru_cache(maxsize=32)
def _player_rows(path: str, revision: tuple[int, int], player_id: str) -> pd.DataFrame:
    """Bounded, file-revision cache; only read this player's parquet row groups."""
    del revision
    columns = pq.read_schema(path).names
    if "player_id" not in columns:
        return pd.DataFrame()
    wanted = {
        "player_id", "Player", "Team", "season", "week", "team", "opponent", "is_home", "Fpts",
        "passing_yards_lead", "rushing_yards_lead", "receiving_yards_lead",
        "passing_tds_lead", "rushing_tds_lead", "receiving_tds_lead", "receptions_lead",
        "Season", "Season Proj", "Season P10", "Season P50", "Season P90",
        "Season Floor", "Season Ceiling", "games_expected", "season_quantile_method",
    }
    return pd.read_parquet(path, columns=[c for c in columns if c in wanted], filters=[("player_id", "==", player_id)])


def _load_player_rows(path: Path, player_id: str) -> pd.DataFrame:
    try:
        stat = path.stat()
        return _player_rows(str(path), (stat.st_mtime_ns, stat.st_size), str(player_id)).copy()
    except (OSError, ValueError, pa.ArrowException):
        return pd.DataFrame()


def recorded_player_history(player_id: str, position: str, season: int, week: int, *, preseason: bool) -> dict[str, Any]:
    frame = _load_player_rows(PROCESSED_DATA_DIR / f"{position}_mlready.parquet", player_id)
    empty = {"season": season, "points": None, "ppg": None, "games_played": None, "through_week": None, "complete": False}
    if frame.empty or not {"season", "week", "Fpts"}.issubset(frame.columns):
        return {"season_to_date": empty, "game_log": [], "game_log_season": season}
    frame = frame[frame["week"].between(1, REGULAR_SEASON_MAX_WEEK)]
    current = frame[(frame["season"] == season) & (frame["week"] < week)]
    # A missing score is unknown, while a recorded zero is a legitimate result.
    current = current.sort_values("week").drop_duplicates("week", keep="last")
    total = pd.to_numeric(current["Fpts"], errors="coerce")
    complete = bool(len(current)) and bool(total.notna().all()) and all(_number(v) is not None for v in total)
    summary = {
        **empty,
        "points": round(float(total.sum()), 2) if complete else None,
        "ppg": round(float(total.mean()), 2) if complete else None,
        "games_played": len(current) if len(current) else None,
        "through_week": int(current["week"].max()) if len(current) else None,
        "complete": complete,
    }
    log_season = season
    history = current
    if preseason and current.empty:
        prior = frame[frame["season"] < season]
        if not prior.empty:
            log_season = int(prior["season"].max())
            history = prior[prior["season"] == log_season].sort_values("week").drop_duplicates("week", keep="last")
    logs = []
    for _, row in history.sort_values("week", ascending=False).iterrows():
        touchdowns = [_number(row.get(f"{kind}_tds_lead")) for kind in ("passing", "rushing", "receiving")]
        required = touchdowns[:2] if position == "qb" else touchdowns[1:]
        available_td = [v for v in touchdowns if v is not None]
        logs.append({
            "week": int(row["week"]), "opponent": row.get("opponent"),
            "is_home": bool(row["is_home"]) if pd.notna(row.get("is_home")) else None,
            "points": _number(row.get("Fpts")),
            "passing_yards": _number(row.get("passing_yards_lead")),
            "rushing_yards": _number(row.get("rushing_yards_lead")),
            "receiving_yards": _number(row.get("receiving_yards_lead")),
            "receptions": _number(row.get("receptions_lead")),
            "touchdowns": sum(available_td) if all(v is not None for v in required) else None,
        })
    return {"season_to_date": summary, "game_log": logs, "game_log_season": log_season}


def saved_preseason_forecast(player_id: str, season: int) -> dict[str, Any]:
    """A refreshed pool may supply an outlook, but is never a past baseline."""
    result: dict[str, Any] = {"preseason_projection": None, "preseason_baseline": None}
    frame = _load_player_rows(DRAFT_POOL_DIR / f"pool_{season}.parquet", player_id)
    if frame.empty:
        return result
    row = frame.iloc[0]
    if _number(row.get("Season")) != season:
        return result
    forecast = {
        "player_name": row.get("Player"), "team": row.get("Team"),
        "p10": _number(row.get("Season P10", row.get("Season Floor"))),
        "p50": _number(row.get("Season P50", row.get("Season Proj"))),
        "p90": _number(row.get("Season P90", row.get("Season Ceiling"))),
        "method": row.get("season_quantile_method"),
    }
    result["preseason_projection"] = forecast
    try:
        meta = json.loads((DRAFT_POOL_DIR / f"pool_{season}.meta.json").read_text(encoding="utf-8"))
        built = pd.to_datetime(meta.get("built_at"), utc=True, errors="coerce")
        # Read only the locally saved schedule; opening a card never fetches it.
        schedule = pd.read_parquet(SCHEDULE_CACHE)
        regular = schedule[(schedule["season"] == season) & schedule["week"].between(1, REGULAR_SEASON_MAX_WEEK)]
        dates = pd.to_datetime(regular["gameday"], utc=True, errors="coerce")
        first_game = dates.min()
        # Date-only schedules are conservatively midnight UTC on opening day.
        if pd.isna(built) or pd.isna(first_game) or built >= first_game or meta.get("season") != season:
            return result
        games = _number(meta.get("games_per_season"))
        if forecast["p50"] is not None and games and games > 0:
            result["preseason_baseline"] = {"points": forecast["p50"], "games": games, "built_at": meta["built_at"]}
    except (OSError, ValueError, KeyError, TypeError, pa.ArrowException):
        pass
    return result
