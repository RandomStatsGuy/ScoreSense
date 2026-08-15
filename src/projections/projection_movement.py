"""Projection movement / \"What Changed?\" artifacts (SCORE-7).

Compares successive weekly prediction artifacts during refresh and persists a
lightweight movement parquet. Request paths only read the artifact — never
recompute ML or rewrite Hub SQLite.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from src.config import WEEKLY_PREDICTIONS_DIR, WEEKLY_PROJECTION_CHANGES_DIR
from src.projections.player_compare import position_rank_map
from src.projections.weekly_cache import weekly_fingerprint

SCHEMA_VERSION = "projection_movement_v1"
POSITIONS = ("qb", "rb", "wr")

# Material movement gates (either threshold qualifies).
MATERIAL_P50_ABS = 1.5
MATERIAL_RANK_ABS = 3

_P50_KEYS = ("Projected Points", "P50", "p50")
_P10_KEYS = ("Low (P10)", "P10", "p10")
_P90_KEYS = ("High (P90)", "P90", "p90")

_MOVEMENT_CACHE: dict[str, tuple[str, pd.DataFrame, dict[str, Any]]] = {}


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        num = float(value)
        if math.isnan(num) or math.isinf(num):
            return None
        return num
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (np.bool_,)):
        return bool(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _round_opt(value: float | None, digits: int = 2) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)


def _pick_num(row: dict[str, Any] | pd.Series, keys: tuple[str, ...]) -> float | None:
    for key in keys:
        if isinstance(row, dict):
            if key not in row:
                continue
            value = row[key]
        else:
            if key not in row.index:
                continue
            value = row[key]
        num = _json_safe(value)
        if isinstance(num, (int, float)):
            return float(num)
    return None


def _artifact_paths(
    position: str,
    season: int,
    week: int,
    apply_injury: bool,
) -> tuple[Path, Path]:
    WEEKLY_PROJECTION_CHANGES_DIR.mkdir(parents=True, exist_ok=True)
    pos = position.lower()
    suffix = "" if apply_injury else "_no_inj"
    stem = f"{int(season)}_w{int(week)}_{pos}{suffix}"
    return (
        WEEKLY_PROJECTION_CHANGES_DIR / f"{stem}.parquet",
        WEEKLY_PROJECTION_CHANGES_DIR / f"{stem}.meta.json",
    )


def _weekly_meta_path(
    position: str,
    season: int,
    week: int,
    apply_injury: bool,
) -> Path:
    pos = position.lower()
    suffix = "" if apply_injury else "_no_inj"
    stem = f"{int(season)}_w{int(week)}_{pos}{suffix}"
    return WEEKLY_PREDICTIONS_DIR / f"{stem}.meta.json"


def load_previous_weekly_snapshot(
    position: str,
    season: int,
    week: int,
    apply_injury_adjustments: bool,
) -> tuple[pd.DataFrame | None, dict[str, Any] | None]:
    """Load the on-disk weekly artifact before it is overwritten (refresh path)."""
    pos = position.lower()
    suffix = "" if apply_injury_adjustments else "_no_inj"
    stem = f"{int(season)}_w{int(week)}_{pos}{suffix}"
    parquet_path = WEEKLY_PREDICTIONS_DIR / f"{stem}.parquet"
    meta_path = WEEKLY_PREDICTIONS_DIR / f"{stem}.meta.json"
    if not parquet_path.exists() or not meta_path.exists():
        return None, None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        df = pd.read_parquet(parquet_path)
    except (json.JSONDecodeError, OSError, ValueError):
        return None, None
    if df is None or df.empty:
        return None, meta
    return df, meta


def movement_fingerprint(
    *,
    previous_fingerprint: str | None,
    current_fingerprint: str | None,
    apply_injury_adjustments: bool,
) -> str:
    parts = [
        f"schema:{SCHEMA_VERSION}",
        f"weekly:{weekly_fingerprint()}",
        f"previous:{previous_fingerprint or 'none'}",
        f"current:{current_fingerprint or 'none'}",
        f"inj:{int(bool(apply_injury_adjustments))}",
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def _is_material(
    p50_delta: float | None,
    rank_delta: float | None,
) -> bool:
    if p50_delta is not None and abs(float(p50_delta)) >= MATERIAL_P50_ABS:
        return True
    if rank_delta is not None and abs(int(rank_delta)) >= MATERIAL_RANK_ABS:
        return True
    return False


def build_projection_movement_rows(
    previous_df: pd.DataFrame | None,
    current_df: pd.DataFrame,
    *,
    season: int,
    week: int,
    position: str,
    generated_at: str | None = None,
) -> pd.DataFrame:
    """Compare successive weekly frames; heavy work for the refresh path only."""
    generated_at = generated_at or datetime.now(timezone.utc).isoformat()
    pos = str(position or "").upper()
    if current_df is None or current_df.empty or "player_id" not in current_df.columns:
        return pd.DataFrame()

    current_ranks = position_rank_map(current_df)
    previous_ranks = position_rank_map(previous_df) if previous_df is not None else {}

    prev_by_id: dict[str, pd.Series] = {}
    if previous_df is not None and not previous_df.empty and "player_id" in previous_df.columns:
        for _, row in previous_df.iterrows():
            pid = str(row.get("player_id") or "").strip()
            if pid:
                prev_by_id[pid] = row

    rows: list[dict[str, Any]] = []
    for _, row in current_df.iterrows():
        pid = str(row.get("player_id") or "").strip()
        if not pid:
            continue
        current_p50 = _pick_num(row, _P50_KEYS)
        current_p10 = _pick_num(row, _P10_KEYS)
        current_p90 = _pick_num(row, _P90_KEYS)
        current_rank = current_ranks.get(pid)

        prev = prev_by_id.get(pid)
        previous_p50 = _pick_num(prev, _P50_KEYS) if prev is not None else None
        previous_p10 = _pick_num(prev, _P10_KEYS) if prev is not None else None
        previous_p90 = _pick_num(prev, _P90_KEYS) if prev is not None else None
        previous_rank = previous_ranks.get(pid)

        p50_delta = None
        if previous_p50 is not None and current_p50 is not None:
            p50_delta = float(current_p50) - float(previous_p50)

        # Positive rank_delta = rose (RB18 → RB11 ⇒ +7).
        rank_delta = None
        if previous_rank is not None and current_rank is not None:
            rank_delta = int(previous_rank) - int(current_rank)

        material = _is_material(p50_delta, rank_delta)
        rows.append(
            {
                "player_id": pid,
                "player_name": str(row.get("Player") or row.get("player_name") or ""),
                "position": str(row.get("Position") or pos).upper(),
                "team": str(row.get("Team") or row.get("team") or "") or None,
                "season": int(season),
                "week": int(week),
                "previous_p50": _round_opt(previous_p50),
                "current_p50": _round_opt(current_p50),
                "p50_delta": _round_opt(p50_delta),
                "previous_rank": int(previous_rank) if previous_rank is not None else None,
                "current_rank": int(current_rank) if current_rank is not None else None,
                "rank_delta": int(rank_delta) if rank_delta is not None else None,
                "previous_p10": _round_opt(previous_p10),
                "previous_p90": _round_opt(previous_p90),
                "current_p10": _round_opt(current_p10),
                "current_p90": _round_opt(current_p90),
                "material": bool(material),
                "material_at": generated_at if material else None,
                "generated_at": generated_at,
            }
        )

    if not rows:
        return pd.DataFrame()
    out = pd.DataFrame(rows)
    # Biggest movers first for cheap serve-side sorting.
    out["_abs_rank"] = out["rank_delta"].abs().fillna(0)
    out["_abs_p50"] = out["p50_delta"].abs().fillna(0.0)
    out = out.sort_values(
        ["material", "_abs_rank", "_abs_p50"],
        ascending=[False, False, False],
    ).drop(columns=["_abs_rank", "_abs_p50"])
    return out.reset_index(drop=True)


def save_projection_movement_artifact(
    position: str,
    season: int,
    week: int,
    apply_injury_adjustments: bool,
    current_df: pd.DataFrame,
    *,
    previous_df: pd.DataFrame | None = None,
    previous_meta: dict[str, Any] | None = None,
    current_fingerprint: str | None = None,
    current_built_at: str | None = None,
) -> Path:
    """Persist movement parquet + meta next to weekly prediction artifacts."""
    generated_at = datetime.now(timezone.utc).isoformat()
    prev_fp = None if not previous_meta else previous_meta.get("fingerprint")
    curr_fp = current_fingerprint or weekly_fingerprint()
    available = previous_df is not None and not previous_df.empty

    if available:
        frame = build_projection_movement_rows(
            previous_df,
            current_df,
            season=int(season),
            week=int(week),
            position=position,
            generated_at=generated_at,
        )
    else:
        # First artifact of the cycle — empty frame, available=false.
        frame = pd.DataFrame()

    parquet_path, meta_path = _artifact_paths(
        position, int(season), int(week), apply_injury_adjustments
    )
    frame.to_parquet(parquet_path, index=False)

    fp = movement_fingerprint(
        previous_fingerprint=str(prev_fp) if prev_fp else None,
        current_fingerprint=str(curr_fp) if curr_fp else None,
        apply_injury_adjustments=apply_injury_adjustments,
    )
    meta: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "position": position.lower(),
        "season": int(season),
        "week": int(week),
        "apply_injury_adjustments": bool(apply_injury_adjustments),
        "available": bool(available),
        "fingerprint": fp,
        "weekly_fingerprint": weekly_fingerprint(),
        "previous_fingerprint": prev_fp,
        "current_fingerprint": curr_fp,
        "previous_built_at": None if not previous_meta else previous_meta.get("built_at"),
        "current_built_at": current_built_at or generated_at,
        "generated_at": generated_at,
        "rows": int(len(frame)),
        "material_rows": int(frame["material"].sum()) if not frame.empty and "material" in frame.columns else 0,
        "note": (
            None
            if available
            else "No previous valid weekly projection artifact; movement unavailable."
        ),
    }
    meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")

    cache_key = _cache_key(position, int(season), int(week), apply_injury_adjustments)
    _MOVEMENT_CACHE[cache_key] = (fp, frame.copy(), meta)
    return parquet_path


def _cache_key(position: str, season: int, week: int, apply_injury: bool) -> str:
    return f"{position.lower()}:{season}:w{week}:inj{int(apply_injury)}"


def invalidate_projection_movement_cache() -> None:
    _MOVEMENT_CACHE.clear()


def load_projection_movement(
    position: str,
    season: int,
    week: int,
    *,
    apply_injury_adjustments: bool = True,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Serve-only load of the movement artifact (no compute)."""
    pos = position.lower()
    key = _cache_key(pos, int(season), int(week), apply_injury_adjustments)
    parquet_path, meta_path = _artifact_paths(
        pos, int(season), int(week), apply_injury_adjustments
    )
    if not parquet_path.exists() or not meta_path.exists():
        raise FileNotFoundError(
            f"Projection movement artifact missing for {pos} {season} week {week}."
        )
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise FileNotFoundError(
            f"Projection movement meta unreadable for {pos} {season} week {week}"
        ) from exc

    cached = _MOVEMENT_CACHE.get(key)
    if cached is not None and cached[0] == meta.get("fingerprint"):
        return cached[1].copy(), dict(cached[2])

    df = pd.read_parquet(parquet_path)
    _MOVEMENT_CACHE[key] = (str(meta.get("fingerprint") or ""), df.copy(), meta)
    return df, meta


