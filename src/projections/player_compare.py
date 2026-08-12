"""Start/sit player comparison from weekly projection artifacts (SCORE-4).

Reuses ``load_weekly_prediction`` — no Hub SQLite persistence, no LLM text.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd

from src.config import PROCESSED_DATA_DIR
from src.core.projection_context import resolve_projection_context
from src.projections.weekly_cache import load_weekly_prediction

POSITIONS = ("qb", "rb", "wr")
FLEX_POSITIONS = frozenset({"rb", "wr"})
MIN_COMPARE_PLAYERS = 2
MAX_COMPARE_PLAYERS = 4

_P50_KEYS = ("Projected Points", "P50", "p50")
_P10_KEYS = ("Low (P10)", "P10", "p10")
_P90_KEYS = ("High (P90)", "P90", "p90")


def parse_compare_player_ids(raw: str | Sequence[str] | None) -> list[str]:
    """Normalize a comma-separated string or sequence into ordered unique IDs."""
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.split(",")]
    else:
        parts = [str(p).strip() for p in raw]
    seen: set[str] = set()
    out: list[str] = []
    for pid in parts:
        if not pid or pid in seen:
            continue
        seen.add(pid)
        out.append(pid)
    return out


def validate_compare_player_ids(player_ids: Sequence[str]) -> list[str]:
    ids = list(player_ids)
    if len(ids) < MIN_COMPARE_PLAYERS:
        raise ValueError(f"Compare requires {MIN_COMPARE_PLAYERS}–{MAX_COMPARE_PLAYERS} player_ids")
    if len(ids) > MAX_COMPARE_PLAYERS:
        raise ValueError(f"Compare supports at most {MAX_COMPARE_PLAYERS} player_ids")
    return ids


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


def _row_dict(row: pd.Series) -> dict[str, Any]:
    return {str(k): _json_safe(v) for k, v in row.items()}


def _pick_num(row: dict[str, Any] | pd.Series, keys: Iterable[str]) -> float | None:
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


def season_week_context(season: int | None, week: int | None) -> tuple[int, int]:
    path = PROCESSED_DATA_DIR / "qb_mlready.parquet"
    df = pd.read_parquet(path, columns=["season", "week"])
    return resolve_projection_context(df, season, week)


def volatility(p10: float | None, p50: float | None, p90: float | None) -> float | None:
    """Half-range coefficient of variation: (P90−P10) / (2 × P50)."""
    if p10 is None or p50 is None or p90 is None:
        return None
    if p50 <= 0:
        return None
    return (p90 - p10) / (2.0 * p50)


def position_rank_map(preds: pd.DataFrame) -> dict[str, int]:
    """1-based rank by projected points within a position slate (ties → min rank)."""
    if preds.empty or "player_id" not in preds.columns:
        return {}
    metric_col = next((c for c in _P50_KEYS if c in preds.columns), None)
    if metric_col is None:
        return {}
    ranked = preds.copy()
    ranked["_pid"] = ranked["player_id"].astype(str)
    ranked["_metric"] = pd.to_numeric(ranked[metric_col], errors="coerce")
    ranked = ranked.dropna(subset=["_metric"]).sort_values("_metric", ascending=False)
    ranks = ranked["_metric"].rank(method="min", ascending=False).astype(int)
    return dict(zip(ranked["_pid"], ranks, strict=False))


def _flex_compatible(positions: Sequence[str]) -> bool:
    norms = {str(p or "").lower() for p in positions if p}
    if not norms:
        return False
    if norms <= FLEX_POSITIONS:
        return True
    if norms == {"qb"}:
        return True
    return False


def _leader(
    players: Sequence[dict[str, Any]],
    metric_key: str,
) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    best_val = float("-inf")
    for player in players:
        value = player.get(metric_key)
        if not isinstance(value, (int, float)):
            continue
        if float(value) > best_val:
            best_val = float(value)
            best = player
    if best is None:
        return None
    return {
        "player_id": best["player_id"],
        "player_name": best.get("player_name"),
        "value": round(best_val, 2),
    }


def build_recommendation(players: Sequence[dict[str, Any]]) -> list[str]:
    """Deterministic start/sit bullets from projection math (no LLM)."""
    if len(players) < 2:
        return []

    scored = [p for p in players if isinstance(p.get("p50"), (int, float))]
    if len(scored) < 2:
        return []

    by_p50 = sorted(scored, key=lambda p: float(p["p50"]), reverse=True)
    leader, runner = by_p50[0], by_p50[1]
    delta = float(leader["p50"]) - float(runner["p50"])
    lines = [
        f"P50 favors {leader.get('player_name') or leader['player_id']} "
        f"by +{delta:.1f} points"
    ]

    floor_leader = _leader(scored, "p10")
    ceil_leader = _leader(scored, "p90")
    if floor_leader:
        lines.append(f"Higher floor: {floor_leader.get('player_name') or floor_leader['player_id']}")
    if ceil_leader:
        lines.append(
            f"Higher ceiling: {ceil_leader.get('player_name') or ceil_leader['player_id']}"
        )
    return lines


def _ensure_weekly_pool(
    position: str,
    season: int,
    week: int,
    *,
    apply_injury_adjustments: bool,
    compute_fn: Any | None = None,
) -> pd.DataFrame:
    """Load weekly artifact; optionally warm via caller-supplied compute hook."""
    preds = load_weekly_prediction(
        position,
        season=season,
        week=week,
        apply_injury_adjustments=apply_injury_adjustments,
        allow_compute=False,
    )
    if not preds.empty:
        return preds
    if compute_fn is not None:
        compute_fn(position, season, week, apply_injury_adjustments)
        preds = load_weekly_prediction(
            position,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
            allow_compute=False,
        )
        if not preds.empty:
            return preds
    # Last resort: allow in-process compute (tests / cold local without pool).
    return load_weekly_prediction(
        position,
        season=season,
        week=week,
        apply_injury_adjustments=apply_injury_adjustments,
        allow_compute=True,
    )


def build_player_compare(
    player_ids: Sequence[str],
    *,
    season: int | None = None,
    week: int | None = None,
    apply_injury_adjustments: bool = True,
    compute_fn: Any | None = None,
) -> dict[str, Any]:
    """Build a side-by-side weekly comparison payload for 2–4 player IDs."""
    ids = validate_compare_player_ids(parse_compare_player_ids(list(player_ids)))
    resolved_season, resolved_week = season_week_context(season, week)

    pools: dict[str, pd.DataFrame] = {}
    rank_maps: dict[str, dict[str, int]] = {}
    for pos in POSITIONS:
        try:
            pool = _ensure_weekly_pool(
                pos,
                resolved_season,
                resolved_week,
                apply_injury_adjustments=apply_injury_adjustments,
                compute_fn=compute_fn,
            )
        except FileNotFoundError:
            pool = pd.DataFrame()
        pools[pos] = pool
        rank_maps[pos] = position_rank_map(pool)

    # player_id → (position, row)
    index: dict[str, tuple[str, pd.Series]] = {}
    for pos, pool in pools.items():
        if pool.empty or "player_id" not in pool.columns:
            continue
        for _, row in pool.iterrows():
            pid = str(row["player_id"])
            if pid in ids and pid not in index:
                index[pid] = (pos, row)

    players: list[dict[str, Any]] = []
    missing: list[str] = []
    for pid in ids:
        hit = index.get(pid)
        if hit is None:
            missing.append(pid)
            continue
        pos, row = hit
        raw = _row_dict(row)
        p10 = _pick_num(raw, _P10_KEYS)
        p50 = _pick_num(raw, _P50_KEYS)
        p90 = _pick_num(raw, _P90_KEYS)
        spread = None if p10 is None or p90 is None else round(p90 - p10, 2)
        vol = volatility(p10, p50, p90)
        players.append(
            {
                "player_id": pid,
                "player_name": raw.get("Player"),
                "position": str(raw.get("Position") or pos).upper(),
                "position_key": pos,
                "team": raw.get("Team"),
                "opponent": raw.get("Opponent"),
                "p10": None if p10 is None else round(p10, 2),
                "p50": None if p50 is None else round(p50, 2),
                "p90": None if p90 is None else round(p90, 2),
                "spread": spread,
                "volatility": None if vol is None else round(vol, 4),
                "position_rank": rank_maps.get(pos, {}).get(pid),
                "injury_status": raw.get("Injury Status") or None,
                "projection": raw,
            }
        )

    if len(players) < MIN_COMPARE_PLAYERS:
        raise ValueError(
            "Could not resolve enough weekly projections for comparison "
            f"(found {len(players)}, need {MIN_COMPARE_PLAYERS}). "
            f"Missing: {', '.join(missing) or 'none'}"
        )

    comparison = {
        "highest_median": _leader(players, "p50"),
        "highest_floor": _leader(players, "p10"),
        "highest_ceiling": _leader(players, "p90"),
        "flex_compatible": _flex_compatible([p.get("position_key", "") for p in players]),
        "recommendation": build_recommendation(players),
        "deltas": _pairwise_p50_deltas(players),
    }

    note = (
        "Start/sit comparison from ScoreSense weekly P10/P50/P90. "
        "Recommendation language is deterministic from model outputs (no LLM)."
    )
    return {
        "count": len(players),
        "meta": {
            "season": resolved_season,
            "week": resolved_week,
            "apply_injury_adjustments": apply_injury_adjustments,
        },
        "note": note,
        "players": players,
        "comparison": comparison,
        "missing_player_ids": missing,
    }


def _pairwise_p50_deltas(players: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ordered P50 diffs vs the median leader (UI can show projection difference)."""
    scored = [p for p in players if isinstance(p.get("p50"), (int, float))]
    if len(scored) < 2:
        return []
    leader = max(scored, key=lambda p: float(p["p50"]))
    deltas: list[dict[str, Any]] = []
    for other in scored:
        if other["player_id"] == leader["player_id"]:
            continue
        diff = float(leader["p50"]) - float(other["p50"])
        deltas.append(
            {
                "metric": "p50",
                "leader_id": leader["player_id"],
                "leader_name": leader.get("player_name"),
                "other_id": other["player_id"],
                "other_name": other.get("player_name"),
                "diff": round(diff, 2),
            }
        )
    return deltas


def filter_projections_by_ids(
    projections: Sequence[dict[str, Any]],
    player_ids: Sequence[str],
) -> list[dict[str, Any]]:
    """Preserve request order when filtering a `/api/predict` projection list."""
    wanted = parse_compare_player_ids(list(player_ids))
    if not wanted:
        return list(projections)
    by_id = {
        str(rec.get("player_id")): rec
        for rec in projections
        if rec.get("player_id") is not None
    }
    return [by_id[pid] for pid in wanted if pid in by_id]
