"""Human-like bot / autodraft selection for snake and linear pick drafts.

Auction rooms keep need-aware fair-value BPA. Pick drafts used that same
raw-points sort, so QBs (highest season totals) went in round 1 and K/DEF
competed with skill-position starters because league mins were treated as
urgent from pick 1.

This module scores remaining players by value over replacement, delays QB
(in 1QB), K, and DEF the way real drafts do, and fills starters before
bench copies. Superflex / 2QB still take QBs early.
"""

from __future__ import annotations

import math
import zlib
from typing import Any

from src.draft_hub.auction_values import FLEX_POS_SHARE
from src.draft_hub.draft_budgets import open_roster_slots, total_roster_slots
from src.draft_hub.rules_engine import (
    count_at_position,
    normalize_position,
    roster_limits,
    unmet_minimum_positions,
)
from src.draft_hub.schemas import LeagueRules

SKILL_POSITIONS = ("RB", "WR", "TE")
STREAMING_POSITIONS = frozenset({"K", "DEF"})
ARCHETYPES = (
    "balanced",
    "hero_rb",
    "zero_rb",
    "wide_receiver",
    "early_qb",
    "late_qb",
    "te_premium",
)

# 1QB window: elite QBs can come off ~2 rounds earlier than the archetype base.
_QB_BASE_ROUND = {
    "balanced": 4,
    "hero_rb": 6,
    "zero_rb": 5,
    "wide_receiver": 6,
    "early_qb": 3,
    "late_qb": 8,
    "te_premium": 6,
}
_POS_BIAS = {
    "balanced": {"QB": 1.0, "RB": 1.0, "WR": 1.0, "TE": 1.0},
    "hero_rb": {"QB": 0.92, "RB": 1.18, "WR": 0.96, "TE": 0.95},
    "zero_rb": {"QB": 1.0, "RB": 0.78, "WR": 1.14, "TE": 1.08},
    "wide_receiver": {"QB": 0.95, "RB": 0.94, "WR": 1.16, "TE": 1.0},
    "early_qb": {"QB": 1.12, "RB": 0.98, "WR": 0.98, "TE": 0.95},
    "late_qb": {"QB": 0.82, "RB": 1.04, "WR": 1.04, "TE": 1.0},
    "te_premium": {"QB": 0.95, "RB": 0.97, "WR": 0.97, "TE": 1.28},
}


def archetype_for_team(team_id: str | None) -> str:
    seed = zlib.crc32(str(team_id or "bot").encode())
    return ARCHETYPES[seed % len(ARCHETYPES)]


def is_superflex(rules: LeagueRules) -> bool:
    """True when QB is a featured starter slot (2QB) or FLEX-eligible (SFLEX)."""
    qb_starters = int((roster_limits(rules).get("qb") or {}).get("starter") or 0)
    if qb_starters >= 2:
        return True
    flex = (rules.roster or {}).get("flex") or {}
    if not isinstance(flex, dict) or int(flex.get("starter") or 0) <= 0:
        return False
    eligible = {normalize_position(p) for p in (flex.get("eligible") or [])}
    return "QB" in eligible


def player_projection(row: dict[str, Any]) -> float:
    for key in ("season_p50", "season_proj", "fair_value", "model_bid_hint"):
        try:
            val = float(row.get(key) or 0)
        except (TypeError, ValueError):
            val = 0.0
        if val > 0 and math.isfinite(val):
            return val
    return 0.0


def _flex_rule(rules: LeagueRules) -> tuple[int, frozenset[str]]:
    raw = (rules.roster or {}).get("flex") or {}
    if not isinstance(raw, dict):
        return 0, frozenset(SKILL_POSITIONS)
    starter = int(raw.get("starter") or 0)
    eligible = raw.get("eligible") or list(SKILL_POSITIONS)
    return starter, frozenset(normalize_position(p) for p in eligible)


def league_drafted_counts(league_id: str, rules: LeagueRules) -> dict[str, int]:
    """How many players at each position are already rostered league-wide."""
    from src.draft_hub import storage
    from src.draft_hub.draft_budgets import occupying_roster

    counts: dict[str, int] = {}
    for roster in storage.list_league_rosters_by_team(league_id).values():
        for row in occupying_roster(rules, roster, draft_completed=False):
            pos = normalize_position(row.get("position"))
            if not pos:
                continue
            counts[pos] = counts.get(pos, 0) + 1
    return counts