def movement_index_by_player_id(
    position: str,
    season: int,
    week: int,
    *,
    apply_injury_adjustments: bool = True,
) -> dict[str, dict[str, Any]]:
    """Thin helper for joining movement onto prediction rows."""
    try:
        df, meta = load_projection_movement(
            position,
            season,
            week,
            apply_injury_adjustments=apply_injury_adjustments,
        )
    except FileNotFoundError:
        return {}
    if not meta.get("available") or df.empty or "player_id" not in df.columns:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for rec in df.to_dict(orient="records"):
        pid = str(rec.get("player_id") or "").strip()
        if not pid:
            continue
        out[pid] = {
            "previous_p50": _json_safe(rec.get("previous_p50")),
            "current_p50": _json_safe(rec.get("current_p50")),
            "p50_delta": _json_safe(rec.get("p50_delta")),
            "previous_rank": _json_safe(rec.get("previous_rank")),
            "current_rank": _json_safe(rec.get("current_rank")),
            "rank_delta": _json_safe(rec.get("rank_delta")),
            "previous_p10": _json_safe(rec.get("previous_p10")),
            "previous_p90": _json_safe(rec.get("previous_p90")),
            "material": bool(rec.get("material")),
            "material_at": rec.get("material_at"),
        }
    return out


def build_projection_movement_payload(
    position: str,
    season: int,
    week: int,
    *,
    apply_injury_adjustments: bool = True,
    material_only: bool = False,
    limit: int | None = None,
    player_ids: list[str] | None = None,
) -> dict[str, Any]:
    """API payload for Biggest Movers / What Changed views."""
    pos = position.lower()
    try:
        df, meta = load_projection_movement(
            pos,
            int(season),
            int(week),
            apply_injury_adjustments=apply_injury_adjustments,
        )
    except FileNotFoundError:
        return {
            "position": pos,
            "season": int(season),
            "week": int(week),
            "available": False,
            "count": 0,
            "changes": [],
            "meta": {
                "apply_injury_adjustments": bool(apply_injury_adjustments),
                "schema_version": SCHEMA_VERSION,
                "note": "Projection movement artifact not found.",
            },
        }

    available = bool(meta.get("available"))
    changes: list[dict[str, Any]] = []
    if available and not df.empty:
        records = df.to_dict(orient="records")
        if player_ids:
            wanted = {str(p).strip() for p in player_ids if str(p).strip()}
            records = [r for r in records if str(r.get("player_id")) in wanted]
        if material_only:
            records = [r for r in records if r.get("material")]
        if limit is not None and limit > 0:
            records = records[: int(limit)]
        for rec in records:
            changes.append(
                {
                    "player_id": rec.get("player_id"),
                    "player_name": rec.get("player_name"),
                    "position": rec.get("position"),
                    "team": rec.get("team"),
                    "season": _json_safe(rec.get("season")),
                    "week": _json_safe(rec.get("week")),
                    "previous_p50": _json_safe(rec.get("previous_p50")),
                    "current_p50": _json_safe(rec.get("current_p50")),
                    "p50_delta": _json_safe(rec.get("p50_delta")),
                    "previous_rank": _json_safe(rec.get("previous_rank")),
                    "current_rank": _json_safe(rec.get("current_rank")),
                    "rank_delta": _json_safe(rec.get("rank_delta")),
                    "previous_p10": _json_safe(rec.get("previous_p10")),
                    "previous_p90": _json_safe(rec.get("previous_p90")),
                    "current_p10": _json_safe(rec.get("current_p10")),
                    "current_p90": _json_safe(rec.get("current_p90")),
                    "material": bool(rec.get("material")),
                    "material_at": rec.get("material_at"),
                    "generated_at": rec.get("generated_at") or meta.get("generated_at"),
                }
            )

    return {
        "position": pos,
        "season": int(season),
        "week": int(week),
        "available": available,
        "count": len(changes),
        "changes": changes,
        "meta": {
            "apply_injury_adjustments": bool(apply_injury_adjustments),
            "schema_version": meta.get("schema_version") or SCHEMA_VERSION,
            "fingerprint": meta.get("fingerprint"),
            "previous_fingerprint": meta.get("previous_fingerprint"),
            "current_fingerprint": meta.get("current_fingerprint"),
            "previous_built_at": meta.get("previous_built_at"),
            "current_built_at": meta.get("current_built_at"),
            "generated_at": meta.get("generated_at"),
            "rows": meta.get("rows"),
            "material_rows": meta.get("material_rows"),
            "note": meta.get("note"),
            "material_p50_abs": MATERIAL_P50_ABS,
            "material_rank_abs": MATERIAL_RANK_ABS,
        },
    }


