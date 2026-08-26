"""Value sheet — projections + salary ranges + fair auction values."""

from __future__ import annotations

import json
import time
from typing import Any

import pandas as pd

from src.draft_hub.auction_values import build_player_values
from src.draft_hub.draft_pool_cache import load_draft_pool
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.tier_generator import generate_tiers

_POOL_PAYLOAD_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_POOL_PAYLOAD_TTL_SEC = 900


def invalidate_pool_payload_cache() -> None:
    _POOL_PAYLOAD_CACHE.clear()


def _pool_payload_cache_key(
    season: int,
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    *,
    team_count: int,
) -> str:
    range_sig = json.dumps(
        sorted(
            (str(r.get("player_id") or ""), float(r.get("min_sal") or 0), float(r.get("max_sal") or 0))
            for r in salary_ranges
            if r.get("player_id")
        ),
        sort_keys=True,
    )
    return f"{season}:{team_count}:{json.dumps(rules.model_dump(), sort_keys=True)}:{range_sig}"


def _load_draft_pool(season: int) -> pd.DataFrame:
    """Backward-compatible alias for hub routes and imports."""
    return load_draft_pool(season)


def _player_status(
    pid: str,
    *,
    league_row: dict[str, Any] | None,
    my_team_id: str | None,
    on_sleeper: bool,
    is_target: bool,
) -> tuple[str, bool, float | None]:
    """Return status, is_available, roster_salary."""
    if league_row:
        roster_sal = float(league_row.get("salary") or 0)
        row_team = str(league_row.get("team_id") or "")
        on_my_team = bool(my_team_id and row_team == str(my_team_id))
        if on_my_team and on_sleeper:
            return "mine", False, roster_sal
        if on_my_team:
            return "rostered", False, roster_sal
        return "taken", False, roster_sal
    if on_sleeper:
        return "sleeper", True, None
    if is_target:
        return "target", True, None
    return "available", True, None


def _tier_from_fair(fair: float | None, rules: LeagueRules) -> str:
    if fair is None:
        return "—"
    cap = float(rules.salary_cap)
    if fair >= cap * 0.15:
        return "Elite"
    if fair >= cap * 0.08:
        return "Tier 1"
    if fair >= cap * 0.04:
        return "Tier 2"
    return "Depth"


