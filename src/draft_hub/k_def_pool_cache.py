"""Cached K/DEF player rows from Sleeper — avoids reloading on every value-sheet request."""

from __future__ import annotations

import threading
import time
from typing import Any

import pandas as pd

from src.draft_hub.auction_values import auction_relevant_count, fair_auction_value, salary_band
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules

_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_LOCK = threading.Lock()
_TTL_SEC = 3600


def _cache_key(rules: LeagueRules, team_count: int, k_on: bool, def_on: bool) -> str:
    cap = float(rules.salary_cap)
    min_bid = float(rules.auction.min_bid)
    k_max = int((rules.roster or {}).get("k", {}).get("max") or 0) if isinstance((rules.roster or {}).get("k"), dict) else 0
    def_max = int((rules.roster or {}).get("def", {}).get("max") or 0) if isinstance((rules.roster or {}).get("def"), dict) else 0
    return f"k={k_on}:{k_max}:def={def_on}:{def_max}:cap={cap}:bid={min_bid}:teams={team_count}"


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


def load_k_def_rows(
    rules: LeagueRules,
    salary_ranges: list[dict[str, Any]],
    *,
    team_count: int,
) -> list[dict[str, Any]]:
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

    if k_on:
        kickers = df[(df["position"] == "K") & df["team"].astype(bool)].copy()
        kickers = kickers.sort_values(["search_rank", "full_name"], na_position="last")
        n_rel = auction_relevant_count("K", team_count, rules)
        for rank, (_, p) in enumerate(kickers.iterrows()):
            pid = str(p.get("sleeper_id") or "")
            if not pid:
                continue
            fair = fair_auction_value(rank, n_rel, "K", rules, team_count=team_count)
            min_sal, max_sal = salary_band(fair, rules)
            rows.append(
                {
                    "player_id": pid,
                    "player": p.get("full_name"),
                    "team": p.get("team"),
                    "position": "K",
                    "season_proj": 0.0,
                    "per_game_proj": 0.0,
                    "min_sal": min_sal,
                    "max_sal": max_sal,
                    "range_source": None,
                    "model_bid_hint": fair,
                    "fair_value": fair,
                    "tier": _tier_from_fair(fair, rules),
                    "is_rookie": False,
                }
            )

    if def_on:
        defs = df[(df["position"] == "DEF") & df["team"].astype(bool)].copy()
        defs = defs.sort_values(["search_rank", "team"], na_position="last")
        n_rel = auction_relevant_count("DEF", team_count, rules)
        for rank, (_, p) in enumerate(defs.iterrows()):
            pid = str(p.get("sleeper_id") or "")
            if not pid:
                continue
            fair = fair_auction_value(rank, n_rel, "DEF", rules, team_count=team_count)
            min_sal, max_sal = salary_band(fair, rules)
            name = p.get("full_name") or f"{p.get('team')} DEF"
            rows.append(
                {
                    "player_id": pid,
                    "player": name,
                    "team": p.get("team"),
                    "position": "DEF",
                    "season_proj": 0.0,
                    "per_game_proj": 0.0,
                    "min_sal": min_sal,
                    "max_sal": max_sal,
                    "range_source": None,
                    "model_bid_hint": fair,
                    "fair_value": fair,
                    "tier": _tier_from_fair(fair, rules),
                    "is_rookie": False,
                }
            )

    with _LOCK:
        _CACHE[key] = (now, rows)

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
