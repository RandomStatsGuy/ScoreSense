"""Bounded complete Classic rosters on one frozen decision-time input set.

This is a projection-input diagnostic, not a joint-outcome or payout model.
Original native constraints intersect every alternative; nothing is relaxed.
"""
from __future__ import annotations

from dataclasses import asdict, replace
import math
from time import monotonic

from src.core.team_codes import normalize_team_for_match
from src.products.dfs_config import get_site_config
from src.products.dfs_snapshots import content_id
from src.products.dfs_stack_rules import (normalize_classic_stack_rules,
    compile_classic_stack_constraints, audit_classic_stack)
from src.products.dfs_validation import validate_generated_lineups

VERSION = 1
MAX_REQUESTS = 320
MAX_QBS = 40
MAX_PLAYERS = 5000
MAX_SOLVES = 120
TIME_BUDGET_SECONDS = 15.0
PER_SOLVE_SECONDS = 0.5
SEMANTICS = "sum_of_player_objective_inputs_not_lineup_quantile_or_expected_payout"


def comparison_budget():
    return {"version": VERSION, "max_requests": MAX_REQUESTS, "max_solves": MAX_SOLVES,
            "total_seconds": TIME_BUDGET_SECONDS, "per_solve_seconds": PER_SOLVE_SECONDS,
            "max_completions": 3}


def _ids(values, label):
    if (not isinstance(values, (list, tuple, set, frozenset)) or len(values) > MAX_PLAYERS or
            any(not isinstance(pid, str) or not pid or pid != pid.strip() or len(pid) > 100 for pid in values) or
            len(set(values)) != len(values)):
        raise ValueError(f"{label} requires distinct exact canonical player IDs.")
    return set(values)


def _common_players(pool, objective):
    from src.products.lineup_optimizer import LineupPlayer, _players_from_pool
    if objective not in {"median", "floor", "ceiling", "value"}:
        raise ValueError("Unsupported comparison objective.")
    if isinstance(pool, (list, tuple)):
        if any(not isinstance(player, LineupPlayer) for player in pool):
            raise ValueError("Comparison requires typed frozen players or a player-pool frame.")
        players = [replace(player, team=normalize_team_for_match(player.team),
            opponent=normalize_team_for_match(player.opponent)) for player in pool]
        _ids([p.player_id for p in players], "Common pool")
    else:
        _ids(pool.player_id.tolist(), "Common pool")
        # Retain unavailable identities in the frozen comparison inputs. Solver
        # generation filters them later; historical rescoring still needs their
        # finite supplied inputs without treating an inactive status as no ID.
        players = _players_from_pool(pool, objective=objective, require_salary=True,
            block_bye_weeks=False, locked_player_ids=set(pool.player_id))
    if not players or len(players) > MAX_PLAYERS:
        raise ValueError("Comparison requires a bounded nonempty finite common player pool.")
    for player in players:
        if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value)
               for value in (player.proj, player.floor, player.ceiling)):
            raise ValueError("Common forecasts must be finite; missing forecasts cannot become zero.")
        if player.floor > player.proj or player.proj > player.ceiling:
            raise ValueError("Common player quantiles must be ordered.")
        if type(player.salary) is not int or player.salary <= 0:
            raise ValueError("Comparison requires positive whole salaries.")
        if objective == "value" and player.value is not None and not math.isfinite(player.value):
            raise ValueError("Common value inputs must be finite.")
    return players


def _snapshot(players, objective, context):
    payload = {"version": VERSION, "objective": objective, "semantics": SEMANTICS,
               "source_context": context or {}, "players": [asdict(p) for p in sorted(players, key=lambda p: p.player_id)]}
    return {"id": content_id(payload), "content": payload}


