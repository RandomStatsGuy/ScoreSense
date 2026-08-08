"""Enrich league roster overview with value badges and team stats."""

from __future__ import annotations

from typing import Any

from src.draft_hub.contracts import can_renew, cap_hit
from src.draft_hub.insights_cache import read_fair_values
from src.draft_hub.pre_draft_cap import (
    expires_before_draft,
    is_active_for_pre_draft,
    total_pre_draft_dead_cap,
    years_remaining,
)
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules


def enrich_league_roster_overview(
    overview: dict[str, Any],
    *,
    fair_map: dict[str, float] | None = None,
) -> dict[str, Any]:
    league = overview.get("league") or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    draft_completed = bool(league.get("draft_completed"))
    season = int(league.get("season") or 0)
    league_id = str(league.get("id") or "")
    min_bid = float(getattr(getattr(rules, "auction", None), "min_bid", None) or 1)
    if fair_map is None and league_id and season:
        fair_map = read_fair_values(league_id, season) or {}
    fair_map = fair_map or {}
    cap = float(overview.get("salary_cap") or rules.salary_cap)

    teams_out: list[dict[str, Any]] = []
    for block in overview.get("teams") or []:
        rows = list(block.get("roster") or [])
        enriched_rows: list[dict[str, Any]] = []
        by_pos_spend: dict[str, float] = {}
        by_pos_count: dict[str, int] = {}
        fair_total = 0.0
        fair_sal_pairs = 0
        committed = 0.0

        for row in rows:
            pid = str(row.get("player_id") or "")
            sal = float(cap_hit(row, 0) or row.get("salary") or 0)
            fair = fair_map.get(pid)
            # Depth / min-bid floor is not a real market comp — don't badge Overpay.
            marketable = fair is not None and float(fair) > min_bid
            value_delta = round(sal - fair, 2) if marketable else None
            overpay = bool(marketable and sal > fair * 1.08)
            underpay = bool(marketable and sal < fair * 0.92)
            contract_grade = (
                "bad" if overpay else ("good" if underpay else ("fair" if marketable else None))
            )
            fp_per_dollar = round(fair / sal, 2) if marketable and sal > 0 else None
            active = is_active_for_pre_draft(row)
            if active:
                committed += sal
                pos = normalize_position(row.get("position"))
                by_pos_spend[pos] = by_pos_spend.get(pos, 0.0) + sal
                by_pos_count[pos] = by_pos_count.get(pos, 0) + 1
                if marketable:
                    fair_total += fair
                    fair_sal_pairs += 1

            ctype = None
            contract = row.get("contract") or {}
            if isinstance(contract, dict):
                ctype = contract.get("contract_type")
            expire_chip = None
            if active and expires_before_draft(row, draft_completed=draft_completed):
                ok, _ = can_renew(row, rules)
                expire_chip = "extend" if ok else "fa"

            enriched_rows.append(
                {
                    **row,
                    "fair_value": fair,
                    "value_delta": value_delta,
                    "overpay": overpay,
                    "contract_grade": contract_grade,
                    "fp_per_dollar": fp_per_dollar,
                    "contract_type": ctype,
                    "years_remaining": years_remaining(row),
                    "expire_chip": expire_chip,
                }
            )

        dead = 0.0 if draft_completed else total_pre_draft_dead_cap(rules, rows, year_offset=0)
        unspent = round(cap - committed - dead, 2)
        team_fp_per_dollar = (
            round(fair_total / committed, 2) if committed > 0 and fair_sal_pairs else None
        )
        teams_out.append(
            {
                **block,
                "roster": enriched_rows,
                "stats": {
                    "committed": round(committed, 2),
                    "dead_cap": round(dead, 2),
                    "unspent": unspent,
                    "by_position_spend": {k: round(v, 2) for k, v in sorted(by_pos_spend.items())},
                    "by_position_count": by_pos_count,
                    "fp_per_dollar": team_fp_per_dollar,
                    "fair_value_total": round(fair_total, 2),
                },
            }
        )

    return {**overview, "teams": teams_out}
