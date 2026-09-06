"""Named bot seats — display names plus bidding personalities."""

from __future__ import annotations

import re
import zlib
from typing import Any

BOT_PERSONAS: list[dict[str, Any]] = [
    {
        "id": "auditor",
        "name": "The Auditor",
        "nato": "Bot Alpha",
        "hint": "Never overpays",
        "ceil_min": 0.75,
        "ceil_max": 0.90,
        "jump_mult": 0.75,
        "min_jump": None,
        "luxury_mult": 0.55,
    },
    {
        "id": "whale",
        "name": "Whale",
        "nato": "Bot Bravo",
        "hint": "Jumps +$10",
        "ceil_min": 1.08,
        "ceil_max": 1.22,
        "jump_mult": 1.55,
        "min_jump": 10.0,
        "luxury_mult": 0.90,
    },
    {
        "id": "scout",
        "name": "The Scout",
        "nato": "Bot Charlie",
        "hint": "Pays for upside",
        "ceil_min": 0.88,
        "ceil_max": 1.12,
        "jump_mult": 1.10,
        "min_jump": None,
        "luxury_mult": 0.75,
    },
    {
        "id": "needler",
        "name": "The Needler",
        "nato": "Bot Delta",
        "hint": "Fills holes at fair",
        "ceil_min": 0.95,
        "ceil_max": 1.05,
        "jump_mult": 1.00,
        "min_jump": None,
        "luxury_mult": 0.50,
    },
    {
        "id": "sniper",
        "name": "The Sniper",
        "nato": "Bot Echo",
        "hint": "Waits, then jumps",
        "ceil_min": 0.82,
        "ceil_max": 1.08,
        "jump_mult": 1.35,
        "min_jump": 4.0,
        "luxury_mult": 0.65,
    },
    {
        "id": "accountant",
        "name": "The Accountant",
        "nato": "Bot Foxtrot",
        "hint": "Spends leftover cap",
        "ceil_min": 0.90,
        "ceil_max": 1.08,
        "jump_mult": 1.05,
        "min_jump": None,
        "luxury_mult": 0.95,
    },
    {
        "id": "gambler",
        "name": "The Gambler",
        "nato": "Bot Golf",
        "hint": "Wide range, big swings",
        "ceil_min": 0.70,
        "ceil_max": 1.25,
        "jump_mult": 1.25,
        "min_jump": 3.0,
        "luxury_mult": 0.80,
    },
    {
        "id": "patriot",
        "name": "The Patriot",
        "nato": "Bot Hotel",
        "hint": "Pays up for stars",
        "ceil_min": 0.92,
        "ceil_max": 1.18,
        "jump_mult": 1.15,
        "min_jump": None,
        "luxury_mult": 0.70,
    },
    {
        "id": "copier",
        "name": "The Copier",
        "nato": "Bot India",
        "hint": "Bids the minimum raise",
        "ceil_min": 0.85,
        "ceil_max": 1.05,
        "jump_mult": 0.35,
        "min_jump": None,
        "luxury_mult": 0.60,
    },
    {
        "id": "closer",
        "name": "The Closer",
        "nato": "Bot Juliet",
        "hint": "Aggressive late",
        "ceil_min": 0.95,
        "ceil_max": 1.16,
        "jump_mult": 1.30,
        "min_jump": 5.0,
        "luxury_mult": 0.85,
    },
    {
        "id": "miser",
        "name": "The Miser",
        "nato": "Bot Kilo",
        "hint": "Cheapest possible",
        "ceil_min": 0.70,
        "ceil_max": 0.84,
        "jump_mult": 0.60,
        "min_jump": None,
        "luxury_mult": 0.45,
    },
]

BOT_NAMES = [p["name"] for p in BOT_PERSONAS]

_NATO_RE = re.compile(
    r"^bot\s+(alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo)$",
    re.IGNORECASE,
)
_BY_KEY = {
    str(p["id"]).lower(): p
    for p in BOT_PERSONAS
}
for _p in BOT_PERSONAS:
    _BY_KEY[str(_p["name"]).lower()] = _p
    _BY_KEY[str(_p["nato"]).lower()] = _p


def looks_like_nato_bot_name(name: str | None) -> bool:
    return bool(_NATO_RE.match(str(name or "").strip()))


def resolve_bot_persona(team: dict[str, Any] | None) -> dict[str, Any] | None:
    if not team:
        return None
    name = str(team.get("name") or team.get("team_name") or "").strip()
    keyed = _BY_KEY.get(name.lower())
    if keyed:
        return keyed
    if not team.get("is_bot") and not looks_like_nato_bot_name(name):
        return None
    seed = str(team.get("id") or team.get("team_id") or name or "bot")
    idx = zlib.crc32(seed.encode()) % len(BOT_PERSONAS)
    return BOT_PERSONAS[idx]


def display_bot_name(team: dict[str, Any] | None, fallback: str | None = None) -> str:
    persona = resolve_bot_persona(team)
    if persona:
        return str(persona["name"])
    return str(fallback or (team or {}).get("name") or "")


def persona_ceiling_mult(
    persona: dict[str, Any] | None,
    *,
    seed: int,
    luxury: bool = False,
    fair: float = 0.0,
) -> float:
    row = persona or BOT_PERSONAS[0]
    lo = float(row["ceil_min"])
    hi = float(row["ceil_max"])
    base = lo + (hi - lo) * (seed / 999.0)
    if luxury:
        base = min(base, float(row["luxury_mult"]))
    if row["id"] == "patriot" and fair >= 25 and not luxury:
        base = min(1.25, base + 0.08)
    return max(0.4, base)


def persona_jump(
    persona: dict[str, Any] | None,
    *,
    high: float,
    ceiling: float,
    step: float,
) -> float | None:
    """Next bid using the live 35% gap jump, scaled by personality."""
    if step <= 0:
        return None
    nxt = high + step
    if nxt > ceiling + 1e-9:
        return None
    gap = ceiling - high
    if gap <= step + 1e-9:
        return round(min(ceiling, nxt), 2)
    row = persona or {}
    jump_mult = float(row.get("jump_mult") or 1.0)
    min_jump = row.get("min_jump")
    raw = max(step * 2.0, round(gap * 0.35 * jump_mult / step) * step)
    if min_jump:
        raw = max(raw, float(min_jump))
    # Copier stays on the minimum raise unless a min_jump was set.
    if row.get("id") == "copier":
        raw = step
    return round(min(ceiling, high + max(step, raw)), 2)
