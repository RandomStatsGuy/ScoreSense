"""Cached K/DEF player rows from Sleeper — avoids reloading on every value-sheet request."""

from __future__ import annotations

import threading
import time
from typing import Any

import pandas as pd

from src.config import GAMES_PER_SEASON
from src.draft_hub.auction_values import auction_relevant_count, fair_auction_value, salary_band
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules

_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_PROJ_INDEX: dict[str, dict[str, Any]] | None = None
_LOCK = threading.Lock()
_TTL_SEC = 3600
K_DEF_QUANTILE_METHOD = "k_def_rank_v1"
# Rank-curve params: elite season pts, replacement, steepness, P10/P90 multipliers.
# Kickers are tighter; DST scoring is boom/bust.
_PROJ_CURVE = {
    "K": (164.0, 92.0, 0.048, 0.86, 1.12),
    "DEF": (156.0, 82.0, 0.062, 0.70, 1.28),
}


def invalidate_k_def_cache() -> None:
    global _PROJ_INDEX
    with _LOCK:
        _CACHE.clear()
        _PROJ_INDEX = None


def _has_nfl_team(series: pd.Series) -> pd.Series:
    """True when a Sleeper team code is present. NaN/None must not count as rostered."""
    return series.fillna("").astype(str).str.strip().astype(bool)


def _cache_key(rules: LeagueRules, team_count: int, k_on: bool, def_on: bool) -> str:
    cap = float(rules.salary_cap)
    min_bid = float(rules.auction.min_bid)
    k_max = int((rules.roster or {}).get("k", {}).get("max") or 0) if isinstance((rules.roster or {}).get("k"), dict) else 0
    def_max = int((rules.roster or {}).get("def", {}).get("max") or 0) if isinstance((rules.roster or {}).get("def"), dict) else 0
    return (
        f"{K_DEF_QUANTILE_METHOD}:k={k_on}:{k_max}:def={def_on}:{def_max}"
        f":cap={cap}:bid={min_bid}:teams={team_count}"
    )


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


def _positive(value: Any) -> float | None:
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num > 0:
        return num
    return None


def k_def_season_bands(
    rank: int,
    position: str,
    *,
    games: int = GAMES_PER_SEASON,
) -> dict[str, Any]:
    """Season projection + P10/P50/P90 from Sleeper search-rank order (0 = best)."""
    pos = normalize_position(position)
    curve = _PROJ_CURVE.get(pos)
    if not curve:
        return {}
    elite, replacement, steep, lo_mult, hi_mult = curve
    idx = max(0, int(rank))
    p50 = replacement + (elite - replacement) / (1.0 + idx * steep)
    p10 = p50 * lo_mult
    p90 = p50 * hi_mult
    p10, p50, p90 = (round(float(p10), 1), round(float(p50), 1), round(float(p90), 1))
    if p10 > p50:
        p10 = p50
    if p90 < p50:
        p90 = p50
    games_n = max(1, int(games or GAMES_PER_SEASON))
    return {
        "season_proj": p50,
        "season_p50": p50,
        "season_p10": p10,
        "season_p90": p90,
        "season_spread": round(p90 - p10, 1),
        "per_game_proj": round(p50 / games_n, 1),
        "games_expected": float(games_n),
        "season_quantile_method": K_DEF_QUANTILE_METHOD,
    }


def _index_from_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for row in rows:
        pid = str(row.get("player_id") or "")
        p50 = _positive(row.get("season_p50")) or _positive(row.get("season_proj"))
        if not pid or p50 is None:
            continue
        index[pid] = {
            "p10": _positive(row.get("season_p10")),
            "p50": p50,
            "p90": _positive(row.get("season_p90")),
            "season_proj": p50,
            "position": normalize_position(row.get("position")),
            "player_name": str(row.get("player") or row.get("player_name") or ""),
            "team": str(row.get("team") or ""),
        }
    return index


def _sleeper_players_df(*, allow_fetch: bool) -> pd.DataFrame:
    from src.integrations.sleeper import PLAYERS_CACHE, _PLAYERS_DF_CACHE, players_dataframe

    if not allow_fetch and _PLAYERS_DF_CACHE is None and not PLAYERS_CACHE.exists():
        return pd.DataFrame()
    try:
        return players_dataframe(force_refresh=False)
    except Exception:
        return pd.DataFrame()