def replacement_projections(
    candidates: list[dict[str, Any]],
    rules: LeagueRules,
    team_count: int,
    drafted_counts: dict[str, int] | None = None,
) -> dict[str, float]:
    """Replacement-level season points for each position still on the board.

    ``drafted_counts`` keeps replacement anchored to the original startable
    slot (QB12, RB28, ...) so leftover RBs don't inflate VORP as the board
    shrinks and push QBs into round 11.
    """
    limits = roster_limits(rules)
    flex_n, flex_eligible = _flex_rule(rules)
    teams = max(int(team_count or 12), 2)
    drafted_counts = drafted_counts or {}
    by_pos: dict[str, list[float]] = {}
    for row in candidates:
        pos = normalize_position(row.get("position"))
        if not pos:
            continue
        by_pos.setdefault(pos, []).append(player_projection(row))

    out: dict[str, float] = {}
    for pos, projs in by_pos.items():
        projs.sort(reverse=True)
        lim = limits.get(pos.lower()) or {}
        starters = int(lim.get("starter") or 0)
        if pos == "QB" and pos in flex_eligible:
            # Superflex: every FLEX can be a QB, so replacement sits near QB2/team.
            flex_add = float(flex_n)
        elif pos in flex_eligible:
            flex_add = float(flex_n) * FLEX_POS_SHARE.get(pos, 0.0)
        else:
            flex_add = 0.0
        n_relevant = max(1, int(round(teams * (starters + flex_add))))
        already = int(drafted_counts.get(pos, 0) or 0)
        slot = max(1, n_relevant - already)
        ranked = list(projs)
        if pos == "QB" and slot > len(ranked):
            drop = 8.0
            if len(ranked) >= 2:
                drop = max(4.0, (ranked[0] - ranked[-1]) / max(len(ranked) - 1, 1))
            while len(ranked) < slot:
                ranked.append(max(0.0, ranked[-1] - drop))
        out[pos] = ranked[min(slot, len(ranked)) - 1]
    return out


