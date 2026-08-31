"""Personalized Weekly Hub Command Center (SCORE-6).

Joins Hub roster state (SQLite, no live Sleeper) with weekly projection
artifacts at request time. Starters/bench are inferred from LeagueRules
starter counts + P50 ranking — Hub does not persist weekly lineup slots.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

import numpy as np
import pandas as pd

from src.core.projection_context import resolve_projection_context
from src.config import PROCESSED_DATA_DIR
from src.draft_hub import storage
from src.draft_hub.hub_context import list_roster_for_context
from src.draft_hub.rules_engine import normalize_position, roster_limits
from src.draft_hub.schemas import LeagueRules
from src.projections.player_compare import (
    _pick_num,
    position_rank_map,
    volatility,
)
from src.draft_hub.player_name_match import name_key
from src.projections.weekly_cache import load_weekly_prediction

# nflverse/mlready uses LA/JAC/WAS; Sleeper rosters often use LAR/JAX/WSH.
_TEAM_LOOKUP_ALIASES = {
    "LA": ("LA", "LAR"),
    "LAR": ("LAR", "LA"),
    "JAC": ("JAC", "JAX"),
    "JAX": ("JAX", "JAC"),
    "WAS": ("WAS", "WSH"),
    "WSH": ("WSH", "WAS"),
}


def _teams_compatible(roster_team: str, proj_team: str) -> bool:
    """True when roster team is unknown, or the projection team is the same club."""
    if not roster_team:
        return True
    if not proj_team:
        return False
    if proj_team == roster_team:
        return True
    return proj_team in _TEAM_LOOKUP_ALIASES.get(roster_team, ())

# Positions with weekly GBM artifacts today.
ARTIFACT_POSITIONS = ("qb", "rb", "wr")
STARTER_FILL_ORDER = ("QB", "RB", "WR", "TE", "K", "DEF")

DEFAULT_BENCH_OVER_STARTER_THRESHOLD = 2.0
DEFAULT_WIDE_VOLATILITY = 0.70
DEFAULT_WIDE_SPREAD = 18.0

_P50_KEYS = ("Projected Points", "P50", "p50")
_P10_KEYS = ("Low (P10)", "P10", "p10")
_P90_KEYS = ("High (P90)", "P90", "p90")

_UNAVAILABLE_INJURY = ("out", "ir", "pup", "inactive", "suspended")


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


def resolve_week_context(
    season: int | None,
    week: int | None,
    *,
    hub_season: int | None = None,
) -> tuple[int, int]:
    """Resolve season/week from mlready context, preferring hub league season."""
    path = PROCESSED_DATA_DIR / "qb_mlready.parquet"
    if not path.exists():
        s = int(season or hub_season or 2026)
        w = int(week or 1)
        return s, w
    df = pd.read_parquet(path, columns=["season", "week"])
    preferred_season = season if season is not None else hub_season
    return resolve_projection_context(df, preferred_season, week)


def _flex_rule(rules: LeagueRules) -> tuple[int, frozenset[str]]:
    raw = (rules.roster or {}).get("flex") or {}
    if not isinstance(raw, dict):
        return 0, frozenset({"RB", "WR", "TE"})
    starter = int(raw.get("starter") or 0)
    eligible = raw.get("eligible") or ["RB", "WR", "TE"]
    return starter, frozenset(normalize_position(p) for p in eligible)


def _is_injured(status: str | None) -> bool:
    text = str(status or "").lower()
    return any(token in text for token in _UNAVAILABLE_INJURY)


def _is_on_bye(opponent: str | None, team: str | None, bye_teams: set[str] | None) -> bool:
    opp = str(opponent or "").strip().upper()
    if opp == "BYE":
        return True
    if bye_teams and team:
        return str(team).strip().upper() in bye_teams
    return False


def _load_projection_index(
    season: int,
    week: int,
    *,
    apply_injury_adjustments: bool,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Map player_id / name → projection fields from weekly artifacts (no live compute)."""
    index: dict[str, dict[str, Any]] = {}
    by_name_team: dict[str, dict[str, Any]] = {}
    by_name: dict[str, list[dict[str, Any]]] = {}
    built_ats: list[str] = []
    available_positions: list[str] = []
    missing_positions: list[str] = []

    for pos in ARTIFACT_POSITIONS:
        preds = load_weekly_prediction(
            pos,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
            allow_compute=False,
        )
        if preds.empty:
            missing_positions.append(pos)
            continue
        available_positions.append(pos)
        built = preds.attrs.get("built_at")
        if built:
            built_ats.append(str(built))
        ranks = position_rank_map(preds)
        for _, row in preds.iterrows():
            pid = str(row.get("player_id") or "").strip()
            p10 = _pick_num(row, _P10_KEYS)
            p50 = _pick_num(row, _P50_KEYS)
            p90 = _pick_num(row, _P90_KEYS)
            opponent = str(row.get("Opponent") or "")
            injury_status = str(row.get("Injury Status") or "")
            player_name = str(row.get("Player") or "")
            team = str(row.get("Team") or "")
            entry = {
                "player_id": pid,
                "player_name": player_name,
                "team": team,
                "position": normalize_position(row.get("Position") or pos),
                "p10": _round_opt(p10),
                "p50": _round_opt(p50),
                "p90": _round_opt(p90),
                "volatility": _round_opt(volatility(p10, p50, p90), 3),
                "spread": _round_opt(
                    (float(p90) - float(p10)) if p10 is not None and p90 is not None else None
                ),
                "opponent": opponent,
                "injury_status": injury_status,
                "injury_note": str(row.get("Injury Note") or ""),
                "position_rank": ranks.get(pid) if pid else None,
                "has_projection": p50 is not None,
            }
            if pid:
                index[pid] = entry
                if pid.startswith("sleeper-"):
                    index[pid.removeprefix("sleeper-")] = entry
            nk = name_key(player_name)
            team_key = team.strip().upper()
            if nk and team_key:
                by_name_team[f"{nk}|{team_key}"] = entry
            if nk:
                by_name.setdefault(nk, []).append(entry)

    meta = {
        "available": bool(available_positions),
        "available_positions": available_positions,
        "missing_positions": missing_positions,
        "projections_built_at": max(built_ats) if built_ats else None,
        "_by_name_team": by_name_team,
        "_by_name": by_name,
    }
    return index, meta