def evaluate_common_snapshot(lineups, pool, *, objective="median", snapshot_context=None):
    """Rescore by exact athlete ID; historical rows/salaries remain untouched.

    Missing common forecasts yield an unavailable score, never an invented zero.
    This does not certify historical rosters against a newer salary catalog.
    """
    from src.products.lineup_optimizer import _objective_value
    if not isinstance(lineups, list) or len(lineups) > 500:
        raise ValueError("Common evaluation accepts at most 500 explicit lineups.")
    players = _common_players(pool, objective)
    by_id = {p.player_id: p for p in players}
    snapshot = _snapshot(players, objective, snapshot_context)
    rows = []
    for index, entry in enumerate(lineups):
        ids = [row.get("player_id") for row in entry.get("lineup", [])]
        _ids(ids, "Lineup")
        if len(ids) != 9:
            raise ValueError("Common Classic evaluation requires complete nine-player lineups.")
        missing = sorted(set(ids) - set(by_id))
        rows.append({"lineup_index": index, "status": "unavailable" if missing else "evaluated",
                     "missing_player_ids": missing,
                     "objective_score": None if missing else sum(_objective_value(by_id[pid], objective) for pid in ids)})
    return {"version": VERSION, "snapshot_id": snapshot["id"], "objective": objective,
            "semantics": SEMANTICS, "scope": "common_forecast_rescore_not_historical_legality",
            "complete": all(row["status"] == "evaluated" for row in rows), "lineups": rows}


def _requests(raw, qbs, receiving_rb_ids, by_id):
    if raw is None:
        # Round-robin by construction: every eligible QB gets a first comparison
        # before a second construction consumes the bounded solve budget.
        controls = [("one", "exact", 1, "optional"), ("two", "exact", 2, "optional"),
                    ("optional", "optional", 0, "optional"), ("none", "forbidden", 0, "optional"),
                    ("bring", "exact", 1, "minimum"), ("no-bring", "exact", 1, "forbidden")]
        raw = [{"id": f"{qb.player_id}:{label}", "qb_id": qb.player_id,
                "attachments": {"mode": mode, "count": count, "receiving_rb_ids": list(receiving_rb_ids)},
                "bring_back": {"mode": bring, "count": 1 if bring == "minimum" else 0}}
               for label, mode, count, bring in controls for qb in qbs]
        for qb in qbs:
            for pid in receiving_rb_ids:
                if pid not in by_id or by_id[pid].position != "RB":
                    raise ValueError("Receiving RB eligibility must reference an eligible RB.")
                if by_id[pid].team != qb.team:
                    continue
                raw.append({"id": f"{qb.player_id}:rb:{pid}", "qb_id": qb.player_id,
                    "attachments": {"mode": "exact", "count": 1, "receiving_rb_ids": list(receiving_rb_ids)},
                    "bring_back": {"mode": "optional", "count": 0}, "core_player_ids": [pid]})
    if not isinstance(raw, list) or not raw or len(raw) > MAX_REQUESTS:
        raise ValueError(f"Comparison needs 1 through {MAX_REQUESTS} explicit controls.")
    normalized, seen = [], set()
    qb_ids = {qb.player_id for qb in qbs}
    for row in raw:
        if not isinstance(row, dict) or set(row) - {"id", "qb_id", "attachments", "bring_back", "core_player_ids"}:
            raise ValueError("Unsupported comparison control.")
        key = row.get("id")
        if not isinstance(key, str) or not key.strip() or len(key) > 300 or key in seen:
            raise ValueError("Comparison control IDs must be distinct bounded strings.")
        if row.get("qb_id") not in qb_ids:
            raise ValueError("Comparison control must name an eligible QB.")
        rules = normalize_classic_stack_rules({"version": 1,
            "attachments": row.get("attachments", {"mode": "optional", "count": 0}),
            "bring_back": row.get("bring_back", {"mode": "optional", "count": 0})})
        core = _ids(row.get("core_player_ids", []), "Core")
        seen.add(key)
        normalized.append({"id": key, "qb_id": row["qb_id"], "classic_stack_rules": rules,
                           "core_player_ids": sorted(core)})
    return normalized


