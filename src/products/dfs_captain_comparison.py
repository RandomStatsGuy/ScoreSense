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
    from src.products.lineup_optimizer import optimize_lineup
    from src.products.dfs_validation import validate_generated_lineups
    from src.products.dfs_showdown_integrity import score_lineup, audit_showdown_lineup

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
            locked_player_ids=options.get("locked_player_ids") or (), locked_captain_id=player.player_id,
            showdown_rules=options.get("showdown_rules"))
        if not result["ok"]:
            rows.append({**row, "status": "invalid", "validation": result["validation"]})
            continue
        result.update(score_lineup(result["lineup"], options["objective"],
                                  forecast_snapshot_id=snapshot_id, solver_status="optimal"))
        result["construction_audit"] = audit_showdown_lineup(result["lineup"], showdown_rules=options.get("showdown_rules"))
        score = result["objective_score"]
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
        "showdown_rules": options.get("showdown_rules"),
        "candidates": valid + [row for row in rows if row["status"] != "optimal"],
    }


def compare_with_player(players, *, site, options, snapshot_id, player_id, slot, context=None):
    """Two bounded single-lineup solves on one frozen eligible catalog.

    This is read-only. It explains a complete-lineup tradeoff, not the cause of
    omission from a portfolio that had different exposure/search constraints.
    """
    from src.products.lineup_optimizer import optimize_lineup
    from src.products.dfs_validation import validate_generated_lineups
    from src.products.dfs_showdown_integrity import score_lineup, audit_showdown_lineup

    started = monotonic()
    report = {"snapshot_id": snapshot_id, "objective": options["objective"],
              "salary_cap": options.get("salary_cap"),
              "scope": "frozen_single_lineup_not_portfolio_selection",
              "semantics": "sum_of_player_objective_inputs_not_expected_payout_or_lineup_quantile",
              "player_id": player_id, "slot": slot, "context": context or {},
              "showdown_rules": options.get("showdown_rules"), "budget": comparison_budget()}

    def solve(solve_options):
        remaining = TIME_BUDGET_SECONDS - (monotonic() - started)
        if remaining <= 0:
            return {"status": "not_evaluated", "reason": "comparison_budget"}
        result = optimize_lineup(players, **{**solve_options, "solver_time_limit": min(PER_SOLVE_SECONDS, remaining)})
        if not result.get("ok"):
            return {"status": "infeasible" if result.get("solver_status") == 2 else "unresolved",
                    "reason": result.get("error"), "solver_status": result.get("solver_status"),
                    "strategy_diagnostics": result.get("strategy_diagnostics", [])}
        result = validate_generated_lineups(result, players, site=site,
            salary_cap=options.get("salary_cap"), min_salary=options.get("min_salary"),
            max_per_team=options.get("max_per_team"), locked_player_ids=solve_options.get("locked_player_ids") or (),
            locked_captain_id=solve_options.get("locked_captain_id"), showdown_rules=options.get("showdown_rules"))
        if not result["ok"]:
            return {"status": "invalid", "validation": result["validation"]}
        result.update(score_lineup(result["lineup"], options["objective"],
                                  forecast_snapshot_id=snapshot_id, solver_status="optimal"))
        findings = audit_showdown_lineup(result["lineup"], showdown_rules=options.get("showdown_rules"))
        return {"status": "optimal", "objective_score": result["objective_score"],
                "projection_sum": result["projection_sum"], "findings": findings, "result": result}

    report["baseline"] = solve(dict(options))
    locked_captain = options.get("locked_captain_id")
    if player_id not in {p.player_id for p in players}:
        forced = {"status": "conflict", "reason": "The player is excluded or unavailable in the frozen eligible pool."}
    elif slot == "captain" and locked_captain and locked_captain != player_id:
        forced = {"status": "conflict", "reason": "The chosen Captain conflicts with the saved Captain lock."}
    elif slot == "flex" and locked_captain == player_id:
        forced = {"status": "conflict", "reason": "This player is locked as Captain and cannot be forced into FLEX."}
    elif slot == "captain" and player_id in (options.get("excluded_captain_ids") or set()):
        forced = {"status": "conflict", "reason": "This player is excluded from Captain by the saved Captain limit."}
    else:
        forced_options = {**options, "locked_player_ids": set(options.get("locked_player_ids") or ()) | {player_id}}
        if slot == "captain":
            forced_options["locked_captain_id"] = player_id
        elif slot == "flex":
            forced_options["excluded_captain_ids"] = set(options.get("excluded_captain_ids") or ()) | {player_id}
        else:
            raise ValueError("Player comparison slot must be flex or captain.")
        forced = solve(forced_options)
    report["forced"] = forced
    baseline = report["baseline"]
    report["complete"] = all(row["status"] in {"optimal", "infeasible", "conflict"}
                             for row in [baseline, forced])
    report["tradeoff"] = None
    if baseline["status"] == forced["status"] == "optimal":
        before = {row["player_id"] for row in baseline["result"]["lineup"]}
        after = {row["player_id"] for row in forced["result"]["lineup"]}
        before_codes = {row["code"] for row in baseline["findings"]}
        after_codes = {row["code"] for row in forced["findings"]}
        report["tradeoff"] = {"added_player_ids": sorted(after - before),
            "removed_player_ids": sorted(before - after),
            "objective_delta": round(forced["objective_score"] - baseline["objective_score"], 6),
            "projection_delta": round(forced["projection_sum"] - baseline["projection_sum"], 6),
            "salary_delta": (forced["result"]["total_salary"] or 0) - (baseline["result"]["total_salary"] or 0),
            "new_warning_codes": sorted(after_codes - before_codes), "removed_warning_codes": sorted(before_codes - after_codes)}
    return report
