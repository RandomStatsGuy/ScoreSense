"""Trade partner matching and package suggestions."""

from __future__ import annotations

from itertools import combinations
from typing import Any

from src.draft_hub.auction_values import build_player_values, fair_value_for_row
from src.draft_hub.league_analytics import build_league_analytics
from src.draft_hub.pre_draft_cap import is_active_for_pre_draft
from src.draft_hub.rules_engine import normalize_position, roster_limits
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
    rules: LeagueRules,
) -> dict[str, Any]:
    """Classify each position as surplus or need — roster mins first, then depth vs league."""
    surplus: list[str] = []
    need: list[str] = []
    limits = roster_limits(rules)
    avg_spend = league_avg.get("spend_by_position") or {}
    avg_count = league_avg.get("count_by_position") or {}
    spend = team_analytics.get("spend_by_position") or {}
    counts = team_analytics.get("count_by_position") or {}

    for pos in positions:
        pos_key = pos.lower()
        lim = limits.get(pos_key) or {}
        min_n = int(lim.get("min") or 0)
        max_n = int(lim.get("max") or 99)
        cs = int(counts.get(pos) or 0)
        ac = float(avg_count.get(pos) or 0)
        ss = float(spend.get(pos) or 0)
        av = float(avg_spend.get(pos) or 0)

        if min_n > 0 and cs < min_n:
            need.append(pos)
            continue

        depth_floor = min_n + 2 if min_n > 0 else max(2, int(ac + 1))
        if max_n < 99 and cs > max_n:
            surplus.append(pos)
            continue
        if cs >= depth_floor:
            surplus.append(pos)
            continue
        if min_n > 0 and cs == min_n and av > 0 and ss < av * 0.72:
            need.append(pos)
            continue
        if ac > 0 and cs <= max(min_n, ac - 1.2) and ss <= av * 0.88:
            need.append(pos)
            continue
        if av > 0 and cs >= ac + 1.2 and ss >= av * 1.1:
            surplus.append(pos)

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
        if fv is not None and float(fv) > 0:
            out[pid] = float(fv)
    return out


def _salary_is_placeholder(salary: float) -> bool:
    return salary <= 1.0


def _trade_value(row: dict[str, Any], fair_map: dict[str, float]) -> float:
    """Blend contract salary with projection fair value for trade balancing."""
    pid = str(row.get("player_id") or "")
    salary = float(row.get("salary") or 0)
    fair = fair_map.get(pid)
    if fair is not None and fair > 0:
        if salary > 1:
            return round(max(fair, salary * 0.55 + fair * 0.45), 2)
        return round(fair, 2)
    if salary > 1:
        return round(salary, 2)
    return 1.0


def _package_value(players: list[dict[str, Any]], fair_map: dict[str, float]) -> float:
    return round(sum(_trade_value(p, fair_map) for p in players), 2)


def _value_ratio_ok(
    my_pack: tuple[dict[str, Any], ...],
    their_pack: tuple[dict[str, Any], ...],
    fair_map: dict[str, float],
) -> bool:
    my_val = _package_value(list(my_pack), fair_map)
    their_val = _package_value(list(their_pack), fair_map)
    if my_val <= 0 or their_val <= 0:
        return False
    ratio = my_val / their_val
    loose = any(
        _salary_is_placeholder(float(p.get("salary") or 0))
        for p in (*my_pack, *their_pack)
    )
    lo, hi = (0.62, 1.62) if loose else (0.78, 1.28)
    return lo <= ratio <= hi


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
    their_need: set[str],
) -> bool:
    my_positions = {normalize_position(p.get("position")) for p in my_pack}
    their_positions = {normalize_position(p.get("position")) for p in their_pack}

    if not my_positions or not their_positions:
        return False
    if not my_positions <= my_surplus:
        return False
    if not their_positions <= their_surplus:
        return False
    if not (their_positions & my_need):
        return False
    if my_positions & my_need:
        return False
    if not (my_positions & their_need):
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
    their_need = set(partner_balance.get("need") or [])
    receive_positions = their_surplus & my_need
    send_positions = my_surplus & their_need

    if not send_positions or not receive_positions:
        return []

    my_offer_pool = _sort_trade_candidates(
        [r for r in my_roster if normalize_position(r.get("position")) in send_positions],
        fair_map,
    )[:10]
    their_offer_pool = _sort_trade_candidates(
        [r for r in partner_roster if normalize_position(r.get("position")) in receive_positions],
        fair_map,
    )[:10]

    if not my_offer_pool or not their_offer_pool:
        return []

    suggestions: list[dict[str, Any]] = []
    seen: set[tuple] = set()

    for my_size, their_size in ((1, 1), (1, 2), (2, 1)):
        for my_pack in combinations(my_offer_pool, my_size):
            for their_pack in combinations(their_offer_pool, their_size):
                if not _valid_trade_package(
                    my_pack,
                    their_pack,
                    my_surplus=my_surplus,
                    my_need=my_need,
                    their_surplus=their_surplus,
                    their_need=their_need,
                ):
                    continue
                if not _value_ratio_ok(my_pack, their_pack, fair_map):
                    continue

                key = (
                    tuple(sorted(str(p.get("player_id")) for p in my_pack)),
                    tuple(sorted(str(p.get("player_id")) for p in their_pack)),
                )
                if key in seen:
                    continue
                seen.add(key)

                my_val = _package_value(list(my_pack), fair_map)
                their_val = _package_value(list(their_pack), fair_map)
                their_positions = {normalize_position(p.get("position")) for p in their_pack}
                my_positions = {normalize_position(p.get("position")) for p in my_pack}
                suggestions.append(
                    {
                        "partner_team_id": partner_id,
                        "partner_team_name": partner_name,
                        "send": [_player_payload(p, fair_map) for p in my_pack],
                        "receive": [_player_payload(p, fair_map) for p in their_pack],
                        "send_total_fair": my_val,
                        "receive_total_fair": their_val,
                        "fills_needs": sorted(their_positions),
                        "moves_surplus": sorted(my_positions),
                        "rationale": _rationale(
                            my_balance,
                            partner_balance,
                            my_pack,
                            their_pack,
                            partner_name,
                        ),
                    }
                )

    suggestions.sort(
        key=lambda s: (
            -len(s.get("fills_needs") or []),
            abs(float(s.get("send_total_fair") or 0) - float(s.get("receive_total_fair") or 0)),
        ),
    )
    return suggestions[:3]