def _roster_counts(rules: LeagueRules, roster: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for key in roster_limits(rules):
        pos = key.upper()
        counts[pos] = count_at_position(rules, roster, pos)
    return counts


def _starter_need(pos: str, rules: LeagueRules, counts: dict[str, int]) -> int:
    lim = roster_limits(rules).get(pos.lower()) or {}
    starter = int(lim.get("starter") or 0)
    return max(0, starter - int(counts.get(pos, 0)))


def _flex_still_open(rules: LeagueRules, counts: dict[str, int]) -> int:
    flex_n, flex_eligible = _flex_rule(rules)
    if flex_n <= 0:
        return 0
    extras = 0
    for pos in flex_eligible:
        lim = roster_limits(rules).get(pos.lower()) or {}
        starter = int(lim.get("starter") or 0)
        extras += max(0, int(counts.get(pos, 0)) - starter)
    return max(0, flex_n - extras)


def _draft_round(session: dict[str, Any] | None, rules: LeagueRules) -> int:
    if not session:
        return 1
    from src.draft_hub.pick_draft import pick_clock

    return max(1, int(pick_clock(session, rules).get("round") or 1))


def _elite_ids(candidates: list[dict[str, Any]], position: str, n: int) -> set[str]:
    ranked = [
        row
        for row in candidates
        if normalize_position(row.get("position")) == position
    ]
    ranked.sort(key=player_projection, reverse=True)
    return {str(r.get("player_id")) for r in ranked[: max(0, n)] if r.get("player_id")}


def _qb_open_round(archetype: str, *, elite: bool, depth_rank: int) -> int:
    base = int(_QB_BASE_ROUND.get(archetype, 4))
    if elite:
        return max(2, base - 2)
    if depth_rank >= 6:
        return base + 2
    return base


def _position_rank(candidates: list[dict[str, Any]], row: dict[str, Any]) -> int:
    pos = normalize_position(row.get("position"))
    better = sum(
        1
        for other in candidates
        if normalize_position(other.get("position")) == pos
        and player_projection(other) > player_projection(row)
    )
    return better + 1


def _position_allowed(
    pos: str,
    *,
    row: dict[str, Any],
    round_n: int,
    remaining: int,
    counts: dict[str, int],
    rules: LeagueRules,
    archetype: str,
    superflex: bool,
    elite_qb: bool,
    elite_te: bool,
    candidates: list[dict[str, Any]],
    unmet: set[str],
    total_rounds: int,
) -> bool:
    count = int(counts.get(pos, 0))
    starter_need = _starter_need(pos, rules, counts)
    lim = roster_limits(rules).get(pos.lower()) or {}
    min_n = int(lim.get("min") or 0)

    if remaining <= max(1, len(unmet)) and pos in unmet:
        return True
    if remaining <= len(unmet) and unmet:
        return pos in unmet

    if pos in STREAMING_POSITIONS:
        k_need = max(0, int((roster_limits(rules).get("k") or {}).get("min") or 0) - int(counts.get("K", 0)))
        def_need = max(
            0,
            int((roster_limits(rules).get("def") or {}).get("min") or 0) - int(counts.get("DEF", 0)),
        )
        last_two = round_n >= max(1, total_rounds - 1)
        tight = remaining <= (k_need + def_need + 1)
        return last_two or tight

    if pos == "QB" and not superflex:
        starters = max(1, int(lim.get("starter") or 1))
        if count >= starters + 1:
            return False
        if count >= starters:
            return round_n >= max(11, _QB_BASE_ROUND.get(archetype, 4) + 5) or remaining <= len(unmet) + 1
        open_at = _qb_open_round(
            archetype,
            elite=elite_qb,
            depth_rank=_position_rank(candidates, row),
        )
        if remaining <= starter_need + _flex_still_open(rules, counts) + 2:
            return True
        return round_n >= open_at

    if pos == "TE":
        if starter_need > 0:
            return elite_te or round_n >= 2 or archetype == "te_premium"
        return round_n >= 8 or remaining <= 4

    if pos in ("RB", "WR"):
        if archetype == "zero_rb" and pos == "RB" and count == 0 and round_n <= 3:
            return False
        return True

    if starter_need > 0:
        return True
    if count < min_n:
        return round_n >= 6
    return True


def _need_multiplier(
    pos: str,
    *,
    rules: LeagueRules,
    counts: dict[str, int],
    archetype: str,
    round_n: int,
) -> float:
    count = int(counts.get(pos, 0))
    starter_need = _starter_need(pos, rules, counts)
    flex_open = _flex_still_open(rules, counts)
    flex_n, flex_eligible = _flex_rule(rules)
    bias = float((_POS_BIAS.get(archetype) or {}).get(pos, 1.0))

    if starter_need > 0:
        need = 1.32
        qb_starters = int((roster_limits(rules).get("qb") or {}).get("starter") or 0)
        if pos == "QB" and (qb_starters >= 2 or "QB" in flex_eligible):
            need = 1.42
    elif pos in flex_eligible and flex_open > 0:
        need = 1.16
        if pos == "QB":
            need = 1.28
    else:
        extra = count - int((roster_limits(rules).get(pos.lower()) or {}).get("starter") or 0)
        if flex_n and pos in flex_eligible:
            extra = max(0, extra - 1)
        need = max(0.42, 0.82 - 0.12 * extra)

    if archetype == "hero_rb" and pos == "RB":
        if count == 0 and round_n <= 2:
            need *= 1.12
        elif count >= 1 and round_n <= 5:
            need *= 0.86
    if archetype == "zero_rb" and pos == "RB" and count == 0 and round_n >= 4:
        need *= 1.22
    return need * bias


def _jitter(team_id: str | None, player_id: str | None) -> float:
    seed = zlib.crc32(f"{team_id or 'bot'}:{player_id or ''}".encode()) % 1000
    return 0.93 + 0.14 * (seed / 999.0)


def select_pick_draft_player(
    rules: LeagueRules,
    roster: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    *,
    session: dict[str, Any] | None = None,
    team_id: str | None = None,
    team_count: int = 12,
    drafted_counts: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    """Choose the next snake/linear pick for a bot or autodraft seat."""
    if not candidates:
        return None

    round_n = _draft_round(session, rules)
    remaining = open_roster_slots(rules, roster, draft_completed=False)
    total_rounds = max(1, total_roster_slots(rules))
    counts = _roster_counts(rules, roster)
    unmet = unmet_minimum_positions(rules, roster)
    superflex = is_superflex(rules)
    archetype = archetype_for_team(team_id)
    replacements = replacement_projections(
        candidates, rules, team_count, drafted_counts=drafted_counts
    )
    elite_qb_ids = _elite_ids(candidates, "QB", 3)
    elite_te_ids = _elite_ids(candidates, "TE", 2)

    allowed: list[dict[str, Any]] = []
    for row in candidates:
        pos = normalize_position(row.get("position"))
        pid = str(row.get("player_id") or "")
        if _position_allowed(
            pos,
            row=row,
            round_n=round_n,
            remaining=remaining,
            counts=counts,
            rules=rules,
            archetype=archetype,
            superflex=superflex,
            elite_qb=pid in elite_qb_ids,
            elite_te=pid in elite_te_ids,
            candidates=candidates,
            unmet=unmet,
            total_rounds=total_rounds,
        ):
            allowed.append(row)

    if not allowed:
        allowed = [
            row
            for row in candidates
            if normalize_position(row.get("position")) not in STREAMING_POSITIONS
        ] or list(candidates)

    best: dict[str, Any] | None = None
    best_score = float("-inf")
    for row in allowed:
        pos = normalize_position(row.get("position"))
        proj = player_projection(row)
        vorp = proj - float(replacements.get(pos) or 0.0)
        need = _need_multiplier(
            pos, rules=rules, counts=counts, archetype=archetype, round_n=round_n
        )
        jitter = _jitter(team_id, str(row.get("player_id") or ""))
        hole = 0.0
        starter_need = _starter_need(pos, rules, counts)
        if starter_need > 0 and pos not in STREAMING_POSITIONS:
            if pos != "QB" or superflex or round_n >= _QB_BASE_ROUND.get(archetype, 4) - 1:
                hole = 36.0
            if pos == "QB" and not superflex:
                open_at = int(_QB_BASE_ROUND.get(archetype, 4))
                if round_n >= open_at:
                    hole += 10.0 * (round_n - open_at + 1)
        elif pos in SKILL_POSITIONS and _flex_still_open(rules, counts) > 0:
            hole = 14.0
        if pos in STREAMING_POSITIONS and pos in unmet:
            hole = 70.0
        if pos in unmet and remaining <= len(unmet) + 2:
            hole += 40.0
        score = vorp * need * jitter + hole
        if score > best_score:
            best_score = score
            best = row
    return best
