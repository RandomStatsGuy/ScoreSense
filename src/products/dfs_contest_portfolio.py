"""Bounded, conditional portfolio choice over explicitly supplied scenarios.

Every trial set is priced jointly with all own ties and the full opponent count.
The search does not establish forecast returns or calibrated probabilities. Its
final assessment uses purpose-separated draws which are never used in search.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import Counter
from copy import deepcopy
from decimal import Decimal, InvalidOperation, localcontext
from fractions import Fraction
import hashlib
from itertools import combinations
from math import comb
import random
from time import monotonic
from types import SimpleNamespace

from src.products.dfs_contest_field import iter_field_draws, verified_contest_field
from src.products.dfs_contest_payouts import _round_share, validate_payout_contract
from src.products.dfs_contest_research import evaluate_contest_research, _distribution, _money
from src.products.dfs_portfolio_selection import exposure_counts, select_portfolio
from src.products.dfs_shared_outcomes import _hash, _id, _lineups, _verified_bank
from src.products.dfs_stack_rules import audit_classic_stack, normalize_classic_stack_rules

SCHEMA_VERSION = "dfs_contest_portfolio_selection_v1"
SEMANTICS = "conditional_supplied_scenario_portfolio_selection_not_forecast_ev"
OBJECTIVES = {"conditional_mean_net", "conditional_risk_adjusted_net", "conditional_top_finish"}
MAX_CANDIDATES = 600
MAX_TRIALS = 4096
TARGET_POLICY = "minimum absolute appearance miss, then conditional objective"
CAPABILITIES = {"conditional_portfolio_selection": True, "exact_joint_cash_ties": True,
    "common_selection_draws": True, "separate_final_evaluation_draws": True,
    "ownership_calibrated": False, "joint_outcomes_calibrated": False,
    "expected_payout": False, "forward_forecast": False,
    "platform_settlement_verified": False, "untouched_evaluation_verified": False}
WARNINGS = [
    "This chooses among supplied lineups under declared scenarios; it does not estimate future contest returns.",
    "Optimality, when proved, applies only to the supplied candidate pool and frozen selection draws.",
    "Loss risk and top-finish coverage are separate objectives, not guarantees of higher expected dollars.",
    "Separate evaluation streams do not prove that source data or previous research were untouched.",
    "Projection scores are declared candidate metadata, not authenticated platform or model performance.",
]


def _decimal(value, label, *, minimum=None, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError(f"{label} requires a bounded finite decimal.")
    text = str(value)
    if len(text) > 80 or text != text.strip():
        raise ValueError(f"{label} requires a bounded finite decimal.")
    try:
        number = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"{label} requires a bounded finite decimal.") from exc
    if (not number.is_finite() or number.as_tuple().exponent < -24 or
            len(number.as_tuple().digits) > 24 or
            (minimum is not None and number < minimum) or
            (maximum is not None and number > maximum)):
        raise ValueError(f"{label} is outside the supported decimal range.")
    return number


def _integer(value, label, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{label} requires a whole number from {low} through {high}.")
    return value


def _ids(values, label, universe):
    if not isinstance(values, (list, tuple, set)) or len(values) > len(universe):
        raise ValueError(f"{label} requires distinct eligible player IDs.")
    result = [_id(value, label) for value in values]
    if len(set(result)) != len(result) or set(result) - universe:
        raise ValueError(f"{label} requires distinct eligible player IDs.")
    return sorted(result)


def _candidates(lineups, pool):
    if not isinstance(lineups, list) or not 1 <= len(lineups) <= MAX_CANDIDATES:
        raise ValueError(f"Supply 1–{MAX_CANDIDATES} explicit, complete candidate lineups.")
    by_id = {row["player_id"]: row for row in pool}
    entries = []
    for start in range(0, len(lineups), 150):
        entries.extend(_lineups(lineups[start:start + 150], by_id))
    if len({row["lineup_id"] for row in entries}) != len(entries):
        raise ValueError("Candidate lineup IDs must be unique across the whole pool.")
    if len({tuple(sorted(row["player_ids"])) for row in entries}) != len(entries):
        raise ValueError("Remove scoring-equivalent duplicate candidates before choosing a portfolio.")
    return sorted(entries, key=lambda row: (tuple(sorted(row["player_ids"])), row["lineup_id"]))


def _check_exposure_shapes(player_limits, group_limits, universe, count, max_exposure):
    def bounded_limits(limits):
        # Native decimal count conversion uses the process Decimal context.
        # Admit only precision that stays exact after multiplying by N<=150;
        # tiny exponents and long near-one strings must not silently round hard
        # minima down to zero or hard maxima up to the full portfolio.
        for key, value in limits.items():
            if isinstance(value, dict):
                if set(value) != {"count"}:
                    raise ValueError("Exact exposure counts accept a count field only.")
                if key == "target":
                    _decimal(value["count"], "Soft exposure target count", minimum=Decimal(0), maximum=Decimal(count))
            else:
                _decimal(value, "Exposure fraction", minimum=Decimal(0), maximum=Decimal(1))
        return exposure_counts(limits, count)
    if player_limits is not None and not isinstance(player_limits, dict):
        raise ValueError("Player exposure controls require a mapping of eligible IDs to limits.")
    for pid, limits in (player_limits or {}).items():
        if _id(pid, "Exposure player ID") not in universe or not isinstance(limits, dict):
            raise ValueError("Player exposure controls require eligible IDs and min/target/max limit objects.")
        bounded_limits(limits)
    if group_limits is not None and (not isinstance(group_limits, list) or len(group_limits) > 600):
        raise ValueError("Pair/core controls require a bounded list of limit objects.")
    seen = set()
    for group in group_limits or []:
        if not isinstance(group, dict) or set(group) - {"id", "player_ids", "min", "target", "max"}:
            raise ValueError("Pair/core controls accept an ID, player IDs and min/target/max only.")
        gid = _id(group.get("id"), "Pair/core control ID")
        members = group.get("player_ids")
        if gid in seen or not isinstance(members, list) or not 2 <= len(members) <= 9:
            raise ValueError("Pair/core controls need distinct IDs and 2–9 distinct eligible player IDs.")
        _ids(members, "Pair/core player ID", universe)
        seen.add(gid)
        bounded_limits({key: group[key] for key in ("min", "target", "max") if key in group})
    if max_exposure is not None:
        bounded_limits({"max": max_exposure})


def _check_construction(entries, pool, *, locked, excluded, classic_stack_rules,
                        block_qb_opposing_dst, max_per_team, min_salary, max_salary):
    if type(block_qb_opposing_dst) is not bool:
        raise ValueError("The quarterback/opposing-defense safeguard requires an explicit boolean.")
    if max_per_team is not None:
        _integer(max_per_team, "Maximum players per team", 1, 9)
    if min_salary is not None:
        _integer(min_salary, "Minimum lineup salary", 0, 50000)
    _integer(max_salary, "Maximum lineup salary", 1, 50000)
    if min_salary is not None and min_salary > max_salary:
        raise ValueError("Minimum salary cannot exceed maximum salary.")
    rules = normalize_classic_stack_rules(classic_stack_rules)
    players = [SimpleNamespace(**row) for row in pool]
    by_id = {row["player_id"]: row for row in pool}
    for entry in entries:
        ids = set(entry["player_ids"])
        if not set(locked).issubset(ids) or ids.intersection(excluded):
            raise ValueError(f"Candidate {entry['lineup_id']} conflicts with the declared locks or exclusions; rebuild its candidate pool.")
        if not (min_salary or 0) <= entry["salary"] <= max_salary:
            raise ValueError(f"Candidate {entry['lineup_id']} violates the declared salary range.")
        selected = [by_id[pid] for pid in ids]
        if max_per_team is not None and max(Counter(row["team"] for row in selected).values()) > max_per_team:
            raise ValueError(f"Candidate {entry['lineup_id']} violates the declared team limit.")
        if block_qb_opposing_dst:
            qb = next(row for row in selected if row["position"] == "QB")
            dst = next(row for row in selected if row["position"] == "DST")
            if qb["opponent"] == dst["team"] or dst["opponent"] == qb["team"]:
                raise ValueError(f"Candidate {entry['lineup_id']} violates the quarterback/opposing-defense safeguard.")
        if rules is not None:
            audited = audit_classic_stack({"lineup": [{"player_id": pid} for pid in ids]}, players, rules)
            if not audited["ok"]:
                raise ValueError(f"Candidate {entry['lineup_id']} violates the declared Classic stack rules: {', '.join(audited['issues'])}.")
    return rules


def _effective_seed(seed, purpose):
    return int(hashlib.sha256(f"dfs-contest-portfolio-v1:{seed}:{purpose}".encode()).hexdigest(), 16) % (2**31)


def _freeze(bank, prepared, entries, *, count, scenario_id, seed, draw_count, top_k, purpose):
    """Score each complete candidate once per shared draw; retain bounded counts."""
    field = prepared["field"]
    opponent_count = prepared["payout_contract"]["entrant_count"] - count
    game_stream = hashlib.sha256(f"{bank['content_id']}:{seed}:{purpose}:dfs-shared-v1".encode()).hexdigest()
    rng = random.Random(int(game_stream, 16))
    fields = iter_field_draws(field, opponent_count, scenario_id=scenario_id, seed=seed,
                             draw_count=draw_count, purpose=purpose)
    draws, choices, field_streams = [], [], []
    for sampled in fields:
        player_scores, chosen = {}, []
        for game in bank["games"]:
            profile = rng.choices(game["profiles"], weights=[row["weight"] for row in game["profiles"]], k=1)[0]
            chosen.append((game["game_id"], profile["profile_id"]))
            player_scores.update({pid: Decimal(str(value)) for pid, value in profile["player_scores"].items()})
        def score(ids):
            return sum((player_scores[pid] for pid in ids), Decimal(0))
        own_scores = tuple(score(row["player_ids"]) for row in entries)
        opponent_groups = Counter()
        for row in sampled["template_counts"]:
            if row["multiplicity"]:
                opponent_groups[score(row["player_ids"])] += row["multiplicity"]
        sorted_scores = sorted(opponent_groups)
        prefix = [0]
        for value in sorted_scores:
            prefix.append(prefix[-1] + opponent_groups[value])
        above = tuple(opponent_count - prefix[bisect_right(sorted_scores, value)] for value in own_scores)
        equal = tuple(opponent_groups[value] for value in own_scores)
        draws.append({"scores": own_scores, "above": above, "equal": equal})
        choices.append(chosen)
        field_streams.append(sampled["stream_id"])
    return {"draws": draws, "contract": prepared["payout_contract"], "top_k": top_k,
            "count": count, "stream_manifest": {"purpose": purpose, "seed": seed,
                "game_stream_id": game_stream, "game_draw_content_id": _hash(choices),
                "field_draw_content_id": _hash(field_streams), "scenario_id": scenario_id,
                "full_opponent_count": opponent_count}}


def _prize_prefix(contract):
    """Prefix cash for occupied ranks, using tier count rather than entrant count."""
    ends, totals, prizes = [], [0], []
    for tier in contract["payout_tiers"]:
        ends.append(tier["end_rank"])
        totals.append(totals[-1] + (tier["end_rank"] - tier["start_rank"] + 1) * tier["prize_cents"])
        prizes.append(tier["prize_cents"])
    def total(rank):
        rank = min(rank, contract["paid_places"])
        if rank <= 0:
            return 0
        index = bisect_left(ends, rank)
        start = ends[index - 1] if index else 0
        return totals[index] + (rank - start) * prizes[index]
    return total


def _joint_values(frozen, selected_indices):
    """Exact joint own tie groups; equivalent to the independent payout adapter."""
    contract = frozen["contract"]
    selected_indices = tuple(selected_indices)
    if len(selected_indices) != frozen["count"] or len(set(selected_indices)) != len(selected_indices):
        raise ValueError("Joint pricing needs the exact requested unique portfolio count.")
    prefix = _prize_prefix(contract)
    fee = contract["entry_fee_cents"] * len(selected_indices)
    net, coverage = [], []
    for draw in frozen["draws"]:
        groups = {}
        for index in selected_indices:
            groups.setdefault(draw["scores"][index], []).append(index)
        gross, own_above, hit = Fraction(), 0, False
        for score in sorted(groups, reverse=True):
            indices = groups[score]
            representative = indices[0]
            rank = draw["above"][representative] + own_above + 1
            tied = draw["equal"][representative] + len(indices)
            share = Fraction(prefix(rank + tied - 1) - prefix(rank - 1), tied)
            gross += _round_share(share, contract["tie_policy"]["rounding"]) * len(indices)
            hit |= rank <= frozen["top_k"]
            own_above += len(indices)
        net.append(gross - fee)
        coverage.append(hit)
    return {"net": net, "coverage": coverage}


def _cvar(losses, alpha):
    """Empirical upper-tail mean with the exact fractional boundary weight."""
    ordered = sorted((Fraction(value) for value in losses), reverse=True)
    if not ordered or not 0 <= alpha < 1:
        raise ValueError("CVaR requires losses and alpha in [0, 1).")
    mass = (1 - alpha) * len(ordered)
    whole = mass.numerator // mass.denominator
    remainder = mass - whole
    total = sum(ordered[:whole], Fraction())
    if remainder:
        total += remainder * ordered[whole]
    return total / mass


def _metrics(values, alpha, weight, objective):
    net = values["net"]
    mean = sum(net, Fraction()) / len(net)
    cvar = _cvar([-value for value in net], alpha)
    adjusted = mean - weight * cvar
    coverage = Fraction(sum(values["coverage"]), len(net))
    utility = coverage if objective == "conditional_top_finish" else adjusted if objective == "conditional_risk_adjusted_net" else mean
    return {"mean_net_cents": _money(mean), "cvar_loss_cents": _money(cvar),
            "risk_adjusted_net_cents": _money(adjusted),
            "top_finish_fraction": {"numerator": str(coverage.numerator), "denominator": str(coverage.denominator)},
            "objective_value": ({"unit": "sample_fraction", "numerator": str(utility.numerator),
                                  "denominator": str(utility.denominator)} if objective == "conditional_top_finish" else _money(utility)),
            "net_distribution": _distribution(net)}


def _fraction(value):
    return Fraction(int(value["numerator"]), int(value["denominator"]))


def _count_decimal(value):
    # Admitted exposure decimals have at most 24 digits/places. Even the sum of
    # every bounded player/core miss is therefore exact at this local precision.
    with localcontext() as context:
        context.prec = 64
        return str(Decimal(value.numerator) / Decimal(value.denominator))


def _audit(indices, sets, rules, max_overlap):
    violations, targets, deviation = [], [], Fraction()
    for rule in rules:
        actual = sum(set(rule["player_ids"]).issubset(sets[index]) for index in indices)
        if not rule["minimum_count"] <= actual <= rule["maximum_count"]:
            violations.append({"id": rule["id"], "scope": rule["scope"], "actual_count": actual,
                               "minimum_count": rule["minimum_count"], "maximum_count": rule["maximum_count"]})
        if rule["target_count"] is not None:
            miss = Fraction(actual) - Fraction(Decimal(rule["target_count"]))
            deviation += abs(miss)
            targets.append({"id": rule["id"], "scope": rule["scope"], "target_count": rule["target_count"],
                            "actual_count": actual, "deviation_count": str(Decimal(actual) - Decimal(rule["target_count"]))})
    if max_overlap is not None:
        for left, right in combinations(indices, 2):
            overlap = len(sets[left] & sets[right])
            if overlap > max_overlap:
                violations.append({"scope": "overlap", "candidate_indices": [left, right],
                                   "actual_count": overlap, "maximum_count": max_overlap})
    return violations, targets, deviation


def _verify_final(report, frozen, indices, *, scenario_id, alpha, weight, objective):
    """Fail closed if the fast trial arithmetic differs from the separate adapter."""
    values = _joint_values(frozen, indices)
    metrics = _metrics(values, alpha, weight, objective)
    row = next(row for row in report["assumptions"] if row["scenario_id"] == scenario_id)
    if (metrics["net_distribution"] != row["net"] or
            float(_fraction(metrics["top_finish_fraction"])) != row["sampled_finish_fractions"]["top_k"] or
            report["stream_manifest"]["game_draw_content_id"] != frozen["stream_manifest"]["game_draw_content_id"] or
            row["field_draw_content_id"] != frozen["stream_manifest"]["field_draw_content_id"]):
        raise ValueError("Independent final joint payout verification disagreed; no selection proposal was returned.")
    return metrics


def select_contest_portfolio(bank, prepared, lineups, *, projection_scores, count, scenario_id,
        objective="conditional_mean_net", seed=0, draw_count=128, top_k=10,
        risk_alpha="0.9", risk_weight="1", player_exposure_limits=None,
        group_exposure_limits=None, locked_player_ids=(), excluded_player_ids=(),
        max_exposure=None, max_overlap=None, classic_stack_rules=None,
        block_qb_opposing_dst=True, max_per_team=None, min_salary=None, max_salary=50000,
        time_limit=8.0, trial_limit=2048):
    """Return a complete constrained research proposal, or a truthful failure.

    Exact enumeration proves the supplied pool optimum only if every combination
    was checked. Larger pools use bounded exact single-swap improvement from a
    projection baseline; the baseline's integer solver bound is never presented
    as a bound on a conditional cash/risk/coverage objective.
    """
    started = monotonic()
    bank = _verified_bank(bank)
    verified_contest_field(prepared["field"])
    payout = validate_payout_contract(prepared["payout_contract"])
    if prepared["bank_id"] != bank["content_id"] or prepared["content_id"] != _hash({
            "bank_id": bank["content_id"], "field_id": prepared["field"]["content_id"], "payout_contract": payout}):
        raise ValueError("The selected contest assumptions changed; preview and select them again.")
    count = _integer(count, "Requested portfolio count", 1, 150)
    seed = _integer(seed, "Seed", 0, 2**31 - 1)
    draw_count = _integer(draw_count, "Research draw count", 32, 256)
    top_k = _integer(top_k, "Top finish cutoff", 1, payout["entrant_count"])
    trial_limit = _integer(trial_limit, "Selection trial budget", 1, MAX_TRIALS)
    time_limit = float(_decimal(time_limit, "Selection time budget", minimum=Decimal("0.01"), maximum=Decimal(30)))
    if not isinstance(objective, str) or objective not in OBJECTIVES:
        raise ValueError("Choose an explicit conditional mean-net, loss-risk, or top-finish research objective; live expected returns are unavailable.")
    scenario_id = _id(scenario_id, "Selected field assumption")
    if scenario_id not in {row["scenario_id"] for row in prepared["field"]["scenarios"]}:
        raise ValueError("Choose one admitted opponent-field assumption before portfolio selection.")
    alpha_decimal = _decimal(risk_alpha, "CVaR alpha", minimum=Decimal(0), maximum=Decimal("0.999999999999"))
    weight_decimal = _decimal(risk_weight, "CVaR weight", minimum=Decimal(0), maximum=Decimal(1000))
    alpha, weight = Fraction(alpha_decimal), Fraction(weight_decimal)
    if payout["entrant_count"] <= count:
        raise ValueError("The actual contest needs at least one opponent beyond the requested own portfolio.")
    declared_type = prepared["field"]["contest"]["contest_type"]
    declared_entry_cap = {"single_entry": 1, "three_max": 3}.get(declared_type)
    if declared_entry_cap is not None and count > declared_entry_cap:
        raise ValueError(f"The supplied {declared_type.replace('_', ' ')} contest permits at most {declared_entry_cap} own entries.")
    if max_overlap is not None:
        max_overlap = _integer(max_overlap, "Maximum shared players", 0, 9)
    entries = _candidates(lineups, bank["pool"])
    universe = {row["player_id"] for row in bank["pool"]}
    _check_exposure_shapes(player_exposure_limits, group_exposure_limits, universe, count, max_exposure)
    locked = _ids(locked_player_ids, "Global locks", universe)
    excluded = _ids(excluded_player_ids, "Global exclusions", universe)
    if set(locked).intersection(excluded):
        raise ValueError("A player cannot be both globally locked and excluded.")
    stack_rules = _check_construction(entries, bank["pool"], locked=locked, excluded=excluded,
        classic_stack_rules=classic_stack_rules, block_qb_opposing_dst=block_qb_opposing_dst,
        max_per_team=max_per_team, min_salary=min_salary, max_salary=max_salary)
    if not isinstance(projection_scores, dict) or set(projection_scores) != {row["lineup_id"] for row in entries}:
        raise ValueError("Declare exactly one frozen projection score for every candidate lineup ID.")
    projections = {pid: _decimal(value, "Declared candidate projection", minimum=Decimal(-1000000),
                    maximum=Decimal(1000000)) for pid, value in projection_scores.items()}
    selection_seed, evaluation_seed = (_effective_seed(seed, purpose) for purpose in ("selection", "evaluation"))
    candidate_manifest = [{"lineup_id": row["lineup_id"], "player_ids": sorted(row["player_ids"]),
                           "projection_score": str(projections[row["lineup_id"]])} for row in entries]
    input_manifest = {"version": 1, "bank_id": bank["content_id"], "contest_research_id": prepared["content_id"],
        "candidates": candidate_manifest, "requested_count": count, "scenario_id": scenario_id,
        "objective": objective, "risk_alpha": str(alpha_decimal), "risk_weight": str(weight_decimal),
        "player_exposure_limits": deepcopy(player_exposure_limits or {}),
        "group_exposure_limits": deepcopy(group_exposure_limits or []), "locked_player_ids": locked,
        "excluded_player_ids": excluded, "max_exposure": max_exposure, "max_overlap": max_overlap,
        "classic_stack_rules": stack_rules, "block_qb_opposing_dst": block_qb_opposing_dst,
        "max_per_team": max_per_team, "min_salary": min_salary, "max_salary": max_salary,
        "seed": seed, "selection_seed": selection_seed, "evaluation_seed": evaluation_seed,
        "draw_count": draw_count, "top_k": top_k, "time_limit_seconds": time_limit,
        "trial_limit": trial_limit, "target_policy": TARGET_POLICY,
        "projection_source": "declared frozen candidate metadata; source authenticity unverified"}
    result = {"schema_version": SCHEMA_VERSION, "semantics": SEMANTICS, "context": deepcopy(bank["context"]),
        "bank_id": bank["content_id"], "contest_research_id": prepared["content_id"],
        "requested_count": count, "candidate_count": len(entries), "selected_count": 0, "unique_count": 0,
        "complete": False, "selected_lineup_ids": [], "selected_lineups": [],
        "objective": {"mode": objective, "risk_alpha": str(alpha_decimal), "risk_weight": str(weight_decimal),
            "loss_definition": "fees minus gross cash payouts", "units": "USD_cents",
            "target_policy": TARGET_POLICY, "top_k": top_k, "scenario_id": scenario_id,
            "coverage_definition": "at least one own entry reaches top-k, including boundary ties"},
        "constraints": [], "targets": [], "exposure_violations": [], "baseline": None, "selected": None,
        "capabilities": deepcopy(CAPABILITIES), "input_manifest": input_manifest, "manifest": _hash(input_manifest),
        "stream_manifest": {"seed": seed, "selection_seed": selection_seed, "evaluation_seed": evaluation_seed,
            "domains": {"seed_derivation": "dfs-contest-portfolio-v1", "selection": "selection",
                        "evaluation": "evaluation"}, "finalist_choice_independence_verified": False,
            "common_draws_across_candidates": True, "common_evaluation_draws_for_baseline_and_selected": True},
        "solver": {"status": "not_started", "method": None, "proven_optimal": False,
            "candidate_pool_only": True, "bound": None, "gap": None, "numerical_scaling": "exact rational cash and objective arithmetic; native feasibility uses binary MILP tolerance and independent incidence recount",
            "baseline_proven_exact": False,
            "baseline_proof_scope": "native floating MILP tolerance; exact projection and target optimum unverified",
            "baseline_bound_scope": "native minimized projection or target objective only; no bound on conditional cash, risk or coverage",
            "target_optimum_proven_exact": False,
            "target_search_scope": "exact lexicographic preference among feasible sets examined; pool target optimum requires exhaustive completion or exact zero miss",
            "target_stage_status": "not_started", "time_limit_seconds": time_limit, "trial_limit": trial_limit,
            "evaluated_feasible_sets": 0, "evaluated_trials": 0, "exhaustive_combinations": str(comb(len(entries), count)) if len(entries) >= count else "0"},
        "warnings": list(WARNINGS)}
    native_entries = [{"lineup_id": row["lineup_id"], "lineup": [{"player_id": pid} for pid in row["player_ids"]],
                       "total_points": float(projections[row["lineup_id"]])} for row in entries]
    native_start = monotonic()
    baseline = select_portfolio(native_entries, count=count, player_ids=sorted(universe),
        player_exposure_limits=player_exposure_limits, group_exposure_limits=group_exposure_limits,
        locked_player_ids=locked, max_exposure=max_exposure, max_overlap=max_overlap,
        time_limit=min(4., time_limit / 2), classic_stack_rules=stack_rules)
    native_seconds = monotonic() - native_start
    native_report = baseline["portfolio_selection"]
    rules = native_report["constraints"]
    result["constraints"] = deepcopy(rules)
    result["solver"]["baseline_status"] = native_report["solver_status"]
    has_targets = any(rule["target_count"] is not None for rule in rules)
    result["solver"]["native_target_stage_status"] = native_report.get("target_stage_status", "not_applicable" if not has_targets else "unproven")
    result["solver"]["target_stage_status"] = "unproven" if has_targets else "not_applicable"
    result["solver"]["baseline_bound"] = native_report["bound"]
    result["solver"]["baseline_gap"] = native_report["gap"]
    result["solver"]["baseline_bound_units"] = native_report.get("bound_units")
    result["solver"]["conflicts"] = deepcopy(native_report["conflicts"])
    if not baseline["complete"]:
        result["solver"]["status"] = native_report["solver_status"]
        result["error"] = baseline.get("error", "No complete constrained candidate portfolio was found.")
        result["runtime_seconds"] = monotonic() - started
        return result
    index_by_id = {row["lineup_id"]: index for index, row in enumerate(entries)}
    baseline_indices = tuple(sorted(index_by_id[row["lineup_id"]] for row in baseline["lineups"]))
    sets = [set(row["player_ids"]) for row in entries]
    violation, _, baseline_deviation = _audit(baseline_indices, sets, rules, max_overlap)
    if violation or len(baseline_indices) != count:
        raise ValueError("The initial constrained portfolio failed an independent incidence audit.")
    freeze_started = monotonic()
    frozen = _freeze(bank, prepared, entries, count=count, scenario_id=scenario_id, seed=selection_seed,
                     draw_count=draw_count, top_k=top_k, purpose="selection")
    result["solver"]["freeze_seconds"] = monotonic() - freeze_started
    result["stream_manifest"]["selection"] = deepcopy(frozen["stream_manifest"])
    search_started = monotonic()
    deadline = search_started + max(0., time_limit - native_seconds)
    trials, evaluated, reused, best = 0, 0, 0, baseline_indices
    cache, assessments = {}, {}
    # Default 0..N rows cannot fail for a complete distinct set. Keep the full
    # independent before/after audit, while each search trial checks only bounds
    # and targets that can actually distinguish candidate portfolios.
    active_rules = [rule for rule in rules if rule["minimum_count"] or
                    rule["maximum_count"] < count or rule["target_count"] is not None]
    def assess(indices):
        nonlocal trials, evaluated, reused
        trials += 1
        if indices in assessments:
            reused += 1
            return assessments[indices]
        violations, _, deviation = _audit(indices, sets, active_rules, max_overlap)
        if violations:
            assessments[indices] = None
            return None
        evaluated += 1
        metrics = _metrics(_joint_values(frozen, indices), alpha, weight, objective)
        cache[indices] = metrics
        assessments[indices] = -deviation, _fraction(metrics["objective_value"])
        return assessments[indices]
    best_value = assess(best)
    exhaustive = comb(len(entries), count) <= trial_limit
    finished, stop_reason = False, None
    if exhaustive:
        result["solver"]["method"] = "exact_joint_enumeration"
        for indices in combinations(range(len(entries)), count):
            if indices == baseline_indices:
                continue
            if trials >= trial_limit or monotonic() >= deadline:
                stop_reason = "trial_limit" if trials >= trial_limit else "time_limit"
                break
            value = assess(indices)
            if value is not None and (value > best_value or value == best_value and indices < best):
                best, best_value = indices, value
        else:
            finished = True
    else:
        result["solver"]["method"] = "exact_joint_single_swap_improvement"
        while trials < trial_limit and monotonic() < deadline:
            improved = False
            selected = set(best)
            for remove in best:
                for add in range(len(entries)):
                    if add in selected:
                        continue
                    if trials >= trial_limit or monotonic() >= deadline:
                        stop_reason = "trial_limit" if trials >= trial_limit else "time_limit"
                        break
                    indices = tuple(sorted((selected - {remove}) | {add}))
                    value = assess(indices)
                    if value is not None and (value > best_value or value == best_value and indices < best):
                        best, best_value, improved = indices, value, True
                        break
                if improved or stop_reason:
                    break
            if not improved:
                if not stop_reason:
                    stop_reason = "single_swap_local_optimum"
                break
        if stop_reason is None:
            stop_reason = "trial_limit" if trials >= trial_limit else "time_limit"
    violations, targets, deviation = _audit(best, sets, rules, max_overlap)
    if violations or len(best) != count:
        raise ValueError("The selected portfolio failed final hard-bound verification; no proposal was returned.")
    solver = result["solver"]
    solver.update(status="optimal_candidate_pool" if finished else "feasible_time_limit" if stop_reason == "time_limit" else "feasible_heuristic",
                  proven_optimal=finished, stop_reason="exhaustive_complete" if finished else stop_reason,
                  evaluated_feasible_sets=evaluated, evaluated_trials=trials,
                  reused_trial_count=reused,
                  search_seconds=monotonic() - search_started, native_seconds=native_seconds,
                  target_deviation_count=_count_decimal(deviation),
                  target_deviation_fraction={"unit": "appearances", "numerator": str(deviation.numerator), "denominator": str(deviation.denominator)})
    target_proven = has_targets and (finished or deviation == 0)
    solver.update(target_stage_status="optimal" if target_proven else "unproven" if has_targets else "not_applicable",
                  target_optimum_proven_exact=target_proven,
                  baseline_target_deviation_count=_count_decimal(baseline_deviation),
                  baseline_target_deviation_fraction={"unit": "appearances", "numerator": str(baseline_deviation.numerator), "denominator": str(baseline_deviation.denominator)})
    if finished:
        solver.update(bound=deepcopy(cache[best]["objective_value"]), gap=0,
                      bound_units=cache[best]["objective_value"]["unit"],
                      bound_scope="maximum conditional objective among hard-feasible sets achieving the minimum exact total target miss on frozen selection draws")
    selected_rows = [{"lineup_id": entries[index]["lineup_id"], "player_ids": list(entries[index]["player_ids"])} for index in best]
    baseline_rows = [{"lineup_id": entries[index]["lineup_id"], "player_ids": list(entries[index]["player_ids"])} for index in baseline_indices]
    evaluation_started = monotonic()
    selected_report = evaluate_contest_research(bank, prepared, selected_rows, seed=evaluation_seed, draw_count=draw_count, top_k=top_k)
    baseline_report = (deepcopy(selected_report) if best == baseline_indices else
        evaluate_contest_research(bank, prepared, baseline_rows, seed=evaluation_seed, draw_count=draw_count, top_k=top_k))
    eval_frozen = _freeze(bank, prepared, entries, count=count, scenario_id=scenario_id, seed=evaluation_seed,
                         draw_count=draw_count, top_k=top_k, purpose="evaluation")
    selected_eval_metrics = _verify_final(selected_report, eval_frozen, best, scenario_id=scenario_id,
                                          alpha=alpha, weight=weight, objective=objective)
    baseline_eval_metrics = _verify_final(baseline_report, eval_frozen, baseline_indices, scenario_id=scenario_id,
                                          alpha=alpha, weight=weight, objective=objective)
    solver["evaluation_seconds"] = monotonic() - evaluation_started
    result.update(complete=True, selected_count=count, unique_count=count, selected_lineups=selected_rows,
                  selected_lineup_ids=[row["lineup_id"] for row in selected_rows], targets=targets)
    def portfolio(indices, report, metrics):
        return {"lineup_ids": [entries[index]["lineup_id"] for index in indices],
                "projection_sum": str(sum((projections[entries[index]["lineup_id"]] for index in indices), Decimal(0))),
                "selection_metrics": cache[indices], "evaluation_metrics": metrics, "evaluation": report}
    result["selected"] = portfolio(best, selected_report, selected_eval_metrics)
    result["baseline"] = portfolio(baseline_indices, baseline_report, baseline_eval_metrics)
    result["stream_manifest"]["evaluation"] = deepcopy(eval_frozen["stream_manifest"])
    result["stream_manifest"]["independent_joint_payout_check_passed"] = True
    result["comparison"] = {"selection_mean_net_difference_cents": _money(
        _fraction(cache[best]["mean_net_cents"]) - _fraction(cache[baseline_indices]["mean_net_cents"])),
        "evaluation_mean_net_difference_cents": _money(
        _fraction(selected_eval_metrics["mean_net_cents"]) - _fraction(baseline_eval_metrics["mean_net_cents"])),
        "paired_draws": True, "forecast_improvement_claim": False}
    result["runtime_seconds"] = monotonic() - started
    return result