def _lookup_projection(
    slot: dict[str, Any],
    proj_index: dict[str, dict[str, Any]],
    by_name_team: dict[str, dict[str, Any]],
    by_name: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    pid = str(slot.get("player_id") or "").strip()
    if pid and pid in proj_index:
        return proj_index[pid]
    if pid.startswith("sleeper-"):
        raw = pid.removeprefix("sleeper-")
        if raw in proj_index:
            return proj_index[raw]
    elif pid:
        prefixed_pid = f"sleeper-{pid}"
        if prefixed_pid in proj_index:
            return proj_index[prefixed_pid]
    spid = str(slot.get("sleeper_player_id") or "").strip()
    if spid:
        if spid in proj_index:
            return proj_index[spid]
        prefixed = f"sleeper-{spid}"
        if prefixed in proj_index:
            return proj_index[prefixed]
    nk = name_key(str(slot.get("player_name") or ""))
    team = str(slot.get("team") or "").strip().upper()
    if nk and team:
        for code in _TEAM_LOOKUP_ALIASES.get(team, (team,)):
            hit = by_name_team.get(f"{nk}|{code}")
            if hit:
                return hit
    if nk:
        hits = by_name.get(nk) or []
        if len(hits) == 1:
            proj_team = str(hits[0].get("team") or "").strip().upper()
            # Unique-name fallback is for sheets with no team, not a different
            # NFL club (Josh Allen JAX must not inherit BUF QB projections).
            if _teams_compatible(team, proj_team):
                return hits[0]
    return {}


def _projection_sort_key(card: dict[str, Any]) -> tuple[float, float, str]:
    p50 = card.get("p50")
    p90 = card.get("p90")
    # Prefer projected players; missing projections sort last.
    score = float(p50) if isinstance(p50, (int, float)) else float("-inf")
    ceil = float(p90) if isinstance(p90, (int, float)) else float("-inf")
    return (score, ceil, str(card.get("player_id") or ""))


def _salary_sort_key(card: dict[str, Any]) -> tuple[float, str]:
    """Heuristic 'current lineup' fill — salary desc (can be suboptimal vs P50)."""
    salary = card.get("salary")
    sal = float(salary) if isinstance(salary, (int, float)) else float("-inf")
    return (sal, str(card.get("player_id") or ""))


def _enrich_roster_players(
    roster: list[dict[str, Any]],
    proj_index: dict[str, dict[str, Any]],
    *,
    bye_teams: set[str] | None = None,
    by_name_team: dict[str, dict[str, Any]] | None = None,
    by_name: dict[str, list[dict[str, Any]]] | None = None,
) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    by_name_team = by_name_team or {}
    by_name = by_name or {}
    for slot in roster:
        if str(slot.get("roster_status") or "active") == "cut_before_draft":
            continue
        pid = str(slot.get("player_id") or "").strip()
        if not pid:
            continue
        pos = normalize_position(slot.get("position"))
        proj = _lookup_projection(slot, proj_index, by_name_team, by_name)
        opponent = proj.get("opponent")
        team = str(slot.get("team") or proj.get("team") or "")
        injury_status = str(proj.get("injury_status") or "")
        on_bye = _is_on_bye(opponent, team, bye_teams)
        card = {
            "player_id": pid,
            "player_name": str(slot.get("player_name") or proj.get("player_name") or ""),
            "team": team,
            "position": pos,
            "salary": _json_safe(slot.get("salary")),
            "contract_years": _json_safe(slot.get("contract_years")),
            "sleeper_player_id": slot.get("sleeper_player_id"),
            "source": slot.get("source"),
            "p10": proj.get("p10"),
            "p50": proj.get("p50"),
            "p90": proj.get("p90"),
            "volatility": proj.get("volatility"),
            "spread": proj.get("spread"),
            "opponent": opponent,
            "on_bye": on_bye,
            "injury_status": injury_status,
            "injury_note": proj.get("injury_note") or "",
            "injured": _is_injured(injury_status),
            "position_rank": proj.get("position_rank"),
            "has_projection": bool(proj.get("has_projection")),
            "projection_missing": not bool(proj.get("has_projection")),
        }
        cards.append(card)
    return cards


def infer_starters_and_bench(
    players: list[dict[str, Any]],
    rules: LeagueRules,
    *,
    fill_key: str = "salary",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Fill starter slots from LeagueRules; remainder is bench.

    Hub does not persist Sleeper weekly starters. V1 uses salary-desc fill as a
    stable "current lineup" heuristic so projection-based swap recommendations
    can still surface (pure P50 fill would never recommend a bench upgrade).
    """
    limits = roster_limits(rules)
    flex_count, flex_eligible = _flex_rule(rules)
    sort_key = _salary_sort_key if fill_key == "salary" else _projection_sort_key

    remaining = sorted(players, key=sort_key, reverse=True)
    starters: list[dict[str, Any]] = []
    used: set[str] = set()

    def _take(position: str, n: int, *, slot_label: str) -> None:
        nonlocal remaining
        if n <= 0:
            return
        taken = 0
        keep: list[dict[str, Any]] = []
        for card in remaining:
            pid = card["player_id"]
            if pid in used:
                continue
            if card.get("position") != position:
                keep.append(card)
                continue
            if taken >= n:
                keep.append(card)
                continue
            starter = dict(card)
            starter["slot"] = slot_label if n == 1 else f"{slot_label}{taken + 1}"
            starter["lineup_role"] = "starter"
            starters.append(starter)
            used.add(pid)
            taken += 1
        remaining = [c for c in keep if c["player_id"] not in used]

    for pos in STARTER_FILL_ORDER:
        need = int((limits.get(pos.lower()) or {}).get("starter") or 0)
        _take(pos, need, slot_label=pos)

    # FLEX from remaining eligible positions.
    if flex_count > 0:
        keep: list[dict[str, Any]] = []
        taken = 0
        for card in remaining:
            pid = card["player_id"]
            if pid in used:
                continue
            if taken < flex_count and card.get("position") in flex_eligible:
                starter = dict(card)
                starter["slot"] = "FLEX" if flex_count == 1 else f"FLEX{taken + 1}"
                starter["lineup_role"] = "starter"
                starters.append(starter)
                used.add(pid)
                taken += 1
            else:
                keep.append(card)
        remaining = [c for c in keep if c["player_id"] not in used]

    bench: list[dict[str, Any]] = []
    for card in remaining:
        if card["player_id"] in used:
            continue
        b = dict(card)
        b["slot"] = "BN"
        b["lineup_role"] = "bench"
        bench.append(b)

    # Bench presentation by projected points (decision priority).
    bench.sort(key=_projection_sort_key, reverse=True)
    return starters, bench


def _same_or_flex_match(
    starter: dict[str, Any],
    bench: dict[str, Any],
    flex_eligible: frozenset[str],
) -> bool:
    sp = starter.get("position")
    bp = bench.get("position")
    if sp == bp:
        return True
    # Dedicated RB/WR/TE slots are not interchangeable. A bench player may only
    # replace a FLEX starter when they are flex-eligible.
    if str(starter.get("slot") or "").startswith("FLEX"):
        return bp in flex_eligible
    return False


def build_lineup_decisions(
    starters: list[dict[str, Any]],
    bench: list[dict[str, Any]],
    *,
    threshold: float = DEFAULT_BENCH_OVER_STARTER_THRESHOLD,
    flex_eligible: frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    """Deterministic swap recommendations (no LLM)."""
    flex_eligible = flex_eligible or frozenset({"RB", "WR", "TE"})
    decisions: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()

    for starter in starters:
        for bench_player in bench:
            sid = str(starter["player_id"])
            bid = str(bench_player["player_id"])
            pair = (bid, sid)
            if pair in seen_pairs:
                continue
            # Bye / Out / IR bench players are not startable this week even if
            # artifacts still emit a P50.
            if bench_player.get("on_bye") or bench_player.get("injured"):
                continue
            if not _same_or_flex_match(starter, bench_player, flex_eligible):
                continue

            reasons: list[str] = []
            decision_type = "bench_over_starter"
            s_p50 = starter.get("p50")
            b_p50 = bench_player.get("p50")
            s_p10 = starter.get("p10")
            b_p10 = bench_player.get("p10")
            delta_p50: float | None = None

            if not starter.get("has_projection") and bench_player.get("has_projection"):
                reasons.append("starter_missing_projection")
                decision_type = "starter_missing_projection"
                if isinstance(b_p50, (int, float)):
                    delta_p50 = float(b_p50)
            elif (
                isinstance(s_p50, (int, float))
                and isinstance(b_p50, (int, float))
                and float(b_p50) > float(s_p50) + float(threshold)
            ):
                delta_p50 = float(b_p50) - float(s_p50)
                reasons.append("bench_p50_above_threshold")

            if (
                isinstance(s_p10, (int, float))
                and isinstance(b_p10, (int, float))
                and float(b_p10) > float(s_p10)
            ):
                reasons.append("bench_higher_floor")

            s_vol = starter.get("volatility")
            if isinstance(s_vol, (int, float)) and float(s_vol) >= DEFAULT_WIDE_VOLATILITY:
                if reasons:
                    reasons.append("starter_high_volatility")

            if not reasons:
                continue
            # Require a primary actionable reason (not floor-only noise).
            if not any(
                r in reasons
                for r in (
                    "bench_p50_above_threshold",
                    "starter_missing_projection",
                )
            ):
                continue

            seen_pairs.add(pair)
            b_name = bench_player.get("player_name") or bid
            s_name = starter.get("player_name") or sid
            if delta_p50 is not None and "bench_p50_above_threshold" in reasons:
                message = (
                    f"{b_name} projects +{delta_p50:.1f} above your current "
                    f"{starter.get('slot') or s_name}."
                )
            elif "starter_missing_projection" in reasons:
                message = (
                    f"{s_name} has no weekly projection; consider {b_name} "
                    f"({bench_player.get('slot') or 'BN'})."
                )
            else:
                message = f"Consider starting {b_name} over {s_name}."

            decisions.append(
                {
                    "type": decision_type,
                    "bench_player_id": bid,
                    "bench_player_name": b_name,
                    "bench_position": bench_player.get("position"),
                    "bench_p50": bench_player.get("p50"),
                    "starter_player_id": sid,
                    "starter_player_name": s_name,
                    "starter_position": starter.get("position"),
                    "starter_slot": starter.get("slot"),
                    "starter_p50": starter.get("p50"),
                    "delta_p50": _round_opt(delta_p50),
                    "threshold": float(threshold),
                    "reasons": reasons,
                    "message": message,
                }
            )

    decisions.sort(
        key=lambda d: (
            1 if d.get("type") == "bench_over_starter" else 0,
            float(d["delta_p50"]) if isinstance(d.get("delta_p50"), (int, float)) else -1.0,
        ),
        reverse=True,
    )
    # One recommendation per starter slot and per bench player: the same bench
    # player cannot be started in two slots, and each slot keeps its highest-
    # value unused challenger (decisions are already ranked).
    assigned: list[dict[str, Any]] = []
    used_starters: set[str] = set()
    used_bench: set[str] = set()
    for decision in decisions:
        sid = str(decision["starter_player_id"])
        bid = str(decision["bench_player_id"])
        if sid in used_starters or bid in used_bench:
            continue
        used_starters.add(sid)
        used_bench.add(bid)
        assigned.append(decision)
    return assigned


def build_wide_ranges(
    players: Iterable[dict[str, Any]],
    *,
    volatility_threshold: float = DEFAULT_WIDE_VOLATILITY,
    spread_threshold: float = DEFAULT_WIDE_SPREAD,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for card in players:
        vol = card.get("volatility")
        spread = card.get("spread")
        wide_vol = isinstance(vol, (int, float)) and float(vol) >= volatility_threshold
        wide_spread = isinstance(spread, (int, float)) and float(spread) >= spread_threshold
        if not (wide_vol or wide_spread):
            continue
        out.append(
            {
                "player_id": card["player_id"],
                "player_name": card.get("player_name"),
                "position": card.get("position"),
                "lineup_role": card.get("lineup_role"),
                "slot": card.get("slot"),
                "p10": card.get("p10"),
                "p50": card.get("p50"),
                "p90": card.get("p90"),
                "volatility": vol,
                "spread": spread,
                "reason": "high_volatility" if wide_vol else "wide_spread",
            }
        )
    out.sort(
        key=lambda r: float(r["volatility"] or 0) if r.get("volatility") is not None else 0.0,
        reverse=True,
    )
    return out


def _sync_metadata(ctx: dict[str, Any]) -> dict[str, Any]:
    synced_at: str | None = None
    linked = False
    sync_endpoint: str | None = None

    if ctx.get("mode") == "league" and ctx.get("team_id"):
        team = storage.get_team(str(ctx["team_id"]))
        if team:
            synced_at = team.get("sleeper_synced_at")
        linked = bool(ctx.get("sleeper_league_id") and ctx.get("sleeper_roster_id"))
        if ctx.get("league_id"):
            sync_endpoint = f"/api/hub/league/{ctx['league_id']}/sleeper/sync"
    else:
        ws = storage.get_workspace_by_id(str(ctx.get("workspace_id") or ""))
        if ws:
            synced_at = ws.get("sleeper_synced_at")
            linked = bool(ws.get("sleeper_username") or ws.get("sleeper_league_id"))
        sync_endpoint = "/api/hub/sleeper/sync"

    return {
        "sleeper_synced_at": synced_at,
        "linked": linked,
        "sync_endpoint": sync_endpoint,
        "sync_action": "POST",
        "note": "Use Sync League explicitly; dashboard load never polls Sleeper.",
    }


def _roster_projection_changes(
    players: list[dict[str, Any]],
    season: int,
    week: int,
    *,
    apply_injury_adjustments: bool,
) -> dict[str, Any]:
    """Attach SCORE-7 movement for roster players (soft-fail if artifact missing)."""
    try:
        from src.projections.projection_movement import build_projection_movement_payload
    except Exception:
        return {
            "available": False,
            "items": [],
            "note": "Projection movement module unavailable.",
        }

    by_pos: dict[str, list[str]] = {}
    for player in players:
        pos = normalize_position(player.get("position")).lower()
        pid = str(player.get("player_id") or "").strip()
        if pos not in ARTIFACT_POSITIONS or not pid:
            continue
        by_pos.setdefault(pos, []).append(pid)

    items: list[dict[str, Any]] = []
    any_available = False
    notes: list[str] = []
    for pos, pids in by_pos.items():
        payload = build_projection_movement_payload(
            pos,
            int(season),
            int(week),
            apply_injury_adjustments=apply_injury_adjustments,
            material_only=False,
            player_ids=pids,
        )
        if payload.get("available"):
            any_available = True
        else:
            note = (payload.get("meta") or {}).get("note")
            if note:
                notes.append(str(note))
        for change in payload.get("changes") or []:
            items.append(change)

    items.sort(
        key=lambda c: (
            abs(float(c.get("rank_delta") or 0)),
            abs(float(c.get("p50_delta") or 0)),
        ),
        reverse=True,
    )
    return {
        "available": any_available,
        "items": items,
        "note": (
            None
            if any_available
            else (notes[0] if notes else "Projection movement artifact not available.")
        ),
    }


def build_weekly_command_center(
    ctx: dict[str, Any],
    *,
    season: int | None = None,
    week: int | None = None,
    apply_injury_adjustments: bool = True,
    bench_over_starter_threshold: float = DEFAULT_BENCH_OVER_STARTER_THRESHOLD,
) -> dict[str, Any]:
    """Build the Your Week payload for the signed-in Hub user's active team."""
    hub_season = int(ctx["season"]) if ctx.get("season") is not None else None
    try:
        resolved_season, resolved_week = resolve_week_context(
            season, week, hub_season=hub_season
        )
    except Exception:
        resolved_season = int(season or hub_season or 2026)
        resolved_week = int(week or 1)

    rules = LeagueRules.model_validate(ctx.get("rules") or {})
    _, flex_eligible = _flex_rule(rules)

    # DB-only roster — never live_sleeper on dashboard load.
    roster_rows = list_roster_for_context(ctx, live_sleeper=False)
    proj_index, proj_meta = _load_projection_index(
        resolved_season,
        resolved_week,
        apply_injury_adjustments=apply_injury_adjustments,
    )
    players = _enrich_roster_players(
        roster_rows,
        proj_index,
        by_name_team=proj_meta.pop("_by_name_team", {}) or {},
        by_name=proj_meta.pop("_by_name", {}) or {},
    )
    starters, bench = infer_starters_and_bench(players, rules)

    decisions = build_lineup_decisions(
        starters,
        bench,
        threshold=bench_over_starter_threshold,
        flex_eligible=flex_eligible,
    )
    wide_ranges = build_wide_ranges([*starters, *bench])

    missing_projections = [
        {
            "player_id": p["player_id"],
            "player_name": p.get("player_name"),
            "position": p.get("position"),
            "lineup_role": p.get("lineup_role"),
            "slot": p.get("slot"),
        }
        for p in [*starters, *bench]
        if p.get("projection_missing")
    ]
    on_bye = [p for p in [*starters, *bench] if p.get("on_bye")]
    injured = [p for p in [*starters, *bench] if p.get("injured")]

    sync = _sync_metadata(ctx)
    unlinked = ctx.get("mode") != "league" and not sync.get("linked")
    # League without sleeper link is also an unlinked-league style state for UI.
    if ctx.get("mode") == "league" and not sync.get("linked"):
        unlinked = True

    return {
        "hub_context": {
            "mode": ctx.get("mode"),
            "league_id": ctx.get("league_id"),
            "league_name": ctx.get("league_name"),
            "team_id": ctx.get("team_id"),
            "team_name": ctx.get("team_name"),
            "season": hub_season,
        },
        "meta": {
            "season": resolved_season,
            "week": resolved_week,
            "apply_injury_adjustments": bool(apply_injury_adjustments),
            "projections_available": bool(proj_meta.get("available")),
            "projections_built_at": proj_meta.get("projections_built_at"),
            "available_positions": proj_meta.get("available_positions") or [],
            "missing_positions": proj_meta.get("missing_positions") or [],
            "bench_over_starter_threshold": float(bench_over_starter_threshold),
            "starter_inference": "league_rules_salary",
            "persists_projections": False,
        },
        "sync": sync,
        "status": {
            "unlinked_league": unlinked,
            "empty_roster": len(players) == 0,
            "projections_missing": not bool(proj_meta.get("available")),
        },
        "roster": {
            "starters": starters,
            "bench": bench,
            "missing_projections": missing_projections,
            "on_bye": [
                {
                    "player_id": p["player_id"],
                    "player_name": p.get("player_name"),
                    "position": p.get("position"),
                    "slot": p.get("slot"),
                    "team": p.get("team"),
                }
                for p in on_bye
            ],
            "injured": [
                {
                    "player_id": p["player_id"],
                    "player_name": p.get("player_name"),
                    "position": p.get("position"),
                    "slot": p.get("slot"),
                    "injury_status": p.get("injury_status"),
                }
                for p in injured
            ],
        },
        "decisions": decisions,
        "wide_ranges": wide_ranges,
        "projection_changes": _roster_projection_changes(
            [*starters, *bench],
            resolved_season,
            resolved_week,
            apply_injury_adjustments=apply_injury_adjustments,
        ),
        "counts": {
            "roster": len(players),
            "starters": len(starters),
            "bench": len(bench),
            "decisions": len(decisions),
            "wide_ranges": len(wide_ranges),
            "on_bye": len(on_bye),
            "injured": len(injured),
            "missing_projections": len(missing_projections),
        },
        "summary": {
            "headline": (
                f"{len(decisions)} lineup decision"
                f"{'' if len(decisions) == 1 else 's'} need attention"
                if decisions
                else "No high-value lineup swaps this week"
            ),
            "top_messages": [d["message"] for d in decisions[:3]],
        },
    }
