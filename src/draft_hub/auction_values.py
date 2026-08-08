"""League-size-aware auction fair values from projection rank."""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules

RANK_EXPONENT = 0.42
TOP_CAP_SHARE = {"QB": 0.17, "RB": 0.16, "WR": 0.18, "TE": 0.11, "K": 0.04, "DEF": 0.05}
FLEX_POS_SHARE = {"RB": 0.40, "WR": 0.45, "TE": 0.15}
MIN_RELEVANT = {"QB": 8, "RB": 14, "WR": 14, "TE": 6, "K": 12, "DEF": 12}


def auction_relevant_count(pos: str, team_count: int, rules: LeagueRules) -> int:
    """How many players at a position receive meaningful auction bids league-wide.

    Uses starter slots plus most of the required roster minimum (QB2 / RB3, etc.),
    not starters alone — otherwise 10-team / 2-QB leagues only price 10 QBs and
    everyone else collapses to min-bid.
    """
    pos = normalize_position(pos)
    roster = rules.roster or {}
    pos_rule = roster.get(pos.lower(), {}) if isinstance(roster.get(pos.lower()), dict) else {}
    starters = int(pos_rule.get("starter") or 1)
    minimum = int(pos_rule.get("min") or starters)
    teams = max(int(team_count), 2)

    flex = roster.get("flex") or {}
    flex_starters = int(flex.get("starter") or 0)
    flex_eligible = {normalize_position(p) for p in (flex.get("eligible") or ["RB", "WR", "TE"])}
    flex_add = 0.0
    if flex_starters and pos in flex_eligible:
        flex_add = flex_starters * teams * FLEX_POS_SHARE.get(pos, 0.33)

    bench = max(0, minimum - starters)
    # Skill-position benches are deep; QB/TE/K/DEF bench spots still draw real bids.
    bench_share = 0.55 if pos in {"RB", "WR"} else 0.9
    n = int(round(starters * teams + bench * teams * bench_share + flex_add))
    floor = MIN_RELEVANT.get(pos, 8)
    ceiling = max(floor, teams * int(pos_rule.get("max") or max(starters * 2, minimum)))
    return max(floor, min(n, ceiling))


def _rank_weights(n: int) -> list[float]:
    return [1.0 / (i + 1) ** RANK_EXPONENT for i in range(max(n, 1))]


def _scarcity_multiplier(team_count: int) -> float:
    """Smaller leagues pay more for stars."""
    teams = max(int(team_count), 2)
    return math.sqrt(12.0 / teams)


def fair_auction_value(
    rank: int,
    n_relevant: int,
    pos: str,
    rules: LeagueRules,
    *,
    team_count: int = 12,
) -> float:
    """Fair auction price for a player at projection rank within the relevant pool."""
    min_bid = float(rules.auction.min_bid)
    cap = float(rules.salary_cap)
    pos = normalize_position(pos)

    if rank < 0:
        return min_bid
    if rank >= n_relevant:
        depth_rank = rank - n_relevant
        return round(max(min_bid, min_bid * max(0.5, 1.0 - depth_rank * 0.08)), 0)

    weights = _rank_weights(n_relevant)
    top_target = cap * TOP_CAP_SHARE.get(pos, 0.14) * _scarcity_multiplier(team_count)
    base = top_target * (weights[rank] / weights[0])
    return round(max(min_bid, min(cap * 0.25, base)), 0)


def salary_band(fair: float, rules: LeagueRules) -> tuple[float, float]:
    """Min/max range around fair value."""
    min_bid = float(rules.auction.min_bid)
    cap = float(rules.salary_cap)
    spread = max(min_bid, round(fair * 0.30, 0))
    return (
        round(max(min_bid, fair - spread), 0),
        round(min(cap, fair + spread), 0),
    )


def tier_label(rank: int, n_relevant: int) -> str:
    if rank >= n_relevant:
        return "Depth"
    pct = (rank + 1) / max(n_relevant, 1)
    if pct <= 0.12:
        return "Elite"
    if pct <= 0.30:
        return "Tier 1"
    if pct <= 0.50:
        return "Tier 2"
    if pct <= 0.75:
        return "Tier 3"
    return "Depth"


def build_player_values(
    pool: pd.DataFrame,
    rules: LeagueRules,
    team_count: int = 12,
    *,
    proj_col: str = "Season Proj",
    pos_col: str = "Position",
) -> dict[str, dict[str, Any]]:
    """Fair values keyed by player_id."""
    out: dict[str, dict[str, Any]] = {}
    if pool.empty:
        return out

    df = pool.copy()
    if pos_col not in df.columns:
        df[pos_col] = "UNK"
    if proj_col not in df.columns:
        df[proj_col] = 0.0

    for pos, group in df.groupby(df[pos_col].astype(str).str.upper()):
        pos = normalize_position(str(pos))
        g = group.sort_values(proj_col, ascending=False).reset_index(drop=True)
        n_rel = auction_relevant_count(pos, team_count, rules)
        for i, (_, row) in enumerate(g.iterrows()):
            pid = str(row.get("player_id") or row.get("Player") or "")
            if not pid:
                continue
            fair = fair_auction_value(i, n_rel, pos, rules, team_count=team_count)
            min_sal, max_sal = salary_band(fair, rules)
            out[pid] = {
                "fair_value": fair,
                "min_sal": min_sal,
                "max_sal": max_sal,
                "tier": tier_label(i, n_rel),
                "rank": i,
                "auction_relevant": i < n_rel,
            }
    return out


def fair_value_for_row(
    row: dict[str, Any],
    pool: pd.DataFrame,
    rules: LeagueRules,
    team_count: int = 12,
    *,
    proj_col: str = "Season Proj",
    pos_col: str = "Position",
) -> float | None:
    """Lookup fair value for a single roster row using pool rank."""
    pid = str(row.get("player_id") or "")
    pos = normalize_position(row.get("position"))
    if pool.empty or not pid:
        return None
    sub = pool[pool[pos_col].astype(str).str.upper() == pos.upper()].sort_values(proj_col, ascending=False)
    ids = [str(x) for x in sub.get("player_id", sub.get("Player", []))]
    if pid not in ids and pos == "TE":
        wr_sub = pool[pool[pos_col].astype(str).str.upper() == "WR"].sort_values(proj_col, ascending=False)
        ids = [str(x) for x in wr_sub.get("player_id", wr_sub.get("Player", []))]
    if pid not in ids:
        # fallback from salary if not in projection pool
        return float(row.get("salary") or 0) or None
    rank = ids.index(pid)
    n_rel = auction_relevant_count(pos, team_count, rules)
    return fair_auction_value(rank, n_rel, pos, rules, team_count=team_count)
