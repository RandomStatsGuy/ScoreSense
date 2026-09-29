"""Bounded complete-lineup comparisons using the declared legacy objective."""
from __future__ import annotations

from time import monotonic

MAX_CAPTAINS = 60
TIME_BUDGET_SECONDS = 10.0
PER_SOLVE_SECONDS = 1.0
COMPARISON_VERSION = "captain_projection_comparison_v1"


def comparison_budget():
    return {"version": COMPARISON_VERSION, "max_captains": MAX_CAPTAINS,
            "total_seconds": TIME_BUDGET_SECONDS, "per_solve_seconds": PER_SOLVE_SECONDS,
            "mip_rel_gap": 0.0}


def compare_captains(players, *, site, options, snapshot_id):
    from src.products.lineup_optimizer import optimize_lineup, _objective_value, _captain_salary
    from src.products.dfs_validation import validate_generated_lineups

    started = monotonic()
    rows = []
    locked = options.get("locked_captain_id")
    excluded = options.get("excluded_captain_ids") or set()
    eligible = [p for p in players if (not locked or p.player_id == locked) and p.player_id not in excluded]
    for player in sorted(eligible, key=lambda p: p.player_id):
        row = {"captain_id": player.player_id, "captain_name": player.name}
        remaining = TIME_BUDGET_SECONDS - (monotonic() - started)
        if len(eligible) > MAX_CAPTAINS or remaining <= 0:
            rows.append({**row, "status": "not_evaluated", "reason": "comparison_budget"})
            continue
        solve_options = {**options, "locked_captain_id": player.player_id,
                         "solver_time_limit": min(PER_SOLVE_SECONDS, remaining)}
        result = optimize_lineup(players, **solve_options)
        if not result.get("ok"):
            rows.append({**row, "status": "infeasible" if result.get("solver_status") == 2 else "unresolved",
                         "solver_status": result.get("solver_status"), "reason": result.get("error")})
            continue
        result = validate_generated_lineups(
            result, players, site=site, salary_cap=options.get("salary_cap"),
            min_salary=options.get("min_salary"), max_per_team=options.get("max_per_team"),
            locked_player_ids=options.get("locked_player_ids") or (), locked_captain_id=player.player_id)
        if not result["ok"]:
            rows.append({**row, "status": "invalid", "validation": result["validation"]})
            continue
        by_id = {p.player_id: p for p in players}
        score = 0.0
        for slot in result["lineup"]:
            p = by_id[slot["player_id"]]
            captain = p.player_id == player.player_id
            if captain and options["objective"] == "value":
                salary = _captain_salary(p, options["captain_salary_multiplier"])
                value = p.proj * options["captain_multiplier"] / salary * 1000 if salary > 0 else 0
            else:
                value = _objective_value(p, options["objective"]) * (options["captain_multiplier"] if captain else 1)
            score += value
        rows.append({**row, "status": "optimal", "objective_score": score, "result": result})
    valid = sorted((row for row in rows if row["status"] == "optimal"),
                   key=lambda row: (-row["objective_score"], row["captain_id"]))
    for row in valid:
        row["gap_from_best_evaluated"] = max(0.0, valid[0]["objective_score"] - row["objective_score"])
    return {
        "snapshot_id": snapshot_id, "objective": options["objective"],
        "semantics": "sum_of_player_objective_inputs_not_expected_payout_or_lineup_quantile",
        "scope": "eligible_pool_with_current_locks_not_a_portfolio",
        "complete": all(row["status"] in ("optimal", "infeasible") for row in rows),
        "eligible_captains": len(eligible), "evaluated_captains": sum(row["status"] != "not_evaluated" for row in rows),
        "best_evaluated_captain_id": valid[0]["captain_id"] if valid else None,
        "budget": comparison_budget(),
        "candidates": valid + [row for row in rows if row["status"] != "optimal"],
    }
