"""Personal vibe aura + start slate (SCORE-81).

Persists aura per league/team/season/week in SQLite and builds vibe slots from
the same roster × weekly-artifact cards as ``/api/hub/week`` (no live predict_*).
"""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.hub_context import list_roster_for_context
from src.draft_hub.hub_scoring import resolve_week_lineup, sleeper_hosts_scoring
from src.draft_hub.rules_engine import normalize_position, roster_limits
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.weekly_command_center import (
    _enrich_roster_players,
    _load_projection_index,
    _sync_metadata,
    resolve_week_context,
)

AURA_BASE = 50.0
AURA_MIN = 0.0
AURA_MAX = 99.0
VIBE_DELTA = {"start": 14.0, "sit": -14.0}

BOARD_SLOT_ORDER = ("QB", "RB", "WR", "TE", "FLEX", "K", "DEF")
DEFAULT_STARTER_COUNTS = {
    "QB": 1,
    "RB": 2,
    "WR": 2,
    "TE": 1,
    "FLEX": 1,
    "K": 1,
    "DEF": 1,
}
DEFAULT_FLEX_ELIGIBLE = frozenset({"RB", "WR", "TE"})


def clamp_aura(value: Any) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return AURA_BASE
    if num != num:  # NaN
        return AURA_BASE
    return max(AURA_MIN, min(AURA_MAX, num))


def read_aura(aura_by_id: dict[str, Any] | None, player_id: str | None) -> float:
    pid = str(player_id or "")
    if not pid or not isinstance(aura_by_id, dict) or pid not in aura_by_id:
        return AURA_BASE
    return clamp_aura(aura_by_id.get(pid))


def apply_vibe(
    aura_by_id: dict[str, Any] | None,
    player_id: str | None,
    vibe: str,
) -> dict[str, float]:
    """Return a new aura map with one start/sit vote applied."""
    out = {
        str(k): clamp_aura(v)
        for k, v in (aura_by_id or {}).items()
        if str(k or "").strip()
    }
    pid = str(player_id or "").strip()
    delta = VIBE_DELTA.get(str(vibe or "").lower())
    if not pid or delta is None:
        return out
    out[pid] = clamp_aura(read_aura(out, pid) + delta)
    return out


def normalize_aura_map(aura_by_id: dict[str, Any] | None) -> dict[str, float]:
    out: dict[str, float] = {}
    for key, value in (aura_by_id or {}).items():
        pid = str(key or "").strip()
        if not pid:
            continue
        out[pid] = clamp_aura(value)
    return out


def vibe_score(player: dict[str, Any] | None, aura: float | None = None) -> float:
    """Aura scales week P50. 50 = 1.0×, 0 = 0.6×, 99 ≈ 1.39×."""
    try:
        p50 = float((player or {}).get("p50"))
    except (TypeError, ValueError):
        p50 = 0.0
    if p50 != p50:
        p50 = 0.0
    proj = max(0.0, p50)
    a = clamp_aura(aura if aura is not None else AURA_BASE)
    return proj * (0.6 + 0.4 * (a / AURA_BASE))


def eligible_to_start(player: dict[str, Any] | None) -> bool:
    if not player or not player.get("player_id"):
        return False
    if player.get("on_bye") or player.get("injured"):
        return False
    return True


def _starter_slot_label(position: str, index: int, count: int) -> str:
    if count <= 1:
        return position
    return f"{position}{index + 1}"


def _flex_eligible(rules: LeagueRules) -> frozenset[str]:
    raw = (rules.roster or {}).get("flex") if isinstance(rules.roster, dict) else None
    if hasattr(rules.roster, "flex"):
        raw = getattr(rules.roster, "flex", None)
    if raw is None and isinstance(rules.roster, dict):
        raw = rules.roster.get("flex")
    if not isinstance(raw, dict):
        # Pydantic nested model
        eligible = getattr(raw, "eligible", None) if raw is not None else None
        if eligible:
            return frozenset(normalize_position(p) for p in eligible)
        return DEFAULT_FLEX_ELIGIBLE
    eligible = raw.get("eligible") or ["RB", "WR", "TE"]
    return frozenset(normalize_position(p) for p in eligible)


def build_starter_slot_plan(rules: LeagueRules | None) -> list[dict[str, Any]]:
    """Match frontend ``buildStarterSlotPlan`` (weekBoard.js)."""
    counts = dict(DEFAULT_STARTER_COUNTS)
    roster = getattr(rules, "roster", None) if rules is not None else None
    if roster:
        limits = roster_limits(rules) if rules is not None else {}
        for pos in ("QB", "RB", "WR", "TE", "K", "DEF"):
            entry = limits.get(pos.lower()) or {}
            try:
                counts[pos] = max(0, int(entry.get("starter") or 0))
            except (TypeError, ValueError):
                counts[pos] = 0
        flex = None
        if isinstance(roster, dict):
            flex = roster.get("flex")
        else:
            flex = getattr(roster, "flex", None)
        if isinstance(flex, dict):
            try:
                counts["FLEX"] = max(0, int(flex.get("starter") or 0))
            except (TypeError, ValueError):
                counts["FLEX"] = 0
        elif flex is not None:
            try:
                counts["FLEX"] = max(0, int(getattr(flex, "starter", 0) or 0))
            except (TypeError, ValueError):
                counts["FLEX"] = 0
        else:
            counts["FLEX"] = 0

    slots: list[dict[str, Any]] = []
    for pos in BOARD_SLOT_ORDER:
        n = int(counts.get(pos) or 0)
        for i in range(n):
            label = _starter_slot_label(pos, i, n)
            slots.append(
                {
                    "key": label,
                    "slot": label,
                    "position": pos,
                    "index": i,
                }
            )
    return slots