def build_k_def_projection_index(df: pd.DataFrame, *, games: int = GAMES_PER_SEASON) -> dict[str, dict[str, Any]]:
    """Build a player_id index from a Sleeper players frame (no auction math)."""
    if df is None or getattr(df, "empty", True):
        return {}
    work = df.copy()
    if "position" not in work.columns:
        return {}
    work["_pos"] = work["position"].map(normalize_position)
    work = work[work["_pos"].isin(_PROJ_CURVE) & _has_nfl_team(work["team"])]
    if work.empty:
        return {}
    rows: list[dict[str, Any]] = []
    for pos in ("K", "DEF"):
        part = work[work["_pos"] == pos].copy()
        if part.empty:
            continue
        sort_cols = ["search_rank", "full_name"] if "full_name" in part.columns else ["search_rank"]
        if "search_rank" not in part.columns:
            part["search_rank"] = pd.NA
        part = part.sort_values(sort_cols, na_position="last")
        for rank, (_, p) in enumerate(part.iterrows()):
            pid = str(p.get("sleeper_id") or p.get("player_id") or "")
            if not pid:
                continue
            name = p.get("full_name") or (f"{p.get('team')} DEF" if pos == "DEF" else "")
            bands = k_def_season_bands(rank, pos, games=games)
            rows.append(
                {
                    "player_id": pid,
                    "player": name,
                    "player_name": name,
                    "team": p.get("team"),
                    "position": pos,
                    **bands,
                }
            )
    return _index_from_rows(rows)


def k_def_projection_index(*, allow_fetch: bool = False) -> dict[str, dict[str, Any]]:
    """Lookup of K/DEF quantiles. Prefers in-process pool rows, then Sleeper cache."""
    global _PROJ_INDEX
    with _LOCK:
        if _PROJ_INDEX is not None:
            return dict(_PROJ_INDEX)
        for _key, (_ts, rows) in _CACHE.items():
            built = _index_from_rows(rows)
            if built:
                _PROJ_INDEX = built
                return dict(built)

    df = _sleeper_players_df(allow_fetch=allow_fetch)
    built = build_k_def_projection_index(df)
    if built:
        with _LOCK:
            _PROJ_INDEX = built
    return dict(built)