def prewarm_projection_movement(
    season: int,
    week: int,
    *,
    positions: tuple[str, ...] = POSITIONS,
    injury_variants: tuple[bool, ...] = (True, False),
) -> dict[str, Any]:
    """Rebuild movement artifacts from the current on-disk weekly predictions.

    Prefer the hook inside ``save_weekly_artifact`` during live refresh. This
    helper recomputes movement when a previous movement file is missing but
    weekly artifacts already exist (ops / backfill). Without a prior weekly
    snapshot it writes ``available=false`` baselines.
    """
    from src.projections.weekly_cache import load_weekly_prediction

    results: dict[str, Any] = {}
    for pos in positions:
        for apply_injury in injury_variants:
            key = f"{pos}:inj{int(apply_injury)}"
            try:
                current = load_weekly_prediction(
                    pos,
                    season=int(season),
                    week=int(week),
                    apply_injury_adjustments=apply_injury,
                    allow_compute=False,
                )
                if current.empty:
                    results[key] = {"status": "skip", "reason": "empty_weekly"}
                    continue
                meta_path = _weekly_meta_path(pos, int(season), int(week), apply_injury)
                current_meta: dict[str, Any] = {}
                if meta_path.exists():
                    try:
                        current_meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    except (json.JSONDecodeError, OSError):
                        current_meta = {}
                # Backfill without a prior snapshot → unavailable baseline.
                path = save_projection_movement_artifact(
                    pos,
                    int(season),
                    int(week),
                    apply_injury,
                    current,
                    previous_df=None,
                    previous_meta=None,
                    current_fingerprint=current_meta.get("fingerprint"),
                    current_built_at=current_meta.get("built_at"),
                )
                results[key] = {
                    "status": "ok",
                    "path": str(path),
                    "available": False,
                    "note": "baseline_without_previous",
                }
            except Exception as exc:  # noqa: BLE001 — job status aggregation
                results[key] = {"status": "error", "detail": str(exc)}
    return results
