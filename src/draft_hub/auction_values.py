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

# SCORE-3: bounded risk adjustment on fair_value. Keep conservative until
# `src.analytics.raav_backtest` confirms risk_z is a calibrated variance signal.
RISK_WEIGHT = 0.12
_RISK_Z_EPS = 1e-9


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


def _auction_bounds(rules: LeagueRules) -> tuple[float, float]:
    min_bid = float(rules.auction.min_bid)
    cap = float(rules.salary_cap)
    return min_bid, cap * 0.25


def clamp_auction_value(value: float, rules: LeagueRules) -> float:
    """Clamp a dollar value to the same [min_bid, cap*0.25] band as fair_auction_value."""
    min_bid, max_bid = _auction_bounds(rules)
    return round(max(min_bid, min(max_bid, float(value))), 0)


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
    pos = normalize_position(pos)

    if rank < 0:
        return min_bid
    if rank >= n_relevant:
        depth_rank = rank - n_relevant
        return round(max(min_bid, min_bid * max(0.5, 1.0 - depth_rank * 0.08)), 0)

    weights = _rank_weights(n_relevant)
    top_target = float(rules.salary_cap) * TOP_CAP_SHARE.get(pos, 0.14) * _scarcity_multiplier(team_count)
    base = top_target * (weights[rank] / weights[0])
    return clamp_auction_value(base, rules)


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


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num):
        return None
    return num


def upside_skew(p10: Any, p50: Any, p90: Any) -> float | None:
    """Upside skew: (P90−P50) / (P50−P10). Matches frontend seasonQuantiles.js."""
    lo = _as_float(p10)
    mid = _as_float(p50)
    hi = _as_float(p90)
    if lo is None or mid is None or hi is None:
        return None
    downside = mid - lo
    if downside <= 0:
        return None
    return (hi - mid) / downside


def season_cv(p10: Any, p50: Any, p90: Any) -> float | None:
    """Coefficient-of-variation-style width: (P90−P10) / (2 * P50)."""
    lo = _as_float(p10)
    mid = _as_float(p50)
    hi = _as_float(p90)
    if lo is None or mid is None or hi is None:
        return None
    if mid <= 0:
        return None
    return (hi - lo) / (2.0 * mid)


def risk_z_scores(cvs: list[float | None]) -> list[float]:
    """Z-score cv within a position group; missing/constant groups → 0.0."""
    finite = [float(c) for c in cvs if c is not None and math.isfinite(float(c))]
    if len(finite) < 2:
        return [0.0 for _ in cvs]
    mean = sum(finite) / len(finite)
    var = sum((c - mean) ** 2 for c in finite) / len(finite)
    std = math.sqrt(var)
    if std < _RISK_Z_EPS:
        return [0.0 for _ in cvs]
    out: list[float] = []
    for c in cvs:
        if c is None or not math.isfinite(float(c)):
            out.append(0.0)
        else:
            out.append((float(c) - mean) / std)
    return out


def risk_adjusted_auction_value(
    fair_value: float,
    risk_z: float,
    rules: LeagueRules,
    *,
    risk_tolerance: float | None = None,
    risk_weight: float = RISK_WEIGHT,
) -> float:
    """Apply risk_tolerance * RISK_WEIGHT * risk_z multiplier, then clamp."""
    tol = float(rules.risk_tolerance if risk_tolerance is None else risk_tolerance)
    if abs(tol) < _RISK_Z_EPS:
        return float(fair_value)
    raw = float(fair_value) * (1.0 + tol * float(risk_weight) * float(risk_z))
    return clamp_auction_value(raw, rules)


def _renormalize_raav(
    fairs: list[float],
    raavs: list[float],
    rules: LeagueRules,
) -> list[float]:
    """Scale position-group RAAVs so Σ raav ≈ Σ fair_value (budget-neutral)."""
    fair_sum = sum(fairs)
    raav_sum = sum(raavs)
    if fair_sum <= 0 or raav_sum <= 0 or abs(raav_sum - fair_sum) < 1e-9:
        return [clamp_auction_value(v, rules) for v in raavs]
    scale = fair_sum / raav_sum
    return [clamp_auction_value(v * scale, rules) for v in raavs]


def build_player_values(
    pool: pd.DataFrame,
    rules: LeagueRules,
    team_count: int = 12,
    *,
    proj_col: str = "Season Proj",
    pos_col: str = "Position",
    p10_col: str = "Season P10",
    p50_col: str = "Season P50",
    p90_col: str = "Season P90",
) -> dict[str, dict[str, Any]]:
    """Fair values keyed by player_id (includes SCORE-3 risk_score / RAAV)."""
    out: dict[str, dict[str, Any]] = {}
    if pool.empty:
        return out

    df = pool.copy()
    if pos_col not in df.columns:
        df[pos_col] = "UNK"
    if proj_col not in df.columns:
        df[proj_col] = 0.0

    risk_tolerance = float(getattr(rules, "risk_tolerance", 0.0) or 0.0)
    apply_raav = abs(risk_tolerance) >= _RISK_Z_EPS

    for pos, group in df.groupby(df[pos_col].astype(str).str.upper()):
        pos = normalize_position(str(pos))
        g = group.sort_values(proj_col, ascending=False).reset_index(drop=True)
        n_rel = auction_relevant_count(pos, team_count, rules)

        rows_meta: list[dict[str, Any]] = []
        cvs: list[float | None] = []
        for i, (_, row) in enumerate(g.iterrows()):
            pid = str(row.get("player_id") or row.get("Player") or "")
            if not pid:
                continue
            fair = fair_auction_value(i, n_rel, pos, rules, team_count=team_count)
            min_sal, max_sal = salary_band(fair, rules)
            p10 = row.get(p10_col) if p10_col in g.columns else None
            p50 = row.get(p50_col) if p50_col in g.columns else None
            p90 = row.get(p90_col) if p90_col in g.columns else None
            # Prefer calibrated Season P50; fall back to Season Proj for cv width.
            if _as_float(p50) is None:
                p50 = row.get(proj_col)
            cv = season_cv(p10, p50, p90)
            skew = upside_skew(p10, p50, p90)
            cvs.append(cv)
            rows_meta.append(
                {
                    "pid": pid,
                    "fair": fair,
                    "min_sal": min_sal,
                    "max_sal": max_sal,
                    "tier": tier_label(i, n_rel),
                    "rank": i,
                    "auction_relevant": i < n_rel,
                    "skew": skew,
                    "cv": cv,
                }
            )

        z_scores = risk_z_scores(cvs)
        fairs = [m["fair"] for m in rows_meta]
        if apply_raav:
            raw_raavs = [
                risk_adjusted_auction_value(m["fair"], z, rules, risk_tolerance=risk_tolerance)
                for m, z in zip(rows_meta, z_scores)
            ]
            raavs = _renormalize_raav(fairs, raw_raavs, rules)
        else:
            raavs = [None for _ in rows_meta]

        for m, z, raav in zip(rows_meta, z_scores, raavs):
            out[m["pid"]] = {
                "fair_value": m["fair"],
                "min_sal": m["min_sal"],
                "max_sal": m["max_sal"],
                "tier": m["tier"],
                "rank": m["rank"],
                "auction_relevant": m["auction_relevant"],
                "risk_score": round(float(z), 4),
                "upside_skew": round(float(m["skew"]), 4) if m["skew"] is not None else None,
                "season_cv": round(float(m["cv"]), 4) if m["cv"] is not None else None,
                "risk_adjusted_value": raav if apply_raav else None,
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