def overlay_k_def_projections(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fill stored 0 / missing K/DEF projections from the rank curve."""
    if not rows:
        return rows
    missing = [
        r
        for r in rows
        if normalize_position(r.get("position")) in _PROJ_CURVE
        and _positive(r.get("season_p50") if r.get("season_p50") is not None else r.get("season_proj")) is None
    ]
    if not missing:
        return rows
    index = k_def_projection_index(allow_fetch=False)
    if not index:
        return rows
    for row in rows:
        if normalize_position(row.get("position")) not in _PROJ_CURVE:
            continue
        current = row.get("season_p50") if row.get("season_p50") is not None else row.get("season_proj")
        if _positive(current) is not None:
            continue
        hit = index.get(str(row.get("player_id") or ""))
        if not hit:
            continue
        row["season_proj"] = hit.get("season_proj")
        row["season_p50"] = hit.get("p50")
        if hit.get("p10") is not None:
            row["season_p10"] = hit.get("p10")
        if hit.get("p90") is not None:
            row["season_p90"] = hit.get("p90")
    return rows


def load_k_def_rows(
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    *,
    team_count: int,
) -> list[dict[str, Any]]:
    global _PROJ_INDEX
    roster = rules.roster or {}
    k_rule = roster.get("k") if isinstance(roster.get("k"), dict) else {}
    def_rule = roster.get("def") if isinstance(roster.get("def"), dict) else {}
    k_on = int(k_rule.get("max") or 0) > 0
    def_on = int(def_rule.get("max") or 0) > 0
    if not k_on and not def_on:
        return []

    key = _cache_key(rules, team_count, k_on, def_on)
    now = time.time()
    with _LOCK:
        hit = _CACHE.get(key)
        if hit and (now - hit[0]) < _TTL_SEC:
            range_map = {str(r["player_id"]): r for r in salary_ranges if r.get("player_id")}
            return _apply_import_ranges(list(hit[1]), range_map, rules)

    from src.integrations.sleeper import players_dataframe

    range_map = {str(r["player_id"]): r for r in salary_ranges if r.get("player_id")}
    df = players_dataframe()
    if df.empty:
        return []

    rows: list[dict[str, Any]] = []

    pos_series = df["position"].map(normalize_position) if "position" in df.columns else None
    if k_on:
        kickers = df[(pos_series == "K") & _has_nfl_team(df["team"])].copy()
        kickers = kickers.sort_values(["search_rank", "full_name"], na_position="last")
        n_rel = auction_relevant_count("K", team_count, rules)
        for rank, (_, p) in enumerate(kickers.iterrows()):
            pid = str(p.get("sleeper_id") or "")
            if not pid:
                continue
            fair = fair_auction_value(rank, n_rel, "K", rules, team_count=team_count)
            min_sal, max_sal = salary_band(fair, rules)
            bands = k_def_season_bands(rank, "K")
            rows.append(
                {
                    "player_id": pid,
                    "player": p.get("full_name"),
                    "team": p.get("team"),
                    "position": "K",
                    **bands,
                    "min_sal": min_sal,
                    "max_sal": max_sal,
                    "range_source": None,
                    "model_bid_hint": fair,
                    "fair_value": fair,
                    "risk_score": None,
                    "risk_adjusted_value": None,
                    "tier": _tier_from_fair(fair, rules),
                    "is_rookie": False,
                }
            )

    if def_on:
        defs = df[(pos_series == "DEF") & _has_nfl_team(df["team"])].copy()
        defs = defs.sort_values(["search_rank", "team"], na_position="last")
        n_rel = auction_relevant_count("DEF", team_count, rules)
        for rank, (_, p) in enumerate(defs.iterrows()):
            pid = str(p.get("sleeper_id") or "")
            if not pid:
                continue
            fair = fair_auction_value(rank, n_rel, "DEF", rules, team_count=team_count)
            min_sal, max_sal = salary_band(fair, rules)
            name = p.get("full_name") or f"{p.get('team')} DEF"
            bands = k_def_season_bands(rank, "DEF")
            rows.append(
                {
                    "player_id": pid,
                    "player": name,
                    "team": p.get("team"),
                    "position": "DEF",
                    **bands,
                    "min_sal": min_sal,
                    "max_sal": max_sal,
                    "range_source": None,
                    "model_bid_hint": fair,
                    "fair_value": fair,
                    "risk_score": None,
                    "risk_adjusted_value": None,
                    "tier": _tier_from_fair(fair, rules),
                    "is_rookie": False,
                }
            )

    with _LOCK:
        _CACHE[key] = (now, rows)
        built = _index_from_rows(rows)
        if built:
            _PROJ_INDEX = built

    return _apply_import_ranges(rows, range_map, rules)


def _apply_import_ranges(
    rows: list[dict[str, Any]],
    range_map: dict[str, dict[str, Any]],
    rules: LeagueRules,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for base in rows:
        row = dict(base)
        pid = str(row.get("player_id") or "")
        rng = range_map.get(pid) or {}
        if rng.get("source") == "import" and rng.get("min_sal") is not None and rng.get("max_sal") is not None:
            fair = round((float(rng["min_sal"]) + float(rng["max_sal"])) / 2, 0)
            row["fair_value"] = fair
            row["model_bid_hint"] = fair
            row["min_sal"] = rng["min_sal"]
            row["max_sal"] = rng["max_sal"]
            row["range_source"] = rng.get("source")
            row["tier"] = rng.get("tier") or _tier_from_fair(fair, rules)
        out.append(row)
    return out


def analytics_positions(rules: LeagueRules) -> tuple[str, ...]:
    """Position columns for league analytics based on roster rules."""
    from src.draft_hub.rules_engine import roster_limits

    limits = roster_limits(rules)
    base = ["QB", "RB", "WR", "TE"]
    extra: list[str] = []
    if limits.get("k", {}).get("max", 0) > 0:
        extra.append("K")
    if limits.get("def", {}).get("max", 0) > 0:
        extra.append("DEF")
    return tuple(base + extra)
