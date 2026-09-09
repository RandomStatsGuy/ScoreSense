"""Cached nflverse seasonal rosters for projection identity (team + position)."""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd

from src.config import CACHE_DIR

ROSTER_TTL_SECONDS = 12 * 3600
_ROSTER_CACHE: dict[int, tuple[float, pd.DataFrame]] = {}


def roster_cache_path(season: int) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"nflverse_roster_{int(season)}.parquet"


def _normalize_roster(raw: pd.DataFrame) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame(columns=["player_id", "player_name", "team", "position", "status"])

    out = raw.copy()
    if "player_id" not in out.columns and "gsis_id" in out.columns:
        out["player_id"] = out["gsis_id"]
    if "player_name" not in out.columns and "full_name" in out.columns:
        out["player_name"] = out["full_name"]
    if "week" in out.columns:
        out = out.sort_values("week").groupby("player_id", as_index=False).tail(1)

    keep = [c for c in ("player_id", "player_name", "team", "position", "status") if c in out.columns]
    out = out[keep].copy()
    out["player_id"] = out["player_id"].astype(str).str.strip()
    out["player_name"] = out.get("player_name", pd.Series("", index=out.index)).astype(str)
    out["team"] = out.get("team", pd.Series("", index=out.index)).astype(str).str.strip().str.upper()
    out["position"] = out.get("position", pd.Series("", index=out.index)).astype(str).str.strip().str.upper()
    out["status"] = out.get("status", pd.Series("", index=out.index)).astype(str).str.strip().str.upper()
    out = out[out["player_id"].ne("") & out["player_id"].ne("nan")]
    return out.drop_duplicates(subset=["player_id"], keep="last").reset_index(drop=True)


def load_seasonal_roster(season: int, *, force_refresh: bool = False) -> pd.DataFrame:
    """Latest nflverse seasonal roster for ``season``, disk-cached for 12h."""
    season = int(season)
    now = time.time()
    cached = _ROSTER_CACHE.get(season)
    if not force_refresh and cached is not None:
        loaded_at, frame = cached
        if now - loaded_at < ROSTER_TTL_SECONDS:
            return frame.copy()

    path = roster_cache_path(season)
    if not force_refresh and path.exists():
        age = now - path.stat().st_mtime
        if age < ROSTER_TTL_SECONDS:
            frame = _normalize_roster(pd.read_parquet(path))
            _ROSTER_CACHE[season] = (now, frame)
            return frame.copy()

    try:
        from src.etl.nflverse_etl import _import_nfl_data_py

        nfl = _import_nfl_data_py()
        raw = nfl.import_seasonal_rosters([season])
        frame = _normalize_roster(raw)
        try:
            frame.to_parquet(path, index=False)
        except OSError:
            pass
        _ROSTER_CACHE[season] = (now, frame)
        return frame.copy()
    except Exception:
        if path.exists():
            frame = _normalize_roster(pd.read_parquet(path))
            _ROSTER_CACHE[season] = (now, frame)
            return frame.copy()
        return pd.DataFrame(columns=["player_id", "player_name", "team", "position", "status"])


def invalidate_roster_cache(season: int | None = None) -> None:
    if season is None:
        _ROSTER_CACHE.clear()
    else:
        _ROSTER_CACHE.pop(int(season), None)
