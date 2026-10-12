"""Bounded Classic candidate selection, independent of forecast generation.

Hard bounds count every appearance. Soft targets use a declared lexicographic
objective: minimize total absolute appearance misses, then maximize the original
projection objective. This is only an optimum over the supplied candidate pool.
"""
from __future__ import annotations

from collections import Counter
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_FLOOR
import hashlib
import json
import time

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

MAX_CANDIDATES = 600
SELECTION_SECONDS = 8.0
GENERATION_SECONDS = 15.0


def _fraction(value):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("Exposure fractions must be finite decimals between 0 and 1.") from None
    if not number.is_finite() or not 0 <= number <= 1:
        raise ValueError("Exposure fractions must be finite decimals between 0 and 1.")
    return number


def exposure_counts(limits: dict, count: int) -> dict:
    if set(limits) - {"min", "target", "max"}:
        raise ValueError("Exposure controls accept min, target, and max only.")
    def amount(value, *, soft=False):
        if isinstance(value, dict):
            exact = value.get("count")
            if soft:
                try:
                    decimal = Decimal(str(exact))
                except (InvalidOperation, ValueError):
                    raise ValueError("Soft target counts must be finite decimals within the requested count.") from None
                if set(value) != {"count"} or not decimal.is_finite() or not 0 <= decimal <= count:
                    raise ValueError("Soft target counts must be finite decimals within the requested count.")
                return decimal
            if set(value) != {"count"} or isinstance(exact, bool) or not isinstance(exact, int) or not 0 <= exact <= count:
                raise ValueError("Exact exposure counts must be whole numbers from 0 through the requested count.")
            return Decimal(exact)
        return _fraction(value)*count
    lower = amount(limits.get("min", 0))
    upper = amount(limits.get("max", 1))
    if lower > upper:
        raise ValueError("Minimum exposure cannot exceed maximum exposure.")
    return {
        "minimum_count": int(lower.to_integral_value(rounding=ROUND_CEILING)),
        "maximum_count": int(upper.to_integral_value(rounding=ROUND_FLOOR)),
        "target_count": str(amount(limits["target"], soft=True)) if "target" in limits else None,
    }


