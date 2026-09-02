"""Materialized draft player pool — parquet artifact + in-process cache."""

from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from src.config import DRAFT_POOL_DIR, MODEL_DIR, PROCESSED_DATA_DIR, SEASON_QUANTILE_METHOD
from src.draft_hub.auction_values import RISK_WEIGHT
from src.projections.draft_projections import predict_draft_season

_POOL_CACHE: dict[int, tuple[str, pd.DataFrame]] = {}
_POOL_COMPUTE_LOCK = threading.Lock()

# Bump when WR/TE label handling or other position post-processing changes.
# Stale parquet artifacts that labeled every receiver WR must not keep serving.
POSITION_LOGIC_VERSION = "wr_te_v1"
SKILL_POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")


def _artifact_paths(season: int) -> tuple[Path, Path]:
    DRAFT_POOL_DIR.mkdir(parents=True, exist_ok=True)
    return (
        DRAFT_POOL_DIR / f"pool_{season}.parquet",
        DRAFT_POOL_DIR / f"pool_{season}.meta.json",
    )


def pool_fingerprint() -> str:
    """Hash of feature + model + rookie-override mtimes — invalidates artifacts when inputs change."""
    parts: list[str] = [
        # Bump when projection post-processing changes (e.g. vet backup scaling).
        "proj_logic:vet_backup_v2",
        # SCORE-2: schedule-aware MC season P10/P50/P90 aggregator vs legacy x17 scale.
        f"season_quantile_method:{SEASON_QUANTILE_METHOD}",
        # SCORE-3: risk-adjusted auction value weight / scoring logic version.
        f"raav_risk_weight:{RISK_WEIGHT}",
        "raav_risk_logic:v1",
        f"pos_logic:{POSITION_LOGIC_VERSION}",
    ]
    for pos in ("qb", "rb", "wr"):
        feat = PROCESSED_DATA_DIR / f"{pos}_mlready.parquet"
        if feat.exists():
            parts.append(f"feat:{pos}:{feat.stat().st_mtime_ns}")
    for name in ("qb_model.joblib", "rb_model_calibrated.joblib", "wr_model_calibrated.joblib"):
        model = MODEL_DIR / name
        if model.exists():
            parts.append(f"model:{name}:{model.stat().st_mtime_ns}")
    try:
        from src.config import ROOKIE_ROLE_OVERRIDES_PATH

        if ROOKIE_ROLE_OVERRIDES_PATH.exists():
            # Content hash (not mtime) so edits are detected even on filesystems
            # with coarse timestamp resolution.
            digest = hashlib.sha256(ROOKIE_ROLE_OVERRIDES_PATH.read_bytes()).hexdigest()[:16]
            parts.append(f"rookie_overrides:{digest}")
    except Exception:
        pass
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
                "season_quantile_method": df.attrs.get("season_quantile_method"),
                "season_coverage_meta": df.attrs.get("season_coverage_meta") or {},
            }
        part = df.copy()
        if pos == "wr":
            part["Position"] = _preserve_wr_te_labels(part)
        else:
            part["Position"] = label
        if "player_id" not in part.columns:
            part["player_id"] = part["Player"].astype(str)
        frames.append(part)
    if not frames:
        return pd.DataFrame(), sidecar
    pool = pd.concat(frames, ignore_index=True)
    sidecar = {
        **sidecar,
        "pos_logic": POSITION_LOGIC_VERSION,
        "position_counts": position_counts(pool),
    }
    return pool, sidecar


def _preserve_wr_te_labels(part: pd.DataFrame) -> pd.Series:
    """Keep WR vs TE from the receiver model. Map REC (and anything else) to WR.

    ``predict_from_features`` emits capital ``Position``; some callers still use
    lowercase ``position``. Reading only the lowercase column used to fall through
    and stamp every receiver as WR, which emptied the TE filter.
    """
    src = None
    if "position" in part.columns:
        src = part["position"]
    elif "Position" in part.columns:
        src = part["Position"]
    if src is None:
        return pd.Series(["WR"] * len(part), index=part.index)
    raw = src.astype(str).str.upper().str.strip()
    return raw.where(raw.isin(["WR", "TE"]), "WR")