def compare_classic_lineups(pool, *, site="draftkings", objective="median", requests=None,
        locked_player_ids=(), excluded_player_ids=(), salary_cap=None, min_salary=0,
        max_per_team=None, block_qb_opposing_dst=True, classic_stack_rules=None,
        stack_teams=None, stack_qb_ids=None, receiving_rb_ids=(), completions=3,
        snapshot_context=None):
    from src.products import lineup_optimizer as optimizer
    from src.products.dfs_portfolio_selection import qb_dst_audit
    started = monotonic()
    if site not in {"draftkings", "fanduel"}:
        raise ValueError("Complete-lineup comparison supports Classic only.")
    if type(completions) is not int or not 1 <= completions <= 3 or type(block_qb_opposing_dst) is not bool:
        raise ValueError("Comparison permits one to three completions and an explicit DST safeguard.")
    config = get_site_config(site)
    salary_cap = config["salary_cap"] if salary_cap is None else salary_cap
    if type(salary_cap) is not int or not 0 < salary_cap <= config["salary_cap"]:
        raise ValueError("Comparison salary cap cannot exceed the site maximum.")
    if type(min_salary) is not int or not 0 <= min_salary <= salary_cap:
        raise ValueError("Comparison minimum salary must fit the salary cap.")
    max_per_team = config.get("max_per_team_default") if max_per_team is None else max_per_team
    if max_per_team is not None and (type(max_per_team) is not int or not 0 <= max_per_team <= 9):
        raise ValueError("Comparison team limit must be a whole count from zero through nine.")
    platform_team_limit = config.get("max_per_team_default")
    if platform_team_limit:
        max_per_team = min(max_per_team or platform_team_limit, platform_team_limit)
    common = _common_players(pool, objective)
    snapshot = _snapshot(common, objective, snapshot_context)
    locks, excluded = _ids(locked_player_ids, "Locks"), _ids(excluded_player_ids, "Exclusions")
    by_id = {p.player_id: p for p in common}
    if locks - set(by_id) or excluded - set(by_id) or locks & excluded:
        raise ValueError("Comparison locks/exclusions conflict or reference unavailable canonical IDs.")
    players = [p for p in common if p.player_id not in excluded and not p.on_bye and not p.unavailable]
    eligible = {p.player_id for p in players}
    if not locks.issubset(eligible):
        raise ValueError("Comparison cannot use a locked unavailable player.")
    qbs = sorted((p for p in players if p.position == "QB"), key=lambda p: p.player_id)
    if len(qbs) > MAX_QBS:
        raise ValueError("Comparison QB universe exceeds the declared bounded capacity.")
    receiving = sorted(_ids(receiving_rb_ids, "Receiving RB eligibility"))
    controls = _requests(requests, qbs, receiving, {p.player_id: p for p in players})
    base_rules = normalize_classic_stack_rules(classic_stack_rules)
    base = compile_classic_stack_constraints(players, base_rules)
    if block_qb_opposing_dst:
        for qb in qbs:
            for dst in (p for p in players if p.position == "DST"):
                audit = qb_dst_audit({"lineup": [{"player_id": qb.player_id}, {"player_id": dst.player_id}]}, by_id)
                if audit["conflicts"] or audit["unknown"]:
                    base.append(({qb.player_id: 1, dst.player_id: 1}, 0, 1))
    primary_qbs = _ids(stack_qb_ids or [], "Primary QBs")
    if primary_qbs - {q.player_id for q in qbs}:
        raise ValueError("Primary QB scope references an unavailable quarterback.")
    teams = {normalize_team_for_match(team) for team in (stack_teams or [])}
    rows, cuts, attempts = [], {}, 0
    for control in controls:
        if set(control["core_player_ids"]) - eligible:
            raise ValueError("Comparison core references an unavailable canonical player.")
        qb = by_id[control["qb_id"]]
        rows.append({**control, "qb_name": qb.name, "in_primary_scope":
            qb.player_id in primary_qbs if primary_qbs else not teams or qb.team in teams,
            "status": "not_evaluated", "objective_score": None, "result": None,
            "completions": [], "gap_from_best_evaluated": None})
        cuts[control["id"]] = compile_classic_stack_constraints(players, control["classic_stack_rules"])
    for completion in range(completions):
        for row in rows:
            if row["status"] in {"infeasible", "invalid", "unresolved"}:
                continue
            remaining = TIME_BUDGET_SECONDS - (monotonic() - started)
            if attempts >= MAX_SOLVES or remaining <= 0:
                row["incomplete_reason"] = "comparison_budget"
                continue
            required = locks | {row["qb_id"]} | set(row["core_player_ids"])
            result = optimizer.optimize_lineup(players, objective=objective, roster=config["roster"],
                flex_positions=config["flex_positions"], salary_cap=salary_cap, min_salary=min_salary,
                max_per_team=max_per_team, locked_player_ids=required, extra_constraints=base + cuts[row["id"]],
                solver_time_limit=min(PER_SOLVE_SECONDS, remaining))
            attempts += 1
            status = result.get("solver_status")
            if not result.get("ok"):
                failure = "infeasible" if status in {2, "infeasible"} else "unresolved"
                if not row["completions"]:
                    row.update(status=failure, reason=result.get("error"), solver_status=status)
                else:
                    row["completion_search_status"] = failure
                continue
            result = validate_generated_lineups(result, players, site=site, salary_cap=salary_cap,
                min_salary=min_salary, max_per_team=max_per_team, locked_player_ids=required)
            native = audit_classic_stack(result, players, row["classic_stack_rules"]) if result.get("ok") else None
            original = audit_classic_stack(result, players, base_rules) if result.get("ok") else None
            dst = qb_dst_audit(result, by_id) if result.get("ok") else None
            valid = (result.get("ok") and result["validation"]["export_ids_complete"] and native["ok"] and
                     (original is None or original["ok"]) and
                     (not block_qb_opposing_dst or not (dst["conflicts"] or dst["unknown"])))
            if not valid:
                row.update(status="invalid", objective_score=None, result=None,
                           reason="Independent complete-lineup or construction audit failed.")
                continue
            score = sum(optimizer._objective_value(by_id[p["player_id"]], objective) for p in result["lineup"])
            item = {"status": "optimal" if status == "optimal" else "feasible_time_limit",
                    "objective_score": score, "result": result, "stack_audit": native,
                    "original_stack_audit": original, "dst_audit": dst}
            row["completions"].append(item)
            best = max(row["completions"], key=lambda entry: entry["objective_score"])
            row.update(best)
            key = {p["player_id"]: 1 for p in result["lineup"]}
            cuts[row["id"]].append((key, 0, 8))
    valid = [row for row in rows if row["objective_score"] is not None]
    best = max((row["objective_score"] for row in valid), default=None)
    for row in valid:
        row["gap_from_best_evaluated"] = max(0., best - row["objective_score"])
    def best_id(primary):
        found = [row for row in valid if row["in_primary_scope"] == primary]
        return max(found, key=lambda row: (row["objective_score"], row["id"]))["id"] if found else None
    return {"version": VERSION, "snapshot_id": snapshot["id"], "common_snapshot": snapshot,
        "objective": objective, "semantics": SEMANTICS, "scope": "complete_lineup_comparison_not_portfolio",
        "constraints": {"site": site, "salary_cap": salary_cap, "min_salary": min_salary,
            "max_per_team": max_per_team, "locked_player_ids": sorted(locks),
            "excluded_player_ids": sorted(excluded), "classic_stack_rules": base_rules,
            "block_qb_opposing_dst": block_qb_opposing_dst,
            "primary_stack_qb_ids": sorted(primary_qbs), "primary_stack_teams": sorted(teams)},
        "complete": all(row["status"] in {"optimal", "infeasible"} for row in rows),
        "completion_search_complete": all(len(row["completions"]) == completions or row.get("completion_search_status") == "infeasible" or row["status"] == "infeasible" for row in rows),
        "budget": comparison_budget(), "attempt_count": attempts, "runtime_seconds": round(monotonic() - started, 4),
        "best_primary_id": best_id(True), "best_challenger_id": best_id(False),
        "unapplied_portfolio_controls": ["lineup_count", "exposure_bounds", "overlap", "randomness"],
        "candidates": rows}