def select_portfolio(candidates: list[dict], *, count: int, player_ids: list[str],
                     player_exposure_limits: dict | None = None,
                     group_exposure_limits: list[dict] | None = None,
                     locked_player_ids=(), max_exposure=None, max_overlap=None,
                     objective: str = "median", time_limit: float = SELECTION_SECONDS,
                     candidate_scores: dict | None = None) -> dict:
    """Select exactly count unique candidates, or return a truthful unresolved result."""
    started = time.monotonic()
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 150:
        raise ValueError("Global portfolio count must be a whole number from 1 through 150.")
    if len(candidates) > MAX_CANDIDATES:
        raise ValueError(f"Candidate pool exceeds the {MAX_CANDIDATES}-lineup budget.")
    universe = set(player_ids)
    locked = set(locked_player_ids)
    rules, conflicts = [], []
    configured = player_exposure_limits or {}
    if set(configured) - universe or locked - universe:
        raise ValueError("An exposure or lock references a player outside the eligible pool.")
    default_max = _fraction(max_exposure) if max_exposure is not None else Decimal(1)
    for pid in sorted(universe):
        limits = dict(configured.get(pid) or {})
        rule = {"id": pid, "scope": "player", "player_ids": [pid], **exposure_counts(limits, count)}
        rule["maximum_count"] = min(rule["maximum_count"], int((default_max*count).to_integral_value(rounding=ROUND_FLOOR)))
        if pid in locked:
            if rule["maximum_count"] < count:
                conflicts.append(f"Locked player {pid} requires {count} appearances; maximum allows {rule['maximum_count']}.")
            rule["minimum_count"] = count
        rules.append(rule)
    group_ids = set()
    for group in group_exposure_limits or []:
        gid, members = group.get("id"), group.get("player_ids", [])
        if not isinstance(gid, str) or not gid.strip() or gid in group_ids:
            raise ValueError("Pair/core controls require distinct nonempty IDs.")
        if not 2 <= len(members) <= 9 or len(set(members)) != len(members) or set(members) - universe:
            raise ValueError("Pair/core controls need 2 to 9 distinct eligible player IDs.")
        if set(group) - {"id", "player_ids", "min", "target", "max"}:
            raise ValueError("Unsupported pair/core control field.")
        group_ids.add(gid)
        rules.append({"id": gid, "scope": "group", "player_ids": sorted(members),
                      **exposure_counts({k: group[k] for k in ("min", "target", "max") if k in group}, count)})
        if set(members).issubset(locked) and rules[-1]["maximum_count"] < count:
            conflicts.append(f"Locked core {gid} requires {count} appearances; maximum allows {rules[-1]['maximum_count']}.")
    for rule in rules:
        if rule["minimum_count"] > rule["maximum_count"]:
            conflicts.append(f"{rule['id']}: rounded minimum {rule['minimum_count']} exceeds maximum {rule['maximum_count']}.")
    unique = {}
    for entry in candidates:
        ids = [row["player_id"] for row in entry["lineup"]]
        if len(ids) != len(set(ids)) or set(ids) - universe:
            raise ValueError("Candidate contains duplicate or ineligible athlete IDs.")
        if not locked.issubset(ids):
            raise ValueError("Candidate is missing a global lock.")
        key = tuple(sorted(ids))
        # A deterministic representative retains its actual valid slot mapping.
        prior = unique.get(key)
        if prior is None or json.dumps(entry, sort_keys=True) < json.dumps(prior, sort_keys=True):
            unique[key] = entry
    keys = sorted(unique)
    entries = [unique[key] for key in keys]
    sets = [set(key) for key in keys]
    m = len(entries)
    manifest_data = {"version": 1, "requested_count": count, "objective": objective,
                     "objective_mode": "projection-guided", "candidate_keys": keys,
                     "candidate_scores": [float((candidate_scores or {}).get(key, entry["total_points"])) for key, entry in zip(keys, entries)],
                     "constraints": rules, "max_overlap": max_overlap,
                     "target_policy": "minimum absolute appearance miss, then original objective sum"}
    manifest = hashlib.sha256(json.dumps(manifest_data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    report = {"requested_count": count, "selected_count": 0, "unique_count": 0, "candidate_count": m,
              "solver_status": "not_started", "candidate_pool_only": True,
              "objective_mode": "projection-guided", "objective": objective,
              "target_policy": manifest_data["target_policy"], "constraints": rules,
              "conflicts": conflicts, "targets": [], "manifest": manifest,
              "rounding": "minimum ceil(fraction*N), maximum floor(fraction*N); decimal arithmetic",
              "bound": None, "gap": None, "candidate_manifest": manifest_data}

    def finish(status, error=None, selected=None):
        selected = selected or []
        used = Counter(pid for entry in selected for pid in {r["player_id"] for r in entry["lineup"]})
        report.update(solver_status=status, selected_count=len(selected), unique_count=len(selected),
                      runtime_seconds=round(time.monotonic() - started, 4))
        report["targets"] = [{"id": rule["id"], "scope": rule["scope"], "target_count": rule["target_count"],
            "actual_count": sum(set(rule["player_ids"]).issubset({r["player_id"] for r in entry["lineup"]}) for entry in selected),
            "deviation_count": str(Decimal(sum(set(rule["player_ids"]).issubset({r["player_id"] for r in entry["lineup"]}) for entry in selected)) - Decimal(rule["target_count"]))}
            for rule in rules if rule["target_count"] is not None]
        result = {"ok": bool(selected), "lineups": selected, "count": len(selected), "requested_count": count,
                  "complete": len(selected) == count, "exposure_valid": bool(selected), "exposure_violations": [],
                  "exposure_basis": {"enforced_count": count, "reported_count": len(selected), "locks_exempt": []},
                  "exposure": [{"player_id": pid, "count": used[pid], "pct": round(100 * used[pid] / count, 1)} for pid in sorted(used, key=lambda pid: (-used[pid], pid))],
                  "portfolio_selection": report,
                  "note": "Global projection-guided selection over the generated candidate pool. All locks count toward bounds; soft targets may be missed."}
        if error:
            result["error"] = error
        return result

    if conflicts:
        return finish("constraint_conflict", " ".join(conflicts))
    if m < count:
        return finish("insufficient_candidates", f"Only {m} unique candidates for {count} requested lineups. Increase candidate search or change constraints; no lineups were repeated.")
    for rule in rules:
        available = sum(set(rule["player_ids"]).issubset(ids) for ids in sets)
        unavoidable = max(0, count-(m-available))
        if available < rule["minimum_count"]:
            conflicts.append(f"{rule['id']}: only {available} candidates include this selection; minimum requires {rule['minimum_count']}. Search more alternatives or explicitly lower this minimum.")
        if unavoidable > rule["maximum_count"]:
            conflicts.append(f"{rule['id']}: at least {unavoidable} appearances are unavoidable in this candidate pool; maximum allows {rule['maximum_count']}. Search more alternatives or explicitly raise this maximum.")
    if conflicts:
        return finish("infeasible_candidate_pool", " ".join(conflicts))

    targets = [rule for rule in rules if rule["target_count"] is not None]
    nv = m + 2 * len(targets)
    row_indexes, col_indexes, data, lower, upper = [], [], [], [], []

    def add(coeffs, lb, ub):
        row = len(lower)
        for column, value in coeffs.items():
            row_indexes.append(row); col_indexes.append(column); data.append(value)
        lower.append(lb); upper.append(ub)

    add(dict.fromkeys(range(m), 1), count, count)
    for rule in rules:
        incidence = {i: 1 for i, ids in enumerate(sets) if set(rule["player_ids"]).issubset(ids)}
        add(incidence, rule["minimum_count"], rule["maximum_count"])
    if max_overlap is not None:
        for i in range(m):
            for j in range(i):
                if len(sets[i] & sets[j]) > max_overlap:
                    add({i: 1, j: 1}, 0, 1)
    for ti, rule in enumerate(targets):
        incidence = {i: 1 for i, ids in enumerate(sets) if set(rule["player_ids"]).issubset(ids)}
        incidence.update({m + 2*ti: -1, m + 2*ti + 1: 1})
        target = float(rule["target_count"])
        add(incidence, target, target)
    bounds = Bounds(np.zeros(nv), np.array([1]*m + [count]* (nv-m)))
    integrality = np.array([1]*m + [0]*(nv-m))

    def solve(cost):
        remaining = time_limit - (time.monotonic() - started)
        if remaining <= 0:
            return None
        matrix = coo_matrix((data, (row_indexes, col_indexes)), shape=(len(lower), nv)).tocsc()
        return milp(cost, integrality=integrality, bounds=bounds,
                    constraints=LinearConstraint(matrix, np.array(lower), np.array(upper)),
                    options={"time_limit": remaining, "mip_rel_gap": 0.0})

    report["solver_stage"] = "soft_targets" if targets else "projection_objective"
    target_incumbent = None
    if targets:
        target_cost = np.array([0.0]*m + [1.0]*(nv-m))
        solved = solve(target_cost)
        if solved is not None and solved.status == 0:
            target_incumbent = solved
            report["target_stage_status"] = "optimal"
            add({i: 1 for i in range(m, nv)}, 0, float(solved.fun) + 1e-7)
        else:
            return _finalize_solver(solved, entries, sets, rules, count, max_overlap, finish, report)
    report["solver_stage"] = "projection_objective"
    # Input scores have full precision when provided by the generator.
    objective_cost = np.array([-score for score in manifest_data["candidate_scores"]] + [0.]*(nv-m))
    solved = solve(objective_cost)
    return _finalize_solver(solved, entries, sets, rules, count, max_overlap, finish, report,
                            target_incumbent=target_incumbent)


def _finalize_solver(solved, entries, sets, rules, count, max_overlap, finish, report,
                     target_incumbent=None):
    status = "time_limit" if solved is None else {0: "optimal", 1: "time_limit", 2: "infeasible_candidate_pool"}.get(solved.status, "solver_error")
    if solved is not None:
        for field, attr in (("bound", "mip_dual_bound"), ("gap", "mip_gap")):
            value = getattr(solved, attr, None)
            report[field] = float(value) if value is not None and np.isfinite(value) else None
        report["bound_units"] = "minimized negative projection objective (or target deviation if target stage unfinished)"
    x = getattr(solved, "x", None)
    if x is None and status == "time_limit" and target_incumbent is not None:
        # Finishing target optimization already produced a full feasible portfolio.
        # Preserve it if projection optimization cannot return another incumbent.
        x = getattr(target_incumbent, "x", None)
        report["incumbent_stage"] = "soft_targets"
    if x is None:
        if status == "infeasible_candidate_pool":
            report["conflicts"].append("The combined player, pair/core and overlap bounds are infeasible in this candidate pool. An exact minimal conflict set is unavailable; inspect applied bounds, search more alternatives, or explicitly change a bound.")
        return finish(status, "Global selection did not return a complete feasible portfolio. This applies only to this bounded candidate pool; no hard constraints were relaxed.")
    chosen = [i for i in range(len(entries)) if x[i] > .5]
    valid = len(chosen) == count and all(abs(x[i] - round(x[i])) < 1e-5 for i in range(len(entries)))
    for rule in rules:
        actual = sum(set(rule["player_ids"]).issubset(sets[i]) for i in chosen)
        valid = valid and rule["minimum_count"] <= actual <= rule["maximum_count"]
    if max_overlap is not None:
        valid = valid and all(len(sets[i] & sets[j]) <= max_overlap for n, i in enumerate(chosen) for j in chosen[:n])
    if not valid:
        return finish(status if status != "optimal" else "solver_error", "Solver returned no independently verified full portfolio; no lineups were repeated or relaxed.")
    return finish("feasible_time_limit" if status == "time_limit" else status, selected=[entries[i] for i in chosen])


def qb_dst_audit(entry, by_id):
    """Strategy policy only; unknown opponent data never becomes a passed check."""
    conflicts, unknown = [], []
    qbs = [by_id[row["player_id"]] for row in entry["lineup"] if by_id[row["player_id"]].position == "QB"]
    defenses = [by_id[row["player_id"]] for row in entry["lineup"] if by_id[row["player_id"]].position == "DST"]
    from src.core.team_codes import normalize_team_for_match as team_key
    for qb in qbs:
        for dst in defenses:
            qb_opponent, dst_opponent = team_key(qb.opponent), team_key(dst.opponent)
            qb_team, dst_team = team_key(qb.team), team_key(dst.team)
            if (qb_opponent and dst_team and qb_opponent == dst_team) or (dst_opponent and qb_team and dst_opponent == qb_team):
                conflicts.append([qb.player_id, dst.player_id])
            elif not ((qb_opponent and dst_team) or (dst_opponent and qb_team)):
                unknown.append([qb.player_id, dst.player_id])
    return {"conflicts": conflicts, "unknown": unknown}


def generate_global_portfolio(players, *, count, player_exposure_limits=None,
                              group_exposure_limits=None, max_exposure=None,
                              max_overlap=None, randomness=0., seed=0,
                              block_qb_opposing_dst=True, **options):
    """Bounded diverse legal search; final selection never uses exhaustion caps."""
    from src.products.lineup_optimizer import optimize_lineup, _objective_value
    started = time.monotonic()
    by_id = {p.player_id: p for p in players}
    if len(by_id) != len(players):
        raise ValueError("Duplicate canonical player IDs in the eligible pool. Resolve the slate mapping before building.")
    # Validate the full request before spending the candidate-generation budget.
    preflight = select_portfolio([], count=count, player_ids=list(by_id),
        player_exposure_limits=player_exposure_limits, group_exposure_limits=group_exposure_limits,
        max_exposure=max_exposure, locked_player_ids=options.get("locked_player_ids", ()))
    if preflight["portfolio_selection"]["conflicts"]:
        return preflight
    base = []
    unknown_pairs = 0
    if block_qb_opposing_dst:
        for qb in (p for p in players if p.position == "QB"):
            for dst in (p for p in players if p.position == "DST"):
                audit = qb_dst_audit({"lineup": [{"player_id": qb.player_id}, {"player_id": dst.player_id}]}, by_id)
                if audit["conflicts"] or audit["unknown"]:
                    base.append(({qb.player_id: 1, dst.player_id: 1}, 0, 1))
                    unknown_pairs += bool(audit["unknown"])
                    if {qb.player_id, dst.player_id}.issubset(options.get("locked_player_ids") or set()):
                        reason = "opponent identity is unknown" if audit["unknown"] else "the defense opposes this quarterback"
                        preflight["portfolio_selection"]["solver_status"] = "constraint_conflict"
                        preflight["error"] = f"Locked {qb.player_id} with {dst.player_id} conflicts with the QB/opposing-DST safeguard: {reason}. Change locks or explicitly disable the safeguard."
                        preflight["portfolio_selection"]["conflicts"].append(preflight["error"])
                        return preflight
    rules = preflight["portfolio_selection"]["constraints"]
    for rule in rules:
        if rule["maximum_count"] == 0:
            base.append((dict.fromkeys(rule["player_ids"], 1), 0, len(rule["player_ids"])-1))
    emphasis = [set(rule["player_ids"]) for rule in rules if rule["minimum_count"] or (rule["target_count"] is not None and Decimal(rule["target_count"]) > 0)]
    # Alternating capped-player omissions gives selection alternatives to popular cores.
    omissions = [pid for rule in rules if rule["scope"] == "player" and 0 < rule["maximum_count"] < count for pid in rule["player_ids"]]
    candidates, scores, cuts = [], {}, []
    rng = np.random.default_rng(seed or 0)
    budget = min(MAX_CANDIDATES, max(40, count*3))
    attempts = 0
    while len(candidates) < budget and attempts < budget*2:
        remaining = GENERATION_SECONDS - (time.monotonic()-started)
        if remaining <= 0:
            break
        trial = dict(options)
        trial["locked_player_ids"] = set(options.get("locked_player_ids") or ())
        controls = base + cuts
        if attempts % 3 == 1 and emphasis:
            trial["locked_player_ids"].update(emphasis[(attempts//3) % len(emphasis)])
        if attempts % 3 == 2 and omissions:
            controls = controls + [({omissions[(attempts//3) % len(omissions)]: 1}, 0, 0)]
        trial["solver_time_limit"] = min(1., remaining)
        if attempts:
            trial["objective_noise"] = {pid: float(np.clip(rng.normal(1., max(.12, randomness)), .05, None)) for pid in by_id}
        result = optimize_lineup(players, extra_constraints=controls, **trial)
        attempts += 1
        if not result.get("ok"):
            # A failed targeted search is not evidence the unrestricted space is empty.
            if attempts % 3 == 1 and result.get("solver_status") == "infeasible":
                break
            continue
        key = tuple(sorted(row["player_id"] for row in result["lineup"]))
        if key in scores:
            continue
        candidates.append(result)
        scores[key] = sum(_objective_value(by_id[pid], options.get("objective", "median")) for pid in key)
        cuts.append((dict.fromkeys(key, 1), 0, len(key)-1))
    result = select_portfolio(candidates, count=count, player_ids=list(by_id),
        player_exposure_limits=player_exposure_limits, group_exposure_limits=group_exposure_limits,
        max_exposure=max_exposure, locked_player_ids=options.get("locked_player_ids", ()),
        max_overlap=max_overlap, objective=options.get("objective", "median"), candidate_scores=scores)
    report = result["portfolio_selection"]
    report["generation"] = {"candidate_budget": budget, "attempt_count": attempts,
        "time_budget_seconds": GENERATION_SECONDS, "runtime_seconds": round(time.monotonic()-started-report["runtime_seconds"], 4),
        "seed": seed or 0, "unknown_qb_dst_pairs_excluded": unknown_pairs,
        "search": "unique projection solves with targeted locks/omissions and seeded objective jitter; not a football simulation"}
    report["block_qb_opposing_dst"] = block_qb_opposing_dst
    report["strategy_evidence"] = "eligible-pool opponent/team fields; exact game identity is not independently verified"
    report["strategy_audit"] = [qb_dst_audit(entry, by_id) for entry in result.get("lineups", [])]
    if block_qb_opposing_dst and any(audit["conflicts"] or audit["unknown"] for audit in report["strategy_audit"]):
        result.update(ok=False, exposure_valid=False,
            error="Selected candidates failed the independent QB/opposing-DST strategy audit. Change locks or explicitly review the safeguard override before rebuilding.")
    for row in result.get("exposure", []):
        p = by_id[row["player_id"]]
        row.update(player=p.name, team=p.team, position=p.position)
    return result