def position_counts(pool: pd.DataFrame | None) -> dict[str, int]:
    """QB/RB/WR/TE/K/DEF counts for artifact metadata and stale-pool checks."""
    counts = {pos: 0 for pos in SKILL_POSITIONS}
    if pool is None or getattr(pool, "empty", True) or "Position" not in getattr(pool, "columns", []):
        return counts
    series = pool["Position"].astype(str).str.upper().str.strip()
    series = series.replace({"DST": "DEF", "D/ST": "DEF", "D": "DEF", "REC": "WR"})
    for pos, n in series.value_counts().to_dict().items():
        if pos in counts:
            counts[pos] = int(n)
        elif pos:
            counts[pos] = counts.get(pos, 0) + int(n)
    return counts


def missing_tight_ends(pool: pd.DataFrame | None = None, meta: dict[str, Any] | None = None) -> bool:
    counts = (meta or {}).get("position_counts") if meta else None
    if not counts:
        counts = position_counts(pool)
    return int((counts or {}).get("TE") or 0) == 0


def _artifact_is_current(meta: dict[str, Any], fp: str, pool: pd.DataFrame | None = None) -> bool:
    if meta.get("fingerprint") != fp:
        return False
    # Legacy sidecars (no pos_logic) that collapsed TE into WR must rebuild.
    if str(meta.get("pos_logic") or "") != POSITION_LOGIC_VERSION and missing_tight_ends(pool, meta):
        return False
    return True


def save_pool_artifact(season: int, pool: pd.DataFrame | None = None, sidecar: dict[str, Any] | None = None) -> Path:
    """Write pool parquet + meta sidecar; refresh in-process cache."""
    if pool is None:
        pool, sidecar = _compute_pool(season)
    else:
        sidecar = sidecar or {}
    parquet_path, meta_path = _artifact_paths(season)
    pool.to_parquet(parquet_path, index=False)
    counts = position_counts(pool)
    # Sidecar first so a stale attrs built_at cannot clobber the refresh time.
    meta: dict[str, Any] = {
        **(sidecar or {}),
        "season": season,
        "fingerprint": pool_fingerprint(),
        "pos_logic": POSITION_LOGIC_VERSION,
        "position_counts": counts,
        "missing_tight_ends": int(counts.get("TE") or 0) == 0,
        "rows": int(len(pool)),
        "built_at": datetime.now(timezone.utc).isoformat(),
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
        if _artifact_is_current(meta, fp):
            pool = pd.read_parquet(parquet_path)
            if _artifact_is_current(meta, fp, pool):
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
            if _artifact_is_current(meta, fp):
                pool = pd.read_parquet(parquet_path)
                if _artifact_is_current(meta, fp, pool):
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
    label = {"qb": "QB", "rb": "RB", "wr": "WR", "te": "TE", "k": "K", "def": "DEF", "dst": "DEF"}.get(
        pos, pos.upper()
    )
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
        part.attrs["season_quantile_method"] = meta.get("season_quantile_method")
        part.attrs["season_coverage_meta"] = meta.get("season_coverage_meta") or {}
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
    counts = meta.get("position_counts") or {}
    stale = not _artifact_is_current(meta, fp)
    missing_te = bool(meta.get("missing_tight_ends")) or int(counts.get("TE") or 0) == 0
    return {
        "season": season,
        "cached": True,
        "stale": stale,
        "fingerprint": fp,
        "artifact_fingerprint": meta.get("fingerprint"),
        "pos_logic": meta.get("pos_logic"),
        "position_counts": counts,
        "missing_tight_ends": missing_te,
        "rows": meta.get("rows"),
        "built_at": meta.get("built_at"),
        "path": str(parquet_path),
    }