def fill_slots_by_score(
    plan: list[dict[str, Any]],
    players: list[dict[str, Any]],
    score_of,
    *,
    flex_eligible: frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    flex_ok = flex_eligible or DEFAULT_FLEX_ELIGIBLE
    remaining = sorted(
        players or [],
        key=lambda p: (
            -float(score_of(p) or 0.0),
            str(p.get("player_id") or ""),
        ),
    )
    used: set[str] = set()

    def _take(pred) -> dict[str, Any] | None:
        for card in remaining:
            pid = str(card.get("player_id") or "")
            if not pid or pid in used or not eligible_to_start(card):
                continue
            if pred(card):
                used.add(pid)
                return card
        return None

    out: list[dict[str, Any]] = []
    for slot in plan or []:
        position = str(slot.get("position") or "").upper()

        def _pred(card: dict[str, Any], pos: str = position) -> bool:
            card_pos = normalize_position(card.get("position"))
            if pos == "FLEX":
                return card_pos in flex_ok
            return card_pos == pos

        player = _take(_pred)
        out.append({**slot, "player": player})
    return out


def projection_starts(
    players: list[dict[str, Any]],
    rules: LeagueRules | None,
) -> list[dict[str, Any]]:
    plan = build_starter_slot_plan(rules)
    flex = _flex_eligible(rules) if rules is not None else DEFAULT_FLEX_ELIGIBLE
    return fill_slots_by_score(
        plan,
        players,
        lambda p: float(p.get("p50") or 0.0),
        flex_eligible=flex,
    )


def vibe_starts(
    players: list[dict[str, Any]],
    aura_by_id: dict[str, Any] | None,
    rules: LeagueRules | None,
) -> list[dict[str, Any]]:
    plan = build_starter_slot_plan(rules)
    flex = _flex_eligible(rules) if rules is not None else DEFAULT_FLEX_ELIGIBLE
    return fill_slots_by_score(
        plan,
        players,
        lambda p: vibe_score(p, read_aura(aura_by_id, p.get("player_id"))),
        flex_eligible=flex,
    )


def _start_ids(slots: list[dict[str, Any]]) -> set[str]:
    out: set[str] = set()
    for slot in slots or []:
        player = slot.get("player") or {}
        pid = str(player.get("player_id") or "")
        if pid:
            out.add(pid)
    return out


def _public_player(
    player: dict[str, Any] | None,
    *,
    aura_by_id: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if not player or not player.get("player_id"):
        return None
    aura = read_aura(aura_by_id, player.get("player_id"))
    return {
        "player_id": str(player["player_id"]),
        "player_name": player.get("player_name"),
        "position": normalize_position(player.get("position")),
        "team": player.get("team") or player.get("nfl_team") or "",
        "p50": player.get("p50"),
        "p10": player.get("p10"),
        "p90": player.get("p90"),
        "on_bye": bool(player.get("on_bye")),
        "injured": bool(player.get("injured")),
        "injury_status": player.get("injury_status"),
        "aura": aura,
        "vibe_week": round(vibe_score(player, aura), 3),
    }


def public_slots(
    slots: list[dict[str, Any]],
    *,
    aura_by_id: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for slot in slots or []:
        out.append(
            {
                "key": slot.get("key") or slot.get("slot"),
                "slot": slot.get("slot"),
                "position": slot.get("position"),
                "index": slot.get("index"),
                "player": _public_player(slot.get("player"), aura_by_id=aura_by_id),
            }
        )
    return out


def vibe_divergences(
    proj_slots: list[dict[str, Any]],
    vibe_slots: list[dict[str, Any]],
) -> dict[str, Any]:
    proj_ids = _start_ids(proj_slots)
    vibe_ids = _start_ids(vibe_slots)
    in_vibe = [
        slot.get("player")
        for slot in (vibe_slots or [])
        if slot.get("player") and str(slot["player"].get("player_id") or "") not in proj_ids
    ]
    in_proj = [
        slot.get("player")
        for slot in (proj_slots or [])
        if slot.get("player") and str(slot["player"].get("player_id") or "") not in vibe_ids
    ]
    pairs = []
    n = min(len(in_vibe), len(in_proj))
    for i in range(n):
        pairs.append({"start": in_vibe[i], "sit": in_proj[i]})
    return {
        "in_vibe": [_public_player(p) for p in in_vibe],
        "in_proj": [_public_player(p) for p in in_proj],
        "pairs": [
            {
                "start": _public_player(pair["start"]),
                "sit": _public_player(pair["sit"]),
            }
            for pair in pairs
        ],
    }


def starters_for_lineup(vibe_slots: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Shape ready for ``PUT /api/hub/league/{id}/lineup``."""
    out: list[dict[str, str]] = []
    for slot in vibe_slots or []:
        player = slot.get("player") or {}
        pid = str(player.get("player_id") or "").strip()
        label = str(slot.get("slot") or "").strip()
        if pid and label:
            out.append({"player_id": pid, "slot": label})
    return out


def _load_week_players(
    ctx: dict[str, Any],
    *,
    season: int,
    week: int,
) -> tuple[list[dict[str, Any]], dict[str, Any], LeagueRules]:
    rules = LeagueRules.model_validate(ctx.get("rules") or {})
    roster_rows = list_roster_for_context(ctx, live_sleeper=False)
    proj_index, proj_meta = _load_projection_index(
        season,
        week,
        apply_injury_adjustments=True,
    )
    players = _enrich_roster_players(
        roster_rows,
        proj_index,
        by_name_team=proj_meta.pop("_by_name_team", {}) or {},
        by_name=proj_meta.pop("_by_name", {}) or {},
    )
    from src.draft_hub.k_def_pool_cache import overlay_k_def_week_projections

    overlay_k_def_week_projections(players)
    return players, proj_meta, rules


def build_vibe_rankings(
    ctx: dict[str, Any],
    *,
    season: int | None = None,
    week: int | None = None,
    aura_by_id: dict[str, Any] | None = None,
    persist: bool = False,
) -> dict[str, Any]:
    """Build GET/PUT ``/api/hub/vibes`` payload from week roster cards + stored aura."""
    hub_season = int(ctx["season"]) if ctx.get("season") is not None else None
    try:
        resolved_season, resolved_week = resolve_week_context(
            season, week, hub_season=hub_season
        )
    except Exception:
        resolved_season = int(season or hub_season or 2026)
        resolved_week = int(week or 1)

    league_id = str(ctx.get("league_id") or "")
    team_id = str(ctx.get("team_id") or "")
    mode = ctx.get("mode")

    stored: dict[str, float] = {}
    if league_id and team_id and mode == "league":
        if persist:
            stored = storage.put_team_vibe_aura(
                league_id,
                team_id,
                resolved_season,
                resolved_week,
                aura_by_id or {},
            )
        else:
            stored = storage.get_team_vibe_aura(
                league_id, team_id, resolved_season, resolved_week
            )
            if aura_by_id is not None:
                stored = normalize_aura_map(aura_by_id)
    elif aura_by_id is not None:
        stored = normalize_aura_map(aura_by_id)

    players, proj_meta, rules = _load_week_players(
        ctx, season=resolved_season, week=resolved_week
    )
    # Attach lineups only for meta (can_edit); slate fill uses vibe math, not saved lineup.
    _, _, lineup_meta = resolve_week_lineup(
        ctx,
        players,
        rules,
        season=resolved_season,
        week=resolved_week,
    )

    proj_slots = projection_starts(players, rules)
    vibe_slots_raw = vibe_starts(players, stored, rules)
    divergences = vibe_divergences(proj_slots, vibe_slots_raw)
    public_vibe = public_slots(vibe_slots_raw, aura_by_id=stored)
    public_proj = public_slots(proj_slots, aura_by_id=stored)

    league = storage.get_league(league_id) if league_id else None
    sleeper_hosted = sleeper_hosts_scoring(league, ctx)
    lineup_source = lineup_meta.get("lineup_source") or "inferred"
    lineup_locked = bool(lineup_meta.get("lineup_locked"))
    can_edit = (
        mode == "league"
        and bool(league_id)
        and bool(team_id)
        and lineup_source == "hub"
        and not lineup_locked
    )

    sync = _sync_metadata(ctx)
    return {
        "aura_by_id": stored,
        "vibe_slots": public_vibe,
        "divergences": divergences,
        "projection_slots": public_proj,
        "starters": starters_for_lineup(public_vibe),
        "hub_context": {
            "mode": mode,
            "league_id": ctx.get("league_id"),
            "league_name": ctx.get("league_name"),
            "team_id": ctx.get("team_id"),
            "team_name": ctx.get("team_name"),
            "season": hub_season,
            "sleeper_league_id": ctx.get("sleeper_league_id"),
        },
        "meta": {
            "season": resolved_season,
            "week": resolved_week,
            "projections_available": bool(proj_meta.get("available")),
            "lineup_source": lineup_source,
            "lineup_locked": lineup_locked,
            "can_edit_lineup": can_edit,
            "sleeper_hosts_scoring": sleeper_hosted,
            "lineup_set_path": (
                f"/api/hub/league/{league_id}/lineup" if league_id else None
            ),
            "persists_aura": bool(league_id and team_id and mode == "league"),
        },
        "sync": sync,
        "counts": {
            "roster": len(players),
            "rated": len(stored),
            "divergences": len(divergences.get("pairs") or []),
        },
    }