def _valuation_maps(
    pool: pd.DataFrame,
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    *,
    team_count: int,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    range_map = {str(r["player_id"]): r for r in salary_ranges if r.get("player_id")}
    model_values = build_player_values(pool, rules, team_count=team_count)
    model_tiers = generate_tiers(pool, rules, team_count=team_count, values=model_values)
    for mt in model_tiers:
        pid = str(mt["player_id"])
        if pid not in range_map:
            range_map[pid] = mt
    return model_values, range_map


from src.draft_hub.k_def_pool_cache import load_k_def_rows


def peek_pool_payload_cache(
    season: int,
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    *,
    team_count: int = 12,
) -> dict[str, Any] | None:
    """Return cached pool payload without building (overlay hot path)."""
    cache_key = _pool_payload_cache_key(season, rules, salary_ranges, team_count=team_count)
    cached = _POOL_PAYLOAD_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _POOL_PAYLOAD_TTL_SEC:
        return cached[1]
    return None


def build_draft_pool_payload(
    season: int,
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    *,
    team_count: int = 12,
) -> dict[str, Any]:
    """
    League-agnostic valuation layer (projections + fair values).

    Safe to cache client-side until season, rules, or salary ranges change.
    """
    cache_key = _pool_payload_cache_key(season, rules, salary_ranges, team_count=team_count)
    now = time.time()
    cached = _POOL_PAYLOAD_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _POOL_PAYLOAD_TTL_SEC:
        return cached[1]

    pool = load_draft_pool(season)
    model_values, range_map = _valuation_maps(pool, rules, salary_ranges, team_count=team_count)

    rows: list[dict[str, Any]] = []
    for _, p in pool.iterrows():
        pid = str(p.get("player_id") or p.get("Player") or "")
        pos = normalize_position(p.get("Position"))
        season_proj = float(p.get("Season Proj") or 0)
        pg_proj = float(p.get("Per-Game Proj") or 0)
        season_p10 = p.get("Season P10")
        season_p50 = p.get("Season P50")
        season_p90 = p.get("Season P90")
        season_spread = p.get("Season Spread")
        rng = range_map.get(pid) or {}
        mv = model_values.get(pid) or {}
        min_sal = rng.get("min_sal") if rng.get("min_sal") is not None else mv.get("min_sal")
        max_sal = rng.get("max_sal") if rng.get("max_sal") is not None else mv.get("max_sal")
        fair_value = mv.get("fair_value")
        if rng.get("source") == "import" and min_sal is not None and max_sal is not None:
            fair_value = round((float(min_sal) + float(max_sal)) / 2, 0)
        risk_score = mv.get("risk_score")
        risk_adjusted_value = mv.get("risk_adjusted_value")
        rows.append(
            {
                "player_id": pid,
                "player": p.get("Player"),
                "team": p.get("Team"),
                "position": pos,
                "season_proj": round(season_proj, 1),
                "per_game_proj": round(pg_proj, 1),
                "season_p10": round(float(season_p10), 1) if pd.notna(season_p10) else None,
                "season_p50": round(float(season_p50), 1) if pd.notna(season_p50) else None,
                "season_p90": round(float(season_p90), 1) if pd.notna(season_p90) else None,
                "season_spread": round(float(season_spread), 1) if pd.notna(season_spread) else None,
                "games_expected": round(float(games_exp), 2) if pd.notna(games_exp := p.get("games_expected")) else None,
                "season_quantile_method": (
                    str(sqm) if pd.notna(sqm := p.get("season_quantile_method")) else None
                ),
                "min_sal": min_sal,
                "max_sal": max_sal,
                "range_source": rng.get("source"),
                "model_bid_hint": fair_value,
                "fair_value": fair_value,
                # SCORE-3: risk_score always; risk_adjusted_value only when risk_tolerance != 0.
                "risk_score": risk_score,
                "risk_adjusted_value": risk_adjusted_value,
                "tier": rng.get("tier") or mv.get("tier") or _tier_from_fair(fair_value, rules),
                "is_rookie": bool(p.get("Rookie Est.")),
            }
        )

    rows.extend(load_k_def_rows(rules, salary_ranges, team_count=team_count))
    from src.draft_hub.jsonutil import json_safe

    rows = json_safe(rows)
    rows.sort(key=lambda r: (-(r.get("season_proj") or 0), r.get("player") or ""))
    payload = {
        "season": season,
        "team_count": team_count,
        "count": len(rows),
        "pool_mode": "draft",
        "rows": rows,
    }
    _POOL_PAYLOAD_CACHE[cache_key] = (now, payload)
    return payload


def build_value_overlay(
    pool_payload: dict[str, Any],
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    *,
    league_roster: list[dict[str, Any]] | None = None,
    my_team_id: str | None = None,
    targets: set[str] | None = None,
    sleeper_player_ids: set[str] | None = None,
    draft_completed: bool = False,
) -> dict[str, Any]:
    """Apply roster / league availability overlay to a pre-built pool payload."""
    from src.draft_hub.pre_draft_cap import retained_through_draft

    def _kept(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for row in rows:
            pid = str(row.get("player_id") or "")
            if not pid:
                continue
            if not retained_through_draft(row, draft_completed=draft_completed):
                continue
            out[pid] = row
        return out

    roster_map = _kept(roster)
    league_map = _kept(league_roster if league_roster is not None else roster)
    targets = targets or set()
    sleeper_ids = sleeper_player_ids or set()

    rows: list[dict[str, Any]] = []
    for base in pool_payload.get("rows") or []:
        pid = str(base.get("player_id") or "")
        fair_value = base.get("fair_value")
        on_sleeper = pid in sleeper_ids
        league_row = league_map.get(pid)
        status, is_available, roster_sal = _player_status(
            pid,
            league_row=league_row,
            my_team_id=my_team_id,
            on_sleeper=on_sleeper,
            is_target=pid in targets,
        )
        on_roster = pid in roster_map or league_row is not None
        if roster_sal is None and pid in roster_map:
            roster_sal = float(roster_map[pid]["salary"])
        value_delta = (
            round(roster_sal - fair_value, 2)
            if roster_sal is not None and fair_value is not None
            else None
        )
        overpay = bool(
            on_roster
            and fair_value is not None
            and roster_sal is not None
            and roster_sal > fair_value * 1.08
        )
        rows.append(
            {
                **base,
                "value_delta": value_delta,
                "status": status,
                "is_available": is_available,
                "on_sleeper": on_sleeper,
                "overpay": overpay,
                "roster_salary": roster_sal,
            }
        )

    available_count = sum(1 for r in rows if r.get("is_available"))
    return {
        "season": pool_payload.get("season"),
        "team_count": pool_payload.get("team_count"),
        "count": len(rows),
        "available_count": available_count,
        "taken_count": len(rows) - available_count,
        "sleeper_linked_count": sum(1 for r in rows if r.get("on_sleeper")),
        "pool_mode": pool_payload.get("pool_mode", "draft"),
        "rows": rows,
    }


def build_value_overlay_sheet(
    season: int,
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    roster: list[dict[str, Any]],
    *,
    league_roster: list[dict[str, Any]] | None = None,
    my_team_id: str | None = None,
    targets: set[str] | None = None,
    sleeper_player_ids: set[str] | None = None,
    team_count: int = 12,
    pool_payload: dict[str, Any] | None = None,
    draft_completed: bool = False,
) -> dict[str, Any]:
    """Overlay only — uses warm pool cache when pool_payload is omitted."""
    payload = pool_payload or peek_pool_payload_cache(
        season, rules, salary_ranges, team_count=team_count
    )
    if payload is None:
        raise ValueError("pool_cache_cold")
    return build_value_overlay(
        payload,
        rules,
        roster,
        league_roster=league_roster,
        my_team_id=my_team_id,
        targets=targets,
        sleeper_player_ids=sleeper_player_ids,
        draft_completed=draft_completed,
    )


def build_value_sheet(
    season: int,
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    roster: list[dict[str, Any]],
    *,
    league_roster: list[dict[str, Any]] | None = None,
    my_team_id: str | None = None,
    targets: set[str] | None = None,
    sleeper_player_ids: set[str] | None = None,
    team_count: int = 12,
    draft_completed: bool = False,
) -> dict[str, Any]:
    pool_payload = build_draft_pool_payload(
        season, rules, salary_ranges, team_count=team_count
    )
    return build_value_overlay(
        pool_payload,
        rules,
        roster,
        league_roster=league_roster,
        my_team_id=my_team_id,
        targets=targets,
        sleeper_player_ids=sleeper_player_ids,
        draft_completed=draft_completed,
    )
