"""Personal aura + vibe-slate math for Fantasy → Vibes."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage

AURA_BASE = 50
AURA_MIN = 0
AURA_MAX = 99

FLEX_ELIGIBLE = ("RB", "WR", "TE")
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


def safe_number(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    if n != n or n in (float("inf"), float("-inf")):
        return default
    return n


def safe_int(value: Any, default: int | None = None) -> int | None:
    n = safe_number(value, float("nan"))
    if n != n:
        return default
    try:
        return int(n)
    except (OverflowError, ValueError):
        return default


def parse_aura(value: Any) -> int | None:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(AURA_MIN, min(AURA_MAX, n))


def clamp_aura(value: Any) -> int:
    parsed = parse_aura(value)
    return AURA_BASE if parsed is None else parsed


def normalize_aura_by_id(raw: dict[str, Any] | None) -> dict[str, int]:
    out: dict[str, int] = {}
    for key, value in (raw or {}).items():
        pid = str(key or "").strip()
        if not pid:
            continue
        parsed = parse_aura(value)
        if parsed is None:
            continue
        out[pid] = parsed
    return out


def read_aura(aura_by_id: dict[str, Any] | None, player_id: str | None) -> int:
    pid = str(player_id or "")
    if not pid or not aura_by_id or pid not in aura_by_id:
        return AURA_BASE
    return clamp_aura(aura_by_id.get(pid))


def vibe_score(player: dict[str, Any] | None, aura: Any) -> float:
    p50 = safe_number((player or {}).get("p50") if player is not None else None)
    proj = max(0.0, p50)
    a = clamp_aura(aura) if aura is not None else AURA_BASE
    return proj * (0.6 + 0.4 * (a / AURA_BASE))


def _pos_of(player: dict[str, Any] | None) -> str:
    return str((player or {}).get("position") or "").upper()


def eligible_to_start(player: dict[str, Any] | None) -> bool:
    if not player or not player.get("player_id"):
        return False
    if player.get("on_bye") or player.get("injured"):
        return False
    return True


def starter_slot_label(position: str, index: int, count: int) -> str:
    if count <= 1:
        return position
    return f"{position}{index + 1}"


def _rules_dict(rules: Any) -> dict[str, Any]:
    if rules is None:
        return {}
    if hasattr(rules, "model_dump"):
        return rules.model_dump()
    if isinstance(rules, dict):
        return rules
    return {}


def _starter_count(roster: dict[str, Any], position: str, missing: int = 0) -> int:
    entry = roster.get(position.lower())
    if not isinstance(entry, dict):
        return missing
    try:
        n = float(entry.get("starter"))
    except (TypeError, ValueError):
        return missing
    if n != n:
        return missing
    return max(0, int(n))


def build_starter_slot_plan(rules: Any) -> list[dict[str, Any]]:
    roster = _rules_dict(rules).get("roster") or {}
    has_roster = bool(isinstance(roster, dict) and roster)
    counts = dict(DEFAULT_STARTER_COUNTS)
    if has_roster:
        for pos in ("QB", "RB", "WR", "TE", "K", "DEF"):
            counts[pos] = _starter_count(roster, pos, 0)
        flex = roster.get("flex")
        if isinstance(flex, dict):
            try:
                counts["FLEX"] = max(0, int(float(flex.get("starter") or 0)))
            except (TypeError, ValueError):
                counts["FLEX"] = 0
        else:
            counts["FLEX"] = 0
    slots = []
    for pos in BOARD_SLOT_ORDER:
        n = counts.get(pos) or 0
        for i in range(n):
            label = starter_slot_label(pos, i, n)
            slots.append({"key": label, "slot": label, "position": pos, "index": i})
    return slots


def fill_slots_by_score(
    plan: list[dict[str, Any]],
    players: list[dict[str, Any]],
    score_of,
) -> list[dict[str, Any]]:
    def scored(row: dict[str, Any]) -> float:
        try:
            return safe_number(score_of(row))
        except (TypeError, ValueError, OverflowError):
            return 0.0

    remaining = sorted(
        list(players or []),
        key=lambda row: (
            -scored(row),
            str(row.get("player_id") or ""),
        ),
    )
    used: set[str] = set()

    def take(pred):
        for player in remaining:
            pid = str(player.get("player_id") or "")
            if not pid or pid in used or not eligible_to_start(player) or not pred(player):
                continue
            used.add(pid)
            return player
        return None

    filled = []
    for slot in plan or []:
        player = take(
            lambda row, position=slot.get("position"): (
                _pos_of(row) in FLEX_ELIGIBLE
                if position == "FLEX"
                else _pos_of(row) == position
            )
        )
        filled.append({**slot, "player": player})
    return filled


def projection_starts(players: list[dict[str, Any]], rules: Any) -> list[dict[str, Any]]:
    plan = build_starter_slot_plan(rules)
    return fill_slots_by_score(plan, players, lambda player: safe_number(player.get("p50")))


def vibe_starts(
    players: list[dict[str, Any]],
    aura_by_id: dict[str, Any] | None,
    rules: Any,
) -> list[dict[str, Any]]:
    plan = build_starter_slot_plan(rules)
    return fill_slots_by_score(
        plan,
        players,
        lambda player: vibe_score(player, read_aura(aura_by_id, player.get("player_id"))),
    )


def _start_ids(slots: list[dict[str, Any]]) -> set[str]:
    return {
        str(slot["player"]["player_id"])
        for slot in (slots or [])
        if slot.get("player") and slot["player"].get("player_id")
    }


def _public_player(player: dict[str, Any] | None) -> dict[str, Any] | None:
    if not player or not player.get("player_id"):
        return None
    return {
        "player_id": player.get("player_id"),
        "player_name": player.get("player_name"),
        "position": player.get("position"),
        "team": player.get("team"),
        "p50": player.get("p50"),
        "on_bye": bool(player.get("on_bye")),
        "injured": bool(player.get("injured")),
    }


def vibe_divergences(proj_slots: list[dict[str, Any]], vibe_slots: list[dict[str, Any]]) -> dict[str, Any]:
    proj = _start_ids(proj_slots)
    vibe = _start_ids(vibe_slots)
    in_vibe = [
        _public_player(slot.get("player"))
        for slot in (vibe_slots or [])
        if slot.get("player") and str(slot["player"].get("player_id")) not in proj
    ]
    in_proj = [
        _public_player(slot.get("player"))
        for slot in (proj_slots or [])
        if slot.get("player") and str(slot["player"].get("player_id")) not in vibe
    ]
    in_vibe = [row for row in in_vibe if row]
    in_proj = [row for row in in_proj if row]
    pairs = []
    for i in range(min(len(in_vibe), len(in_proj))):
        pairs.append({"start": in_vibe[i], "sit": in_proj[i]})
    return {"in_vibe": in_vibe, "in_proj": in_proj, "pairs": pairs}


def deck_players(week_payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    roster = (week_payload or {}).get("roster") or {}
    merged = list(roster.get("starters") or []) + list(roster.get("bench") or [])
    return [row for row in merged if row.get("player_id") and row.get("player_name")]


def public_vibe_slots(slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for slot in slots or []:
        out.append({
            "key": slot.get("key") or slot.get("slot"),
            "slot": slot.get("slot"),
            "position": slot.get("position"),
            "player": _public_player(slot.get("player")),
        })
    return out


def empty_divergences() -> dict[str, Any]:
    return {"in_vibe": [], "in_proj": [], "pairs": []}


def resolve_vibe_week(
    ctx: dict[str, Any] | None,
    season: Any = None,
    week: Any = None,
) -> tuple[int, int]:
    from src.draft_hub.weekly_command_center import resolve_week_context

    hub_season = safe_int((ctx or {}).get("season"))
    clean_season = safe_int(season)
    clean_week = safe_int(week)
    try:
        return resolve_week_context(clean_season, clean_week, hub_season=hub_season)
    except Exception:
        return (clean_season or hub_season or 2026, clean_week or 1)


def build_vibes_payload(
    ctx: dict[str, Any],
    *,
    season: int | None = None,
    week: int | None = None,
    aura_by_id: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from src.draft_hub.weekly_command_center import build_weekly_command_center

    resolved_season, resolved_week = resolve_vibe_week(ctx, season=season, week=week)

    league_id = str(ctx.get("league_id") or "") or None
    team_id = str(ctx.get("team_id") or "") or None
    stored = (
        list_vibe_aura_for(league_id, team_id, resolved_season, resolved_week)
        if league_id and team_id
        else {}
    )
    aura = normalize_aura_by_id(aura_by_id if aura_by_id is not None else stored)

    week_payload: dict[str, Any] = {}
    if league_id:
        try:
            week_payload = build_weekly_command_center(
                ctx,
                season=resolved_season,
                week=resolved_week,
            ) or {}
        except Exception:
            week_payload = {}

    rules = (week_payload.get("hub_context") or {}).get("rules") or ctx.get("rules")
    players = deck_players(week_payload)
    proj_slots = projection_starts(players, rules)
    vibe_slots = vibe_starts(players, aura, rules)
    return {
        "league_id": league_id,
        "team_id": team_id,
        "season": resolved_season,
        "week": resolved_week,
        "aura_by_id": aura,
        "vibe_slots": public_vibe_slots(vibe_slots),
        "divergences": vibe_divergences(proj_slots, vibe_slots) if players else empty_divergences(),
    }


def list_vibe_aura_for(
    league_id: str | None,
    team_id: str | None,
    season: int,
    week: int,
) -> dict[str, int]:
    if not league_id or not team_id:
        return {}
    return storage.list_vibe_aura(league_id, team_id, season, week)
