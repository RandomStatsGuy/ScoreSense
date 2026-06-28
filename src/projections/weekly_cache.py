"""Materialized weekly predictions — parquet artifact + in-process cache."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from src.config import MODEL_DIR, PROCESSED_DATA_DIR, WEEKLY_PREDICTIONS_DIR
from src.projections.predict import predict_upcoming_week

_WEEKLY_CACHE: dict[str, tuple[str, pd.DataFrame]] = {}


def _cache_key(position: str, season: int, week: int, apply_injury: bool) -> str:
    return f"{position.lower()}:{season}:w{week}:inj{int(apply_injury)}"


def _artifact_paths(position: str, season: int, week: int, apply_injury: bool) -> tuple[Path, Path]:
    WEEKLY_PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
    pos = position.lower()
    suffix = "" if apply_injury else "_no_inj"
    stem = f"{season}_w{week}_{pos}{suffix}"
    return (
        WEEKLY_PREDICTIONS_DIR / f"{stem}.parquet",
        WEEKLY_PREDICTIONS_DIR / f"{stem}.meta.json",
    )


def weekly_fingerprint() -> str:
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


def load_weekly_prediction(
    position: str,
    season: int | None = None,
    week: int | None = None,
    *,
    apply_injury_adjustments: bool = True,
    allow_compute: bool = True,
) -> pd.DataFrame:
    """Load cached weekly predictions or compute and persist."""
    if season is None or week is None:
        return predict_upcoming_week(
            position,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
        )

    pos = position.lower()
    fp = weekly_fingerprint()
    key = _cache_key(pos, int(season), int(week), apply_injury_adjustments)
    cached = _WEEKLY_CACHE.get(key)
    if cached is not None and cached[0] == fp:
        out = cached[1].copy()
        for k, v in cached[1].attrs.items():
            out.attrs[k] = v
        return out

    parquet_path, meta_path = _artifact_paths(pos, int(season), int(week), apply_injury_adjustments)
    if parquet_path.exists() and meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            meta = {}
        if meta.get("fingerprint") == fp:
            df = pd.read_parquet(parquet_path)
            _apply_saved_attrs(df, meta)
            _WEEKLY_CACHE[key] = (fp, df.copy())
            return df

    if not allow_compute:
        return pd.DataFrame()

    df = predict_upcoming_week(
        pos,
        season=int(season),
        week=int(week),
        apply_injury_adjustments=apply_injury_adjustments,
    )
    save_weekly_artifact(pos, int(season), int(week), apply_injury_adjustments, df)
    return df


def save_weekly_artifact(
    position: str,
    season: int,
    week: int,
    apply_injury_adjustments: bool,
    df: pd.DataFrame,
) -> Path:
    parquet_path, meta_path = _artifact_paths(position, season, week, apply_injury_adjustments)
    df.to_parquet(parquet_path, index=False)
    meta: dict[str, Any] = {
        "position": position.lower(),
        "season": season,
        "week": week,
        "apply_injury_adjustments": apply_injury_adjustments,
        "fingerprint": weekly_fingerprint(),
        "rows": int(len(df)),
        "built_at": datetime.now(timezone.utc).isoformat(),
        "attrs": {
            k: df.attrs[k]
            for k in ("inference_meta", "projection_note", "preseason_mode")
            if k in df.attrs
        },
    }
    meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    key = _cache_key(position, season, week, apply_injury_adjustments)
    _WEEKLY_CACHE[key] = (meta["fingerprint"], df.copy())
    return parquet_path


def _apply_saved_attrs(df: pd.DataFrame, meta: dict[str, Any]) -> None:
    attrs = meta.get("attrs") or {}
    for key, value in attrs.items():
        df.attrs[key] = value


def invalidate_weekly_cache() -> None:
    _WEEKLY_CACHE.clear()


def prewarm_weekly_predictions(
    season: int,
    week: int,
    *,
    positions: tuple[str, ...] = ("qb", "rb", "wr"),
    injury_variants: tuple[bool, ...] = (True, False),
) -> dict[str, int]:
    """Materialize weekly parquet artifacts for dashboard hot paths."""
    counts: dict[str, int] = {}
    for pos in positions:
        for apply_injury in injury_variants:
            df = load_weekly_prediction(
                pos,
                season=int(season),
                week=int(week),
                apply_injury_adjustments=apply_injury,
            )
            counts[f"{pos}:inj{int(apply_injury)}"] = int(len(df))
    return counts

