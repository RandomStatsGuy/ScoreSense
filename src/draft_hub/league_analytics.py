"""League-wide cap spend analytics."""

from __future__ import annotations

from typing import Any

from src.draft_hub.k_def_pool_cache import analytics_positions
from src.draft_hub.pre_draft_cap import is_active_for_pre_draft, total_pre_draft_dead_cap
from src.draft_hub.rules_engine import cap_relevant_roster, normalize_position
from src.draft_hub.schemas import LeagueRules


def _active_roster(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in rows if is_active_for_pre_draft(r)]


def build_league_analytics(
    overview: dict[str, Any],
    *,
    draft_completed: bool = False,
) -> dict[str, Any]:
    """Spend breakdown per team and league averages."""
    league = overview.get("league") or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    positions = analytics_positions(rules)
    cap = float(overview.get("salary_cap") or rules.salary_cap)
    teams_out: list[dict[str, Any]] = []
    all_spend: dict[str, list[float]] = {p: [] for p in positions}
    all_counts: dict[str, list[int]] = {p: [] for p in positions}

    for block in overview.get("teams") or []:
        team = block.get("team") or {}
        roster = block.get("roster") or []
        active = _active_roster(cap_relevant_roster(rules, roster))
        spend = {p: 0.0 for p in positions}
        counts = {p: 0 for p in positions}
        for row in active:
            pos = normalize_position(row.get("position"))
            if pos not in spend:
                continue
            sal = float(row.get("salary") or 0)
            spend[pos] += sal
            counts[pos] += 1

        committed = round(sum(spend.values()), 2)
        dead_cap = 0.0 if draft_completed else total_pre_draft_dead_cap(rules, roster, year_offset=0)
        unspent = round(max(0.0, cap - committed - dead_cap), 2)
        pct = {p: round((spend[p] / cap) * 100, 1) if cap else 0.0 for p in positions}
        pct_unspent = round((unspent / cap) * 100, 1) if cap else 0.0
        pct_dead = round((dead_cap / cap) * 100, 1) if cap and dead_cap else 0.0

        for p in positions:
            all_spend[p].append(spend[p])
            all_counts[p].append(counts[p])

        teams_out.append(
            {
                "team_id": team.get("id"),
                "team_name": team.get("name"),
                "spend_by_position": {p: round(spend[p], 2) for p in positions},
                "count_by_position": counts,
                "pct_by_position": pct,
                "committed": committed,
                "dead_cap": dead_cap,
                "unspent": unspent,
                "pct_unspent": pct_unspent,
                "pct_dead_cap": pct_dead,
                "player_count": len(active),
            }
        )

    n_teams = max(len(teams_out), 1)
    league_avg = {
        "spend_by_position": {
            p: round(sum(all_spend[p]) / n_teams, 2) for p in positions
        },
        "count_by_position": {
            p: round(sum(all_counts[p]) / n_teams, 2) for p in positions
        },
    }

    return {
        "salary_cap": cap,
        "team_count": n_teams,
        "positions": list(positions),
        "teams": teams_out,
        "league_avg": league_avg,
        "draft_completed": draft_completed,
    }
