"""Faithful recorded-game derivative, independent of model training features.

Rows retain the provider's reporting period, event team, position and missing
values. The parquet footer and rows are published together in one replacement.
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from src.config import FANTASY_SCORING
from src.core.team_codes import normalize_team_for_match

RECORDED_GAMES_FILENAME = "recorded_player_games.parquet"
RECORDED_GAMES_VERSION = 1
METADATA_KEY = b"scoresense_recorded_games"
GAME_STATS = tuple(dict.fromkeys((*FANTASY_SCORING, "passing_2pt_conversions",
                                "rushing_2pt_conversions", "receiving_2pt_conversions")))


def build_recorded_games(weekly: pd.DataFrame, schedules: pd.DataFrame) -> pd.DataFrame:
    """Keep same-game facts before rolling features, model filters or fillna."""
    required = {"player_id", "season", "week", "team", "position"}
    if not required <= set(weekly.columns):
        raise ValueError(f"Recorded games missing columns: {sorted(required - set(weekly.columns))}")
    out = weekly[weekly["position"].isin(["QB", "RB", "FB", "WR", "TE"])].copy()
    if out["player_id"].isna().any() or out["player_id"].astype(str).str.strip().eq("").any():
        raise ValueError("Recorded games contain an unresolved player identity")
    out["player_id"] = out["player_id"].astype(str).str.strip()
    for col in ("season", "week"):
        values = pd.to_numeric(out[col], errors="coerce")
        if values.isna().any() or not np.isfinite(values).all() or values.mod(1).ne(0).any():
            raise ValueError(f"Recorded games contain invalid {col}")
        out[col] = values.astype(int)
    if not out["week"].between(1, 22).all():
        raise ValueError("Recorded games contain invalid week")
    if "season_type" in out:
        out["_reported_type"] = out["season_type"]
    elif "game_type" in out:
        out["_reported_type"] = out["game_type"]
    out["_join_team"] = out["team"].map(normalize_team_for_match)
    schedule_required = {"season", "week", "game_type", "home_team", "away_team"}
    if not schedule_required <= set(schedules.columns):
        raise ValueError("Recorded games require schedules with explicit game type")
    schedule_cols = [c for c in ("season", "week", "game_type", "gameday", "game_id") if c in schedules]
    home = schedules[[*schedule_cols, "home_team", "away_team"]].rename(columns={"home_team": "_join_team", "away_team": "_opponent"})
    away = schedules[[*schedule_cols, "home_team", "away_team"]].rename(columns={"away_team": "_join_team", "home_team": "_opponent"})
    home["is_home"], away["is_home"] = True, False
    games = pd.concat([home, away], ignore_index=True)
    games = games[~games["game_type"].isin(["PRE", "PRESEASON"])].copy()
    games["game_type"] = games["game_type"].replace({"WC": "POST", "DIV": "POST", "CON": "POST", "SB": "POST"})
    games["_join_team"] = games["_join_team"].map(normalize_team_for_match)
    if games.duplicated(["season", "week", "_join_team"]).any():
        raise ValueError("Recorded schedule contains duplicate team/season/week keys")
    # Schedule context is joined once, with cardinality checked before publication.
    out = out.drop(columns=[c for c in ("game_type", "gameday", "game_id", "is_home") if c in out])
    out = out.merge(games, on=["season", "week", "_join_team"], how="left", validate="many_to_one")
    if "_reported_type" in out:
        reported = out["_reported_type"].astype(str).str.upper().replace({"REGULAR": "REG", "POSTSEASON": "POST", "WC": "POST", "DIV": "POST", "CON": "POST", "SB": "POST"})
        conflict = out["game_type"].notna() & reported.isin(["REG", "POST"]) & reported.ne(out["game_type"])
        if conflict.any():
            raise ValueError("Recorded statistics and schedule disagree on game type")
        out["game_type"] = out["game_type"].where(out["game_type"].notna(), reported.where(reported.isin(["REG", "POST"])))
    if "opponent" not in out:
        out["opponent"] = out["_opponent"]
    else:
        out["opponent"] = out["opponent"].where(out["opponent"].notna(), out["_opponent"])
    if out.duplicated(["player_id", "season", "week"]).any():
        raise ValueError("Recorded statistics contain duplicate player/season/week keys")
    for col in GAME_STATS:
        out[col] = pd.to_numeric(out[col], errors="coerce") if col in out else np.nan
        out[col] = out[col].where(np.isfinite(out[col]))
    if "fantasy_points_ppr" in out:
        # An explicitly missing provider total must never become a zero.
        out["points"] = pd.to_numeric(out["fantasy_points_ppr"], errors="coerce")
    else:
        # The provider's PPR total includes scoring events outside the model's
        # abbreviated FANTASY_SCORING weights. Missing totals are unavailable;
        # a partial recomputation must not masquerade as the same definition.
        out["points"] = np.nan
    out["points"] = out["points"].where(np.isfinite(out["points"]))
    out["participated"] = pd.Series(pd.NA, index=out.index, dtype="boolean")
    for counter in ("gp", "games_played"):
        if counter in out:
            participation = pd.to_numeric(out[counter], errors="coerce")
            valid = participation.isin([0, 1])
            out.loc[valid, "participated"] = participation.loc[valid].eq(1)
            break
    no_play = out["participated"].eq(False).fillna(False)
    counters = out.loc[no_play, ["points", *GAME_STATS]]
    if counters.fillna(0).ne(0).any(axis=None):
        raise ValueError("Recorded no-participation record contains nonzero statistics")
    keep = ["player_id", "season", "week", "team", "position", "game_type", "opponent", "is_home", "points", *GAME_STATS]
    keep.append("participated")
    keep += [c for c in ("player_name", "player_display_name", "game_id", "gameday") if c in out]
    return out[keep].sort_values(["player_id", "season", "week"]).reset_index(drop=True)


def publish_recorded_games(frame: pd.DataFrame, destination: Path) -> None:
    """Atomic single-file publication; failed replacement retains last good file."""
    regular = frame[frame["game_type"].eq("REG")]
    cutoffs = {str(int(season)): int(group["week"].max()) for season, group in regular.groupby("season")}
    metadata = {"version": RECORDED_GAMES_VERSION, "source": "nflverse_weekly_player_stats",
                "scoring": "standard_ppr", "ingested_at": datetime.now(timezone.utc).isoformat(),
                "source_through_week": cutoffs, "rows": len(frame)}
    table = pa.Table.from_pandas(frame, preserve_index=False)
    table = table.replace_schema_metadata({**(table.schema.metadata or {}), METADATA_KEY: json.dumps(metadata).encode()})
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=destination.parent, prefix=destination.stem, suffix=".tmp")
    os.close(descriptor)
    try:
        pq.write_table(table, temporary, compression="zstd")
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)
