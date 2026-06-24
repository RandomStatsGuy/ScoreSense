"""Trade partner matching and package suggestions."""

from __future__ import annotations

from itertools import combinations
from typing import Any

from src.draft_hub.auction_values import build_player_values, fair_value_for_row
from src.draft_hub.league_analytics import build_league_analytics
from src.draft_hub.pre_draft_cap import is_active_for_pre_draft
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules


def _team_roster_map(overview: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for block in overview.get("teams") or []:
        tid = str((block.get("team") or {}).get("id") or "")
        rows = [r for r in (block.get("roster") or []) if is_active_for_pre_draft(r)]
        out[tid] = rows
    return out


def _balance_flags(
    team_analytics: dict[str, Any],
    league_avg: dict[str, Any],
    positions: list[str],
) -> dict[str, Any]:
    """Classify each position as surplus or need — never both."""
    surplus: list[str] = []
    need: list[str] = []
    avg_spend = league_avg.get("spend_by_position") or {}
    avg_count = league_avg.get("count_by_position") or {}
    spend = team_analytics.get("spend_by_position") or {}
    counts = team_analytics.get("count_by_position") or {}

    for pos in positions:
        cs = float(counts.get(pos) or 0)
        ac = float(avg_count.get(pos) or 0)
        ss = float(spend.get(pos) or 0)
        av = float(avg_spend.get(pos) or 0)

        score = 0
        if cs >= ac + 1.0:
            score += 2
        if av > 0 and ss >= av * 1.12:
            score += 1
        if cs <= max(ac - 0.8, 0):
            score -= 2
        if av > 0 and ss <= av * 0.85:
            score -= 1

        if score > 0:
            surplus.append(pos)
        elif score < 0:
            need.append(pos)
    return {"surplus": surplus, "need": need}


def _player_fair_values(
    roster: list[dict[str, Any]],
    pool,
    rules: LeagueRules,
    team_count: int,
) -> dict[str, float]:
    values = build_player_values(pool, rules, team_count=team_count)
    out: dict[str, float] = {}
    for row in roster:
        pid = str(row.get("player_id") or "")
        if not pid:
            continue
        fv = values.get(pid, {}).get("fair_value")
        if fv is None:
            fv = fair_value_for_row(row, pool, rules, team_count=team_count)
        if fv is not None:
            out[pid] = float(fv)
    return out


def _trade_value(row: dict[str, Any], fair_map: dict[str, float]) -> float:
    """Blend contract salary with projection fair value for trade balancing."""
    pid = str(row.get("player_id") or "")
    salary = float(row.get("salary") or 0)
    fair = fair_map.get(pid)
    if fair is None or fair <= 0:
        return max(salary, 1.0)
    if salary > 1:
        return max(fair, salary)
    return fair


def _package_value(players: list[dict[str, Any]], fair_map: dict[str, float]) -> float:
    return round(sum(_trade_value(p, fair_map) for p in players), 2)


def _sort_trade_candidates(
    roster: list[dict[str, Any]],
    fair_map: dict[str, float],
) -> list[dict[str, Any]]:
    """Prefer moving depth pieces (lower trade value) before core players."""
    return sorted(
        roster,
        key=lambda r: (_trade_value(r, fair_map), str(r.get("player_name") or "")),
    )


def _valid_trade_package(
    my_pack: tuple[dict[str, Any], ...],
    their_pack: tuple[dict[str, Any], ...],
    *,
    my_surplus: set[str],
    my_need: set[str],
    their_surplus: set[str],
) -> bool:
    my_positions = {normalize_position(p.get("position")) for p in my_pack}
    their_positions = {normalize_position(p.get("position")) for p in their_pack}

    if not my_positions <= my_surplus:
        return False
    if not their_positions <= their_surplus:
        return False
    if not (their_positions & my_need):
        return False
    if my_positions & my_need:
        return False
    if my_positions == their_positions and (my_positions & my_need):
        return False
    return True


def _player_payload(row: dict[str, Any], fair_map: dict[str, float]) -> dict[str, Any]:
    pid = str(row.get("player_id") or "")
    return {
        "player_id": row.get("player_id"),
        "player_name": row.get("player_name"),
        "position": row.get("position"),
        "salary": float(row.get("salary") or 0),
        "fair_value": fair_map.get(pid),
        "trade_value": _trade_value(row, fair_map),
    }


def _suggest_trades(
    my_id: str,
    partner_id: str,
    my_roster: list[dict[str, Any]],
    partner_roster: list[dict[str, Any]],
    my_balance: dict[str, Any],
    partner_balance: dict[str, Any],
    fair_map: dict[str, float],
    *,
    partner_name: str,
) -> list[dict[str, Any]]:
    my_surplus = set(my_balance.get("surplus") or [])
    my_need = set(my_balance.get("need") or [])
    their_surplus = set(partner_balance.get("surplus") or [])
    receive_positions = their_surplus & my_need

    if not my_surplus or not receive_positions:
        return []

    my_offer_pool = _sort_trade_candidates(
        [r for r in my_roster if normalize_position(r.get("position")) in my_surplus],
        fair_map,
    )[:8]
    their_offer_pool = _sort_trade_candidates(
        [r for r in partner_roster if normalize_position(r.get("position")) in receive_positions],
        fair_map,
    )[:8]

    if not my_offer_pool or not their_offer_pool:
        return []

    suggestions: list[dict[str, Any]] = []
    seen: set[tuple] = set()
    used_primary_send: set[str] = set()

    for size in (1, 2):
        for my_pack in combinations(my_offer_pool, size):
            for their_pack in combinations(their_offer_pool, size):
                if not _valid_trade_package(
                    my_pack,
                    their_pack,
                    my_surplus=my_surplus,
                    my_need=my_need,
                    their_surplus=their_surplus,
                ):
                    continue

                my_val = _package_value(list(my_pack), fair_map)
                their_val = _package_value(list(their_pack), fair_map)
                if my_val <= 0 or their_val <= 0:
                    continue
                ratio = my_val / their_val
                if ratio < 0.75 or ratio > 1.33:
                    continue

                key = (
                    tuple(sorted(p["player_id"] for p in my_pack)),
                    tuple(sorted(p["player_id"] for p in their_pack)),
                )
                if key in seen:
                    continue
                seen.add(key)

                primary_send = str(my_pack[0].get("player_id") or "")
                if primary_send in used_primary_send:
                    continue
                used_primary_send.add(primary_send)

                suggestions.append(
                    {
                        "partner_team_id": partner_id,
                        "partner_team_name": partner_name,
                        "send": [_player_payload(p, fair_map) for p in my_pack],
                        "receive": [_player_payload(p, fair_map) for p in their_pack],
                        "send_total_fair": my_val,
                        "receive_total_fair": their_val,
                        "rationale": _rationale(my_balance, partner_balance, my_pack, their_pack),
                    }
                )
                if len(suggestions) >= 3:
                    return suggestions
    return suggestions


def _rationale(my_bal, partner_bal, my_pack, their_pack) -> str:
    my_pos = {normalize_position(p.get("position")) for p in my_pack}
    their_pos = {normalize_position(p.get("position")) for p in their_pack}
    parts = []
    overlap = set(partner_bal.get("surplus") or []) & set(my_bal.get("need") or [])
    if overlap:
        got = ", ".join(sorted(their_pos & overlap))
        parts.append(f"They have extra {', '.join(sorted(overlap))} — you get {got}")
    my_overlap = set(my_bal.get("surplus") or []) & set(partner_bal.get("need") or [])
    if my_overlap:
        sent = ", ".join(sorted(my_pos & my_overlap))
        parts.append(f"You have extra {', '.join(sorted(my_overlap))} — send {sent}")
    parts.append(f"Swap {', '.join(sorted(my_pos))} for {', '.join(sorted(their_pos))}")
    return ". ".join(parts)


def build_trade_insights(
    overview: dict[str, Any],
    *,
    my_team_id: str,
    season: int,
    draft_completed: bool = False,
    pool: Any | None = None,
) -> dict[str, Any]:
    league = overview.get("league") or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    team_count = int(league.get("team_count") or 12)
    analytics = build_league_analytics(overview, draft_completed=draft_completed)
    team_by_id = {t["team_id"]: t for t in analytics.get("teams") or []}
    my_analytics = team_by_id.get(my_team_id)
    if not my_analytics:
        return {"my_team_id": my_team_id, "balance": {}, "partners": [], "suggestions": []}

    league_avg = analytics.get("league_avg") or {}
    positions = analytics.get("positions") or []
    my_balance = _balance_flags(my_analytics, league_avg, positions)
    roster_map = _team_roster_map(overview)
    my_roster = roster_map.get(my_team_id, [])
    if pool is None:
        from src.draft_hub.value_sheet import _load_draft_pool

        pool = _load_draft_pool(season)
    all_rosters = [r for rows in roster_map.values() for r in rows]
    fair_map = _player_fair_values(all_rosters, pool, rules, team_count)

    partners: list[dict[str, Any]] = []
    all_suggestions: list[dict[str, Any]] = []

    for block in overview.get("teams") or []:
        team = block.get("team") or {}
        tid = str(team.get("id") or "")
        if tid == my_team_id:
            continue
        ta = team_by_id.get(tid)
        if not ta:
            continue
        pb = _balance_flags(ta, league_avg, positions)
        score = _partner_score(my_balance, pb, ta)
        if score <= 0:
            continue
        partners.append(
            {
                "team_id": tid,
                "team_name": team.get("name"),
                "fit_score": round(score, 2),
                "their_surplus": pb.get("surplus") or [],
                "their_need": pb.get("need") or [],
                "cap_remaining": ta.get("unspent"),
            }
        )

    partners.sort(key=lambda x: -x["fit_score"])
    top_partners = partners[:5]

    for p in top_partners[:3]:
        tid = p["team_id"]
        ta = team_by_id.get(tid) or {}
        pb = _balance_flags(ta, league_avg, positions)
        all_suggestions.extend(
            _suggest_trades(
                my_team_id,
                tid,
                my_roster,
                roster_map.get(tid, []),
                my_balance,
                pb,
                fair_map,
                partner_name=p.get("team_name") or "Partner",
            )
        )

    return {
        "my_team_id": my_team_id,
        "balance": my_balance,
        "partners": top_partners,
        "suggestions": all_suggestions[:12],
    }


def _partner_score(my_balance: dict, their_balance: dict, their_analytics: dict) -> float:
    score = 0.0
    for pos in my_balance.get("need") or []:
        if pos in (their_balance.get("surplus") or []):
            score += 3.0
    for pos in my_balance.get("surplus") or []:
        if pos in (their_balance.get("need") or []):
            score += 2.5
    score += min(float(their_analytics.get("unspent") or 0) / 40.0, 2.0)
    return score
