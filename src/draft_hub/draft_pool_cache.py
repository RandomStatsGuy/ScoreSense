"""Materialized draft player pool — parquet artifact + in-process cache."""

from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from src.config import DRAFT_POOL_DIR, MODEL_DIR, PROCESSED_DATA_DIR
from src.projections.draft_projections import predict_draft_season

_POOL_CACHE: dict[int, tuple[str, pd.DataFrame]] = {}
_POOL_COMPUTE_LOCK = threading.Lock()


def _artifact_paths(season: int) -> tuple[Path, Path]:
    DRAFT_POOL_DIR.mkdir(parents=True, exist_ok=True)
    return (
        DRAFT_POOL_DIR / f"pool_{season}.parquet",
        DRAFT_POOL_DIR / f"pool_{season}.meta.json",
    )


def pool_fingerprint() -> str:
    """Hash of feature + model file mtimes — invalidates artifacts when inputs change."""
    parts: list[str] = []
    for pos in ("qb", "rb", "wr"):
        feat = PROCESSED_DATA_DIR / f"{pos}_mlready.parquet"
        if feat.exists():
            parts.append(f"feat:{pos}:{feat.stat().st_mtime_ns}")
    for name in ("qb_model.joblib", "rb_model_calibrated.joblib", "wr_model_calibrated.joblib"):
        model = MODEL_DIR / name
        if model.exists():
            parts.append(f"model:{name}:{model.stat().st_mtime_ns}")
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def _compute_pool(season: int) -> tuple[pd.DataFrame, dict[str, Any]]:
    frames: list[pd.DataFrame] = []
    sidecar: dict[str, Any] = {}
    for pos, label in (("qb", "QB"), ("rb", "RB"), ("wr", "WR")):
        df = predict_draft_season(pos, season=season)
        if df.empty:
            continue
        if not sidecar:
            sidecar = {
                "feature_season": int(df.attrs.get("feature_season") or season),
                "games_per_season": int(df.attrs.get("games_per_season") or 17),
                "roster_overlay": df.attrs.get("roster_overlay") or {},
                "depth_chart": df.attrs.get("depth_chart") or {"applied": False},
            }
        part = df.copy()
        if pos == "wr" and "position" in part.columns:
            raw_pos = part["position"].astype(str).str.upper()
            part["Position"] = raw_pos.where(raw_pos.isin(["WR", "TE"]), "WR")
        else:
            part["Position"] = label
        if "player_id" not in part.columns:
            part["player_id"] = part["Player"].astype(str)
        frames.append(part)
    if not frames:
        return pd.DataFrame(), sidecar
    return pd.concat(frames, ignore_index=True), sidecar


def save_pool_artifact(season: int, pool: pd.DataFrame | None = None, sidecar: dict[str, Any] | None = None) -> Path:
    """Write pool parquet + meta sidecar; refresh in-process cache."""
    if pool is None:
        pool, sidecar = _compute_pool(season)
    else:
        sidecar = sidecar or {}
    parquet_path, meta_path = _artifact_paths(season)
    pool.to_parquet(parquet_path, index=False)
    meta: dict[str, Any] = {
        "season": season,
        "fingerprint": pool_fingerprint(),
        "rows": int(len(pool)),
        "built_at": datetime.now(timezone.utc).isoformat(),
        **(sidecar or {}),
    }
    meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    fp = pool_fingerprint()
    _POOL_CACHE[season] = (fp, pool)
    return parquet_path


def load_draft_pool(season: int, *, allow_compute: bool = True) -> pd.DataFrame:
    """
    Load merged QB/RB/WR draft pool.

    Order: in-process cache → valid parquet artifact → live inference (persisted).
    """
    fp = pool_fingerprint()
    cached = _POOL_CACHE.get(season)
    if cached is not None and cached[0] == fp:
        return cached[1].copy()

    parquet_path, meta_path = _artifact_paths(season)
    if parquet_path.exists() and meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            meta = {}
        if meta.get("fingerprint") == fp:
            pool = pd.read_parquet(parquet_path)
            _POOL_CACHE[season] = (fp, pool)
            return pool.copy()

    if not allow_compute:
        return pd.DataFrame()

    with _POOL_COMPUTE_LOCK:
        cached = _POOL_CACHE.get(season)
        if cached is not None and cached[0] == fp:
            return cached[1].copy()
        if parquet_path.exists() and meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                meta = {}
            if meta.get("fingerprint") == fp:
                pool = pd.read_parquet(parquet_path)
                _POOL_CACHE[season] = (fp, pool)
                return pool.copy()

        pool, sidecar = _compute_pool(season)
        save_pool_artifact(season, pool, sidecar)
        return pool.copy()


def load_pool_meta(season: int) -> dict[str, Any]:
    _, meta_path = _artifact_paths(season)
    if not meta_path.exists():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def draft_pool_for_position(position: str, season: int) -> pd.DataFrame:
    """Return one position slice from the materialized draft pool."""
    pos = position.lower()
    label = {"qb": "QB", "rb": "RB", "wr": "WR"}.get(pos, pos.upper())
    pool = load_draft_pool(season)
    if pool.empty or "Position" not in pool.columns:
        return pd.DataFrame()
    part = pool[pool["Position"].astype(str).str.upper() == label].copy()
    meta = load_pool_meta(season)
    if meta:
        part.attrs["feature_season"] = meta.get("feature_season")
        part.attrs["games_per_season"] = meta.get("games_per_season")
        part.attrs["roster_overlay"] = meta.get("roster_overlay") or {}
        part.attrs["depth_chart"] = meta.get("depth_chart") or {"applied": False}
    return part.reset_index(drop=True)


def invalidate_pool_cache(season: int | None = None) -> None:
    if season is None:
        _POOL_CACHE.clear()
    else:
        _POOL_CACHE.pop(season, None)


def pool_artifact_status(season: int) -> dict[str, Any]:
    """Inspect artifact freshness (for refresh job reporting)."""
    parquet_path, meta_path = _artifact_paths(season)
    fp = pool_fingerprint()
    if not parquet_path.exists():
        return {"season": season, "cached": False, "fingerprint": fp}
    meta: dict[str, Any] = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            meta = {}
    return {
        "season": season,
        "cached": True,
        "stale": meta.get("fingerprint") != fp,
        "fingerprint": fp,
        "artifact_fingerprint": meta.get("fingerprint"),
        "rows": meta.get("rows"),
        "built_at": meta.get("built_at"),
        "path": str(parquet_path),
    }
