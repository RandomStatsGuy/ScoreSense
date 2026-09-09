"""SCORE-82: private Need vs Tax nomination overlay for the live auction room.

Tax is advice only — never broadcast. Attach under room-state ``viewer`` only.
Suggested bids come from the draft-pool artifact / warm pool payload; never live
``predict_*`` on this hot path.
"""

from __future__ import annotations

import math
import time
from typing import Any

from src.draft_hub.rules_engine import (
    normalize_position,
    salary_roster_limits_relaxed,
    unmet_minimum_positions,
)
from src.draft_hub.schemas import LeagueRules

_TAX_HINT_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_TAX_HINT_TTL_SEC = 900.0


def suggested_bid_for_row(row: dict[str, Any] | None) -> float | None:
    """Prefer RAAV, then fair_value / model_bid_hint (same order as live rail UI)."""
    if not row:
        return None
    for key in ("risk_adjusted_value", "fair_value", "model_bid_hint"):
        raw = row.get(key)
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and value > 0:
            return round(value, 2)
    return None


def drafted_player_ids_from_rosters(
    rosters: dict[str, list[dict[str, Any]]],
    *,
    draft_completed: bool = False,
) -> set[str]:
    """Players still occupying a roster slot — not nominatable."""
    from src.draft_hub.pre_draft_cap import retained_through_draft

    ids: set[str] = set()
    for rows in (rosters or {}).values():
        for row in rows or []:
            pid = str(row.get("player_id") or "").strip()
            if not pid:
                continue
            if not retained_through_draft(row, draft_completed=draft_completed):
                continue
            ids.add(pid)
    return ids


def _rival_owner_name(team: dict[str, Any]) -> str:
    owner = str(team.get("owner_name") or "").strip()
    if owner:
        return owner
    return str(team.get("name") or team.get("team_name") or "").strip() or "Manager"


def build_nomination_tax(
    *,
    viewer_team_id: str | None,
    teams: list[dict[str, Any]],
    rosters: dict[str, list[dict[str, Any]]],
    rules: LeagueRules,
    pool_rows: list[dict[str, Any]],
    drafted_player_ids: set[str] | None = None,
    draft_completed: bool = False,
) -> dict[str, dict[str, Any]]:
    """Map available ``player_id`` → private Tax rival advice.

    Rival = other seat with a remaining hole at that position and leftover ≥
    opening min bid. Among several, pick largest leftover, then suggested bid.
    """
    if not viewer_team_id or salary_roster_limits_relaxed(rules):
        return {}
    try:
        min_bid = float(getattr(getattr(rules, "auction", None), "min_bid", 1) or 1)
    except (TypeError, ValueError):
        min_bid = 1.0
    if min_bid <= 0:
        min_bid = 1.0

    drafted = drafted_player_ids
    if drafted is None:
        drafted = drafted_player_ids_from_rosters(rosters, draft_completed=draft_completed)

    rival_holes: list[dict[str, Any]] = []
    for team in teams or []:
        tid = str(team.get("id") or "")
        if not tid or tid == str(viewer_team_id):
            continue
        try:
            leftover = float(team.get("budget_remaining") or 0)
        except (TypeError, ValueError):
            leftover = 0.0
        if leftover < min_bid:
            continue
        roster = rosters.get(tid) or []
        unmet = unmet_minimum_positions(rules, roster)
        if not unmet:
            continue
        rival_holes.append(
            {
                "team_id": tid,
                "owner_name": _rival_owner_name(team),
                "budget_remaining": leftover,
                "holes": unmet,
            }
        )
    if not rival_holes or not pool_rows:
        return {}

    out: dict[str, dict[str, Any]] = {}
    for row in pool_rows:
        pid = str(row.get("player_id") or "").strip()
        if not pid or pid in drafted:
            continue
        pos = normalize_position(row.get("position"))
        if not pos:
            continue
        candidates = [r for r in rival_holes if pos in r["holes"]]
        if not candidates:
            continue
        suggested = suggested_bid_for_row(row)
        suggested_key = float(suggested) if suggested is not None else 0.0
        # Largest leftover, then highest suggested bid, then stable team id.
        best = max(
            candidates,
            key=lambda r: (
                float(r["budget_remaining"]),
                suggested_key,
                str(r["team_id"]),
            ),
        )
        out[pid] = {
            "rival_team_id": best["team_id"],
            "rival_owner_name": best["owner_name"],
            "rival_budget_remaining": round(float(best["budget_remaining"]), 2),
            "rival_hole_position": pos,
            "suggested_bid": suggested if suggested is not None else round(min_bid, 2),
        }
    return out


