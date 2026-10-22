"""Read recorded player results and saved preseason forecasts without inference."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from src.config import DRAFT_POOL_DIR, PROCESSED_DATA_DIR
from src.core.projection_context import REGULAR_SEASON_MAX_WEEK
from src.core.schedule_utils import SCHEDULE_CACHE
from src.core.team_codes import normalize_team_for_match
from src.etl.recorded_games import GAME_STATS, METADATA_KEY, RECORDED_GAMES_FILENAME, RECORDED_GAMES_VERSION
from src.projections.artifact_store import METADATA_ATTR


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
    wanted = {
        "player_id", "Player", "Team", "season", "week", "team", "position", "game_type", "game_id", "gameday", "opponent", "is_home", "Fpts", "points", "participated",
        "passing_yards_lead", "rushing_yards_lead", "receiving_yards_lead",
        "passing_tds_lead", "rushing_tds_lead", "receiving_tds_lead", "receptions_lead",
        "Season", "Season Proj", "Season P10", "Season P50", "Season P90",
        "Season Floor", "Season Ceiling", "games_expected", "season_quantile_method",
    }
    wanted.update(GAME_STATS)
    # One open file pins footer metadata and rows to the same generation even
    # when a background job replaces the pathname during this request.
    with open(path, "rb") as source_file:
        schema = pq.read_schema(source_file)
        if "player_id" not in schema.names:
            return pd.DataFrame()
        source_file.seek(0)
        frame = pd.read_parquet(source_file, columns=[c for c in schema.names if c in wanted], filters=[("player_id", "==", player_id)])
        frame.attrs["recorded_metadata"] = json.loads((schema.metadata or {}).get(METADATA_KEY, b"{}"))
        stat = os.fstat(source_file.fileno())
        frame.attrs["source_revision"] = {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}
        return frame


def _load_player_rows(path: Path, player_id: str) -> pd.DataFrame:
    try:
        stat = path.stat()
        return _player_rows(str(path), (stat.st_mtime_ns, stat.st_size), str(player_id)).copy()
    except (OSError, ValueError, pa.ArrowException):
        return pd.DataFrame()


@lru_cache(maxsize=8)
def _cached_schedule(path: str, revision: tuple[int, int], season: int) -> pd.DataFrame:
    del revision
    columns = pq.read_schema(path).names
    wanted = {"season", "week", "game_type", "home_team", "away_team", "home_score", "away_score"}
    return pd.read_parquet(path, columns=[c for c in columns if c in wanted], filters=[("season", "==", season)])


def _coverage(rows: pd.DataFrame, season: int, before_week: int, *, source: str | None,
              metadata: dict[str, Any], duplicate_weeks: list[int]) -> dict[str, Any]:
    """Coverage requires completed scheduled games, not just non-null rows.

    Missing player rows cannot identify inactivity without participation data.
    Across a trade, the union of the historical event teams is conservative;
    unknown weeks remain unverified rather than inventing a team or a score.
    """
    no_play = rows["participated"].eq(False).fillna(False) if "participated" in rows else pd.Series(False, index=rows.index)
    played = rows[~no_play]
    recorded = sorted(int(w) for w in played["week"].unique()) if not played.empty else []
    no_participation = sorted(int(w) for w in rows.loc[no_play, "week"].unique())
    result = {"status": "partial" if recorded else "unavailable", "source": source,
              "reason": "no_recorded_games", "season": season, "scoring": "standard_ppr",
              "source_through_week": (metadata.get("source_through_week") or {}).get(str(season)),
              "source_revision": metadata.get("source_revision"),
              "source_ingested_at": metadata.get("ingested_at"), "recorded_weeks": recorded,
              "no_participation_weeks": no_participation,
              "expected_completed_weeks": [], "unverified_weeks": [], "duplicate_weeks": duplicate_weeks}
    counters = [col for col in ("points", *GAME_STATS) if col in rows]
    if any(_number(value) not in (None, 0) for value in rows.loc[no_play, counters].to_numpy().flat):
        result.update(status="partial", reason="invalid_participation")
        return result
    if rows.empty:
        if duplicate_weeks:
            result["reason"] = "duplicate_recorded_games"
        return result
    teams = {normalize_team_for_match(str(t)) for t in rows.get("team", pd.Series(dtype=str)).dropna() if str(t).strip()}
    try:
        stat = SCHEDULE_CACHE.stat()
        schedule = _cached_schedule(str(SCHEDULE_CACHE), (stat.st_mtime_ns, stat.st_size), season)
        required = {"season", "week", "game_type", "home_team", "away_team", "home_score", "away_score"}
        if not required <= set(schedule.columns) or not teams:
            raise ValueError("Schedule/team context missing")
        schedule = schedule[schedule["game_type"].eq("REG")].copy()
        schedule["week"] = pd.to_numeric(schedule["week"], errors="coerce")
        schedule["home_team"] = schedule["home_team"].map(normalize_team_for_match)
        schedule["away_team"] = schedule["away_team"].map(normalize_team_for_match)
        expected = set()
        for team in teams:
            games = schedule[schedule["home_team"].eq(team) | schedule["away_team"].eq(team)]
            expected_games = 17 if season >= 2021 else 16
            if len(games) != expected_games or games["week"].isna().any() or games["week"].duplicated().any():
                raise ValueError("Season schedule coverage missing")
            previous = games[games["week"].between(1, before_week - 1)]
            # A scheduled date or an old requested week does not prove completion.
            final = previous["home_score"].map(_number).notna() & previous["away_score"].map(_number).notna()
            if not final.all():
                result["unverified_weeks"] = sorted(int(w) for w in previous.loc[~final, "week"])
                result["reason"] = "game_completion_unverified"
                return result
            expected.update(int(w) for w in previous["week"])
        result["expected_completed_weeks"] = sorted(expected)
        accounted = set(recorded) | set(no_participation)
        result["unverified_weeks"] = sorted(expected - accounted)
        valid_scores = bool(accounted) and all(_number(v) is not None for v in played["points"])
        if duplicate_weeks:
            result["reason"] = "duplicate_recorded_games"
        elif result["unverified_weeks"]:
            result["reason"] = "unverified_participation"
        elif not valid_scores:
            result["reason"] = "missing_scores" if recorded else "no_recorded_games"
        elif accounted - expected:
            result["reason"] = "schedule_mismatch"
        elif source == "mlready_compatibility":
            # Training ETL fills unknown values with zero. Existing values are
            # useful compatibility history, but cannot prove their provenance.
            result["reason"] = "legacy_source_provenance"
        else:
            result.update(status="complete", reason=None)
    except (OSError, ValueError, TypeError, KeyError, pa.ArrowException):
        result["reason"] = "schedule_unavailable"
    return result


def recorded_player_history(player_id: str, position: str, season: int, week: int, *, preseason: bool) -> dict[str, Any]:
    empty = {"season": season, "points": None, "ppg": None, "games_played": None, "through_week": None, "complete": False}
    result = {"season_to_date": empty, "game_log": [], "game_log_season": season,
              "history_coverage": {"status": "unavailable", "source": None, "reason": "no_recorded_games"}}
    position = str(position).lower()
    if position not in {"qb", "rb", "fb", "wr", "te"}:
        result["history_coverage"].update(status="unsupported", reason="unsupported_position")
        return result
    source_path = PROCESSED_DATA_DIR / RECORDED_GAMES_FILENAME
    metadata: dict[str, Any] = {}
    if source_path.exists():
        source = "nflverse_recorded_games"
        frame = _load_player_rows(source_path, player_id)
        metadata = frame.attrs.get("recorded_metadata") or {}
        if not isinstance(metadata, dict) or metadata.get("version") != RECORDED_GAMES_VERSION or metadata.get("scoring") != "standard_ppr":
            result["history_coverage"].update(source=source, reason="invalid_source")
            return result
    else:
        # Compatibility for existing installations until their next ETL. Current
        # nflverse_etl renames same-game stats to *_lead; it does not shift them.
        source = "mlready_compatibility"
        model_position = {"te": "wr", "fb": "rb"}.get(position, position)
        source_path = PROCESSED_DATA_DIR / f"{model_position}_mlready.parquet"
        frame = _load_player_rows(source_path, player_id)
    metadata = {**metadata, "source_revision": frame.attrs.get("source_revision")}
    score_column = "points" if source == "nflverse_recorded_games" else "Fpts"
    required = {"season", "week", score_column}
    if source == "nflverse_recorded_games":
        required.update({"game_type", "position", "team"})
    if not required <= set(frame.columns):
        result["history_coverage"].update(source=source, reason="invalid_source" if source_path.exists() else "source_unavailable")
        return result
    if "position" in frame:
        frame = frame[frame["position"].astype(str).str.upper().eq(position.upper())]
    for key in ("season", "week"):
        values = pd.to_numeric(frame[key], errors="coerce")
        if values.isna().any() or any(_number(v) is None or v % 1 for v in values):
            result["history_coverage"].update(source=source, reason="invalid_source")
            return result
        frame[key] = values.astype(int)
    frame["points"] = frame[score_column]
    if "game_type" in frame:
        frame = frame[frame["game_type"].eq("REG")]
    max_week = frame["season"].map(lambda s: 18 if s >= 2021 else 17)
    frame = frame[frame["week"].ge(1) & frame["week"].le(max_week)]
    current = frame[(frame["season"] == season) & (frame["week"] < week)]
    log_season, before_week, history = season, week, current
    if preseason and current.empty:
        prior = frame[frame["season"] < season]
        if not prior.empty:
            log_season = int(prior["season"].max())
            before_week = REGULAR_SEASON_MAX_WEEK + 1
            history = prior[prior["season"] == log_season]
    duplicates = sorted(int(w) for w in history.loc[history.duplicated("week", keep=False), "week"].unique())
    # Ambiguous duplicates are excluded, never arbitrarily selected or summed.
    history = history[~history["week"].isin(duplicates)]
    coverage = _coverage(history, log_season, before_week, source=source, metadata=metadata, duplicate_weeks=duplicates)
    complete = coverage["status"] == "complete" and log_season == season
    current = current[~current["week"].isin(duplicates)]
    if "participated" in current:
        current = current[~current["participated"].eq(False).fillna(False)]
    if "participated" in history:
        history = history[~history["participated"].eq(False).fillna(False)]
    scores = pd.to_numeric(current["points"], errors="coerce")
    summary = {**empty, "points": round(float(scores.sum()), 2) if complete else None,
               "ppg": round(float(scores.mean()), 2) if complete and len(current) else None,
               "games_played": len(current) if complete or len(current) else None, "through_week": int(current["week"].max()) if len(current) else None,
               "complete": complete}
    logs = []
    for _, row in history.sort_values("week", ascending=False).iterrows():
        def recorded_stat(name):
            return _number(row.get(name if source == "nflverse_recorded_games" else f"{name}_lead"))
        touchdowns = [recorded_stat(f"{kind}_tds") for kind in ("passing", "rushing", "receiving")]
        logs.append({"week": int(row["week"]), "team": row.get("team"), "position": row.get("position"),
                     "game_id": row.get("game_id"), "gameday": str(row["gameday"]) if pd.notna(row.get("gameday")) else None,
                     "opponent": row.get("opponent"), "is_home": bool(row["is_home"]) if pd.notna(row.get("is_home")) else None,
                     "points": _number(row.get("points")), "passing_yards": recorded_stat("passing_yards"),
                     "rushing_yards": recorded_stat("rushing_yards"), "receiving_yards": recorded_stat("receiving_yards"),
                     "receptions": recorded_stat("receptions"),
                     "touchdowns": sum(touchdowns) if all(v is not None for v in touchdowns) else None})
    return {"season_to_date": summary, "game_log": logs, "game_log_season": log_season, "history_coverage": coverage}


def saved_preseason_forecast(player_id: str, season: int) -> dict[str, Any]:
    """A refreshed pool may supply an outlook, but is never a past baseline."""
    result: dict[str, Any] = {"preseason_projection": None, "preseason_baseline": None}
    frame = _load_player_rows(DRAFT_POOL_DIR / f"pool_{season}.parquet", player_id)
    if len(frame) != 1:
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
        # New pool data and its baseline date are pinned to the same parquet
        # read; a stale compatibility sidecar cannot invent a past baseline.
        meta = frame.attrs.get(METADATA_ATTR)
        if not isinstance(meta, dict):
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