def _rationale(
    my_bal: dict[str, Any],
    partner_bal: dict[str, Any],
    my_pack: tuple[dict[str, Any], ...],
    their_pack: tuple[dict[str, Any], ...],
    partner_name: str,
) -> str:
    my_pos = {normalize_position(p.get("position")) for p in my_pack}
    their_pos = {normalize_position(p.get("position")) for p in their_pack}
    my_need = set(my_bal.get("need") or [])
    their_need = set(partner_bal.get("need") or [])

    recv_need = ", ".join(sorted(their_pos & my_need)) or ", ".join(sorted(their_pos))
    send_fill = ", ".join(sorted(my_pos & their_need)) or ", ".join(sorted(my_pos))
    send_names = ", ".join(str(p.get("player_name") or "?") for p in my_pack)
    recv_names = ", ".join(str(p.get("player_name") or "?") for p in their_pack)

    return (
        f"With {partner_name}: you need {recv_need} — get {recv_names}. "
        f"They need {send_fill} — send {send_names}."
    )


def _actionable_needs(my_balance: dict[str, Any], partners: list[dict[str, Any]]) -> list[str]:
    my_need = set(my_balance.get("need") or [])
    partner_surplus: set[str] = set()
    for p in partners:
        partner_surplus.update(p.get("their_surplus") or [])
    return sorted(my_need & partner_surplus)


def _empty_reason(
    my_balance: dict[str, Any],
    partners: list[dict[str, Any]],
    suggestions: list[dict[str, Any]],
    *,
    my_team_id: str,
) -> str | None:
    if not my_team_id:
        return "Select your team in Setup so trade ideas know which roster is yours."
    if not (my_balance.get("need") or []):
        return "No roster gaps detected — every position meets league minimums with reasonable depth."
    if not (my_balance.get("surplus") or []):
        return "No tradeable surplus — add depth or import salaries to see movable pieces."
    if not partners:
        return "No partners with complementary needs yet — other teams may not have surplus where you have gaps."
    if not suggestions:
        return (
            "Partners match on paper, but no balanced 1-for-1 or 2-for-1 packages cleared value checks. "
            "Import missing salaries or refresh projections for better matches."
        )
    return None


def build_trade_insights(
    overview: dict[str, Any],
    *,
    my_team_id: str,
    season: int,
    draft_completed: bool = False,
    pool: Any | None = None,
    analytics: dict[str, Any] | None = None,
    fair_map: dict[str, float] | None = None,
) -> dict[str, Any]:
    league = overview.get("league") or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    team_count = int(league.get("team_count") or 12)
    if analytics is None:
        analytics = build_league_analytics(overview, draft_completed=draft_completed)
    team_by_id = {t["team_id"]: t for t in analytics.get("teams") or []}
    my_analytics = team_by_id.get(my_team_id)
    if not my_analytics:
        return {
            "my_team_id": my_team_id,
            "balance": {},
            "actionable_needs": [],
            "partners": [],
            "suggestions": [],
            "empty_reason": _empty_reason({}, [], [], my_team_id=my_team_id),
        }

    league_avg = analytics.get("league_avg") or {}
    positions = analytics.get("positions") or []
    my_balance = _balance_flags(my_analytics, league_avg, positions, rules)
    roster_map = _team_roster_map(overview)
    my_roster = roster_map.get(my_team_id, [])
    if fair_map is None:
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
        pb = _balance_flags(ta, league_avg, positions, rules)
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

    for p in partners[:5]:
        tid = p["team_id"]
        pb = _balance_flags(team_by_id.get(tid) or {}, league_avg, positions, rules)
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

    all_suggestions.sort(
        key=lambda s: (
            -next((pp["fit_score"] for pp in partners if pp["team_id"] == s["partner_team_id"]), 0),
            abs(float(s.get("send_total_fair") or 0) - float(s.get("receive_total_fair") or 0)),
        ),
    )
    actionable = _actionable_needs(my_balance, partners)
    suggestions = all_suggestions[:12]

    return {
        "my_team_id": my_team_id,
        "balance": my_balance,
        "actionable_needs": actionable,
        "partners": partners[:8],
        "suggestions": suggestions,
        "empty_reason": _empty_reason(my_balance, partners, suggestions, my_team_id=my_team_id),
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