def _tax_hint_cache_key(
    season: int,
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    *,
    team_count: int,
) -> str:
    from src.draft_hub.value_sheet import _pool_payload_cache_key

    return _pool_payload_cache_key(season, rules, salary_ranges, team_count=team_count)


def load_nomination_tax_pool_rows(
    league: dict[str, Any],
    rules: LeagueRules,
    *,
    team_count: int = 12,
) -> list[dict[str, Any]]:
    """Draft-pool rows for Tax hints — peek warm cache, else artifact-only (no predict)."""
    from src.draft_hub import storage
    from src.draft_hub.value_sheet import peek_pool_payload_cache

    try:
        season = int(league.get("season") or 0)
    except (TypeError, ValueError):
        season = 0
    if season <= 0:
        return []

    ws_id = storage.roster_workspace_for_league(league)
    salary_ranges = storage.list_salary_ranges(ws_id)
    peeked = peek_pool_payload_cache(
        season, rules, salary_ranges, team_count=team_count
    )
    if peeked:
        return list(peeked.get("rows") or [])

    cache_key = _tax_hint_cache_key(
        season, rules, salary_ranges, team_count=team_count
    )
    cached = _TAX_HINT_CACHE.get(cache_key)
    now = time.time()
    if cached and (now - cached[0]) < _TAX_HINT_TTL_SEC:
        return list(cached[1])

    rows = _rows_from_draft_pool_artifact(
        season, rules, salary_ranges, team_count=team_count
    )
    _TAX_HINT_CACHE[cache_key] = (now, rows)
    return list(rows)


def _rows_from_draft_pool_artifact(
    season: int,
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    *,
    team_count: int,
) -> list[dict[str, Any]]:
    """Build compact bid-hint rows from the parquet artifact only."""
    from src.draft_hub.auction_values import build_player_values
    from src.draft_hub.draft_pool_cache import load_draft_pool
    from src.draft_hub.k_def_pool_cache import load_k_def_rows

    try:
        pool = load_draft_pool(season, allow_compute=False)
    except Exception:
        return []
    if pool is None or getattr(pool, "empty", True):
        return []

    try:
        model_values = build_player_values(pool, rules, team_count=team_count)
    except Exception:
        model_values = {}

    # Optional import midpoint override (same spirit as value_sheet).
    range_mid: dict[str, float] = {}
    for rng in salary_ranges or []:
        pid = str(rng.get("player_id") or "").strip()
        if not pid or str(rng.get("source") or "") != "import":
            continue
        min_sal = rng.get("min_sal")
        max_sal = rng.get("max_sal")
        if min_sal is None or max_sal is None:
            continue
        try:
            range_mid[pid] = round((float(min_sal) + float(max_sal)) / 2, 0)
        except (TypeError, ValueError):
            continue

    rows: list[dict[str, Any]] = []
    for _, p in pool.iterrows():
        pid = str(p.get("player_id") or p.get("Player") or "").strip()
        if not pid:
            continue
        pos = normalize_position(p.get("Position"))
        mv = model_values.get(pid) or {}
        fair = range_mid.get(pid, mv.get("fair_value"))
        rows.append(
            {
                "player_id": pid,
                "position": pos,
                "fair_value": fair,
                "model_bid_hint": fair,
                "risk_adjusted_value": mv.get("risk_adjusted_value"),
            }
        )

    try:
        for kd in load_k_def_rows(rules, salary_ranges, team_count=team_count) or []:
            pid = str(kd.get("player_id") or "").strip()
            if not pid:
                continue
            fair = kd.get("fair_value", kd.get("model_bid_hint"))
            rows.append(
                {
                    "player_id": pid,
                    "position": normalize_position(kd.get("position")),
                    "fair_value": fair,
                    "model_bid_hint": fair,
                    "risk_adjusted_value": kd.get("risk_adjusted_value"),
                }
            )
    except Exception:
        pass

    return rows


def invalidate_nomination_tax_hint_cache() -> None:
    """Test helper — clear artifact hint cache."""
    _TAX_HINT_CACHE.clear()
