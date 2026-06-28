"""External fantasy projection sources for benchmark comparisons."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pandas as pd
import requests

from src.config import CACHE_DIR
from src.integrations.sleeper import players_dataframe

ESPN_PLAYERS_URL = (
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/players"
)
FF_OPPORTUNITY_URL = (
    "https://github.com/ffverse/ffopportunity/releases/download/"
    "latest-data/ep_weekly_{season}.parquet"
)
ESPN_CACHE_DIR = CACHE_DIR / "espn_projections"
FFO_CACHE_DIR = CACHE_DIR / "ffopportunity"

ESPN_POS_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST"}

# ESPN weekly MAE above this is treated as season-long / invalid for fair benchmark.
ESPN_WEEKLY_MAE_CEILING = 12.0


def _normalize_name(name: str) -> str:
    return "".join(ch for ch in str(name).lower() if ch.isalnum() or ch.isspace()).strip()


def _iter_espn_player_records(payload: list | dict) -> list[dict]:
    """Normalize ESPN API payload to flat player dicts."""
    if isinstance(payload, list):
        entries = payload
    elif isinstance(payload, dict):
        entries = payload.get("players", [])
    else:
        return []

    players: list[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        player = entry.get("player", entry)
        if isinstance(player, dict):
            players.append(player)
    return players


def parse_espn_weekly_response(payload: list | dict, season: int, week: int) -> pd.DataFrame:
    """Extract weekly projection rows from ESPN kona_player_info JSON."""
    rows = []
    for player in _iter_espn_player_records(payload):
        name = player.get("fullName")
        espn_id = player.get("id")
        pos = ESPN_POS_MAP.get(player.get("defaultPositionId"), "UNK")
        for stat in player.get("stats", []):
            if stat.get("scoringPeriodId") != week or stat.get("statSourceId") != 1:
                continue
            stats_blob = stat.get("stats") or {}
            proj = stat.get("appliedTotal")
            if proj is None and isinstance(stats_blob, dict):
                proj = stats_blob.get("0")
            if proj is not None:
                rows.append(
                    {
                        "season": season,
                        "week": week,
                        "espn_id": str(espn_id) if espn_id is not None else "",
                        "player_name": name,
                        "espn_position": pos,
                        "espn_proj": float(proj),
                        "name_key": _normalize_name(name or ""),
                    }
                )
                break

    return pd.DataFrame(rows)


def load_espn_to_gsis_crosswalk(force_refresh: bool = False) -> pd.DataFrame:
    """Map ESPN player IDs to nflverse gsis player_id via Sleeper."""
    df = players_dataframe(force_refresh=force_refresh)
    cross = df[df["espn_id"].astype(bool) & df["gsis_id"].astype(bool)].copy()
    cross["espn_id"] = cross["espn_id"].astype(str)
    cross["player_id"] = cross["gsis_id"].astype(str)
    return cross[["espn_id", "player_id", "full_name", "team"]].drop_duplicates(
        subset=["espn_id"], keep="first"
    )


def load_ffopportunity_weekly(season: int, force_refresh: bool = False) -> pd.DataFrame:
    """Load ffverse expected fantasy points (open-source analyst-style baseline)."""
    FFO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = FFO_CACHE_DIR / f"ep_weekly_{season}.parquet"
    if cache.exists() and not force_refresh:
        df = pd.read_parquet(cache)
    else:
        df = pd.read_parquet(FF_OPPORTUNITY_URL.format(season=season))
        df.to_parquet(cache, index=False)

    out = df[
        [
            "season",
            "week",
            "player_id",
            "full_name",
            "position",
            "total_fantasy_points_exp",
        ]
    ].rename(
        columns={
            "full_name": "player_name",
            "total_fantasy_points_exp": "ffopportunity_proj",
        }
    )
    out["season"] = pd.to_numeric(out["season"], errors="coerce").astype("Int64")
    out["week"] = pd.to_numeric(out["week"], errors="coerce").astype("Int64")
    out = (
        out.sort_values("ffopportunity_proj")
        .drop_duplicates(subset=["player_id", "season", "week"], keep="last")
    )
    return out


def fetch_espn_weekly_projections(
    season: int,
    week: int,
    force_refresh: bool = False,
) -> pd.DataFrame:
    """Fetch ESPN weekly projections via public player info API."""
    ESPN_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = ESPN_CACHE_DIR / f"{season}_week{week:02d}.parquet"
    if cache.exists() and not force_refresh:
        return pd.read_parquet(cache)

    headers = {
        "User-Agent": "Mozilla/5.0",
        "x-fantasy-filter": json.dumps({"players": {"limit": 5000}}),
    }
    url = ESPN_PLAYERS_URL.format(season=season)
    response = requests.get(
        url,
        headers=headers,
        params={"view": "kona_player_info", "scoringPeriodId": week},
        timeout=90,
    )
    response.raise_for_status()

    df = parse_espn_weekly_response(response.json(), season, week)
    df.to_parquet(cache, index=False)
    time.sleep(0.25)
    return df


def load_espn_season_projections(
    season: int,
    weeks: range | None = None,
    force_refresh: bool = False,
) -> pd.DataFrame:
    weeks = weeks or range(1, 19)
    frames = [
        fetch_espn_weekly_projections(season, week, force_refresh=force_refresh)
        for week in weeks
    ]
    frames = [f for f in frames if not f.empty]
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def attach_espn_projections(out: pd.DataFrame, season: int) -> pd.DataFrame:
    """Merge ESPN weekly projections onto backtest rows (ID crosswalk, then name)."""
    espn = load_espn_season_projections(season, weeks=range(1, 19))
    if espn.empty:
        out["espn_proj"] = float("nan")
        return out

    crosswalk = load_espn_to_gsis_crosswalk()
    espn = espn.copy()
    espn["espn_id"] = espn["espn_id"].astype(str)
    espn["season"] = pd.to_numeric(espn["season"], errors="coerce").astype("Int64")
    espn["week"] = pd.to_numeric(espn["week"], errors="coerce").astype("Int64")

    espn_id = espn.merge(crosswalk, on="espn_id", how="left")
    by_id = espn_id[espn_id["player_id"].notna()][
        ["player_id", "season", "week", "espn_proj"]
    ].drop_duplicates(subset=["player_id", "season", "week"])

    out = out.copy()
    out["player_id"] = out["player_id"].astype(str)
    out = out.merge(by_id, on=["player_id", "season", "week"], how="left", suffixes=("", "_id"))

    espn_name = espn[["season", "week", "name_key", "espn_proj"]].drop_duplicates(
        subset=["season", "week", "name_key"]
    )
    out = out.merge(
        espn_name.rename(columns={"espn_proj": "espn_proj_name"}),
        on=["season", "week", "name_key"],
        how="left",
    )
    out["espn_proj"] = out["espn_proj"].fillna(out["espn_proj_name"])
    out = out.drop(columns=["espn_proj_name"], errors="ignore")
    return out


def merge_external_projections(
    base_df: pd.DataFrame,
    season: int,
    include_espn: bool = True,
    include_fantasypros: bool = True,
) -> pd.DataFrame:
    """Attach ffopportunity, ESPN, and FantasyPros projections to backtest rows."""
    out = base_df.copy()
    name_col = "player_display_name" if "player_display_name" in out.columns else "player_name"
    out["name_key"] = out[name_col].map(_normalize_name)

    ffo = load_ffopportunity_weekly(season)
    for col in ("season", "week"):
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce").astype("Int64")
        if col in ffo.columns:
            ffo[col] = pd.to_numeric(ffo[col], errors="coerce").astype("Int64")
    out["player_id"] = out["player_id"].astype(str)
    ffo["player_id"] = ffo["player_id"].astype(str)
    out = out.merge(
        ffo[["player_id", "season", "week", "ffopportunity_proj"]],
        on=["player_id", "season", "week"],
        how="left",
    )

    if include_espn:
        out = attach_espn_projections(out, season)
    else:
        out["espn_proj"] = float("nan")

    if include_fantasypros:
        from src.integrations.fantasypros import attach_fantasypros_projections

        position = str(out["position"].iloc[0]).lower() if "position" in out.columns and len(out) else "qb"
        if position in ("te", "rec", "wr_te"):
            position = "wr"
        out = attach_fantasypros_projections(out, season, position)
    else:
        out["fantasypros_proj"] = float("nan")

    return out


def espn_is_fair_weekly_benchmark(espn_avg_mae: float | None, scoresense_avg_mae: float) -> bool:
    """True when ESPN MAE looks like weekly projections, not season-long totals."""
    if espn_avg_mae is None or not pd.notna(espn_avg_mae):
        return False
    return float(espn_avg_mae) <= ESPN_WEEKLY_MAE_CEILING
