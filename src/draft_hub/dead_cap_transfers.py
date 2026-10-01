"""Split existing cut obligations while preserving their source and transfer path."""
from __future__ import annotations

import copy
import math
from typing import Any

from src.draft_hub.pre_draft_cap import pre_draft_cut_dead_cap_at_offset
from src.draft_hub.schemas import LeagueRules


def obligation_sources(row: dict[str, Any], rules: LeagueRules, season: int) -> list[dict[str, Any]]:
    contract = row.get("contract") or {}
    if "dead_cap_sources" in contract:
        return copy.deepcopy(contract["dead_cap_sources"])
    return [{"origin_slot_id": row["id"], "origin_team_id": row["team_id"],
             "player_id": row["player_id"], "player_name": row.get("player_name"),
             "season": season, "amount": pre_draft_cut_dead_cap_at_offset(rules, row),
             "history": []}]


def transfer_obligation(rows: list[dict[str, Any]], leg: dict[str, Any], *,
                        from_team_id: str, rules: LeagueRules, season: int,
                        proposal_id: str | None = None) -> dict[str, Any]:
    """Mutate a roster snapshot; source slot ids distinguish cuts from active players."""
    source = next((r for r in rows if r.get("id") == leg["roster_slot_id"]
                   and r.get("team_id") == from_team_id
                   and r.get("roster_status") == "cut_before_draft"), None)
    if not source or str(source["player_id"]) != str(leg["player_id"]):
        raise ValueError("Dead-cap obligation is no longer on the sending team")
    amount = float(leg["amount"])
    if not math.isfinite(amount) or amount <= 0 or int(amount) != amount:
        raise ValueError("Dead-cap transfers need a positive whole-dollar amount")
    available = pre_draft_cut_dead_cap_at_offset(rules, source)
    if amount > available + 0.001:
        raise ValueError(f"Cannot transfer ${amount:g}; only ${available:g} dead cap remains")
    sources = obligation_sources(source, rules, season)
    remaining, moved = [], []
    needed = amount
    for item in sources:
        take = min(float(item["amount"]), needed)
        if take > 0:
            part = copy.deepcopy(item)
            part["amount"] = round(take, 2)
            part["history"] = [*part.get("history", []), {
                "from_team_id": from_team_id, "to_team_id": leg["to_team_id"],
                "amount": round(take, 2), "season": season, "proposal_id": proposal_id,
            }]
            moved.append(part)
            needed = round(needed - take, 2)
        rest = round(float(item["amount"]) - take, 2)
        if rest > 0:
            remaining.append({**item, "amount": rest})
    if needed > 0.001:
        raise ValueError("Dead-cap provenance does not match the remaining obligation")
    source["contract"] = {**(source.get("contract") or {}),
                          "dead_cap_amount": round(available - amount, 2), "dead_cap_sources": remaining,
                          "dead_cap_transferred": True}
    target = next((r for r in rows if r.get("team_id") == leg["to_team_id"]
                   and r.get("player_id") == source["player_id"]
                   and r.get("roster_status") == "cut_before_draft"), None)
    if target:
        prior_amount = pre_draft_cut_dead_cap_at_offset(rules, target)
        prior_sources = obligation_sources(target, rules, season)
    else:
        target = copy.deepcopy(source)
        target["id"] = -1 - len(rows)
        target["team_id"] = leg["to_team_id"]
        rows.append(target)
        prior_amount, prior_sources = 0, []
    target["contract"] = {**(target.get("contract") or {}),
                          "dead_cap_amount": round(prior_amount + amount, 2),
                          "dead_cap_transferred": True,
                          "dead_cap_sources": [*prior_sources, *moved]}
    return {**leg, "from_team_id": from_team_id, "sources": moved}
