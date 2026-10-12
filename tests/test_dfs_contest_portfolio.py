"""Synthetic candidate pools test conditional choices, never real performance."""
from copy import deepcopy
from decimal import Decimal, localcontext
from fractions import Fraction
import json
from types import SimpleNamespace

import pytest

from test_dfs_contest_research import fixture, NOW
from src.products.dfs_contest_research import prepare_contest_research
from src.products.dfs_shared_outcomes import prepare_scenario_bank
from src.products import dfs_contest_portfolio as engine


def prepared():
    raw, pool, lineups, field, payout = fixture()
    third = deepcopy(lineups[0])
    third["lineup_id"] = "no-receiver-touchdown"
    third["player_ids"] = ["mia-wr2" if pid == "buf-wr1" else pid for pid in third["player_ids"]]
    lineups.append(third)
    bank = prepare_scenario_bank(raw, context=raw["context"], pool=pool, now=NOW)
    return bank, prepare_contest_research(bank, field, payout), lineups


def run(**options):
    bank, research, lineups = prepared()
    values = dict(count=1, scenario_id=research["field"]["scenarios"][0]["scenario_id"],
                  projection_scores={row["lineup_id"]: i + 1 for i, row in enumerate(lineups)},
                  seed=42, draw_count=32, top_k=1, time_limit=8)
    values.update(options)
    return engine.select_contest_portfolio(bank, research, lineups, **values)


def money(value):
    return Fraction(int(value["numerator"]), int(value["denominator"]))


@pytest.mark.parametrize("objective", sorted(engine.OBJECTIVES))
def test_three_research_modes_return_complete_jointly_verified_choices(objective):
    result = run(objective=objective, count=2)
    assert result["schema_version"] == engine.SCHEMA_VERSION
    assert result["semantics"] == engine.SEMANTICS
    assert result["complete"] and result["selected_count"] == result["unique_count"] == 2
    assert result["candidate_count"] == 3
    assert result["solver"]["status"] == "optimal_candidate_pool"
    assert result["solver"]["proven_optimal"] is True
    assert result["solver"]["evaluated_trials"] == 3
    assert result["solver"]["gap"] == 0
    assert result["stream_manifest"]["selection_seed"] != result["stream_manifest"]["evaluation_seed"]
    assert result["stream_manifest"]["selection"]["purpose"] == "selection"
    assert result["stream_manifest"]["evaluation"]["purpose"] == "evaluation"
    assert result["stream_manifest"]["independent_joint_payout_check_passed"] is True
    assert result["capabilities"]["conditional_portfolio_selection"] is True
    assert all(result["capabilities"][key] is False for key in (
        "forward_forecast", "expected_payout", "ownership_calibrated", "joint_outcomes_calibrated",
        "platform_settlement_verified", "untouched_evaluation_verified"))
    for portfolio in (result["selected"], result["baseline"]):
        assert portfolio["evaluation"]["own_entry_count"] == 2
        assert portfolio["evaluation"]["opponent_entry_count"] == 99
        assert portfolio["evaluation"]["stream_manifest"]["game_stream_id"] == result["stream_manifest"]["evaluation"]["game_stream_id"]
    assert not result["exposure_violations"]
    json.dumps(result, allow_nan=False)


def test_mean_net_can_replace_higher_declared_projection_with_better_conditional_candidate():
    result = run()
    assert result["baseline"]["lineup_ids"] == ["no-receiver-touchdown"]
    assert result["selected_lineup_ids"] != result["baseline"]["lineup_ids"]
    assert money(result["comparison"]["selection_mean_net_difference_cents"]) > 0
    assert Decimal(result["selected"]["projection_sum"]) < Decimal(result["baseline"]["projection_sum"])


def test_reordering_candidates_preserves_manifest_and_exact_choice():
    bank, research, lineups = prepared()
    options = dict(count=2, scenario_id=research["field"]["scenarios"][0]["scenario_id"],
                   projection_scores={row["lineup_id"]: i for i, row in enumerate(lineups)},
                   seed=19, draw_count=32, top_k=1)
    first = engine.select_contest_portfolio(bank, research, lineups, **options)
    second = engine.select_contest_portfolio(bank, research, lineups[::-1], **options)
    assert first["manifest"] == second["manifest"]
    assert first["selected_lineups"] == second["selected_lineups"]
    assert first["selected"]["selection_metrics"] == second["selected"]["selection_metrics"]
    assert first["selected"]["evaluation_metrics"] == second["selected"]["evaluation_metrics"]


def test_player_and_core_hard_counts_and_fractional_soft_targets_preserved():
    result = run(count=2, player_exposure_limits={"buf-wr1": {"min": ".5", "max": ".5", "target": ".75"}},
                 group_exposure_limits=[{"id": "receivers", "player_ids": ["buf-wr1", "buf-wr2"], "max": ".5"}])
    assert result["complete"]
    sets = [set(row["player_ids"]) for row in result["selected_lineups"]]
    assert sum("buf-wr1" in row for row in sets) == 1
    assert sum({"buf-wr1", "buf-wr2"}.issubset(row) for row in sets) <= 1
    target = next(row for row in result["targets"] if row["id"] == "buf-wr1")
    assert target["actual_count"] == 1 and Decimal(target["deviation_count"]) == Decimal("-.50")
    assert result["solver"]["target_stage_status"] == "optimal"


def test_soft_target_hierarchy_precedes_conditional_cash_objective():
    result = run(player_exposure_limits={"buf-wr1": {"target": "0"}})
    assert result["complete"]
    assert result["selected_lineup_ids"] == ["no-receiver-touchdown"]
    assert result["solver"]["target_deviation_count"] == "0"
    assert money(result["comparison"]["selection_mean_net_difference_cents"]) == 0


def test_global_lock_cannot_evade_global_maximum():
    result = run(locked_player_ids=["buf-qb"], max_exposure=".5")
    assert not result["complete"] and result["selected_count"] == 0
    assert result["solver"]["status"] == "constraint_conflict"
    assert "Locked player buf-qb" in result["error"]
    assert result["selected"] is None


def test_insufficient_candidates_does_not_fill_or_claim_global_infeasibility():
    result = run(count=4)
    assert not result["complete"]
    assert result["solver"]["status"] == "insufficient_candidates"
    assert result["candidate_count"] == 3 and result["selected_lineups"] == []


def test_overlap_conflicts_do_not_relax_hard_rules():
    result = run(count=2, max_overlap=7)
    assert not result["complete"]
    assert result["solver"]["status"] == "infeasible_candidate_pool"


def test_bounded_single_swap_search_returns_feasible_with_no_optimal_bound():
    result = run(count=2, trial_limit=1)
    assert result["complete"]
    assert result["solver"]["status"] == "feasible_heuristic"
    assert result["solver"]["stop_reason"] == "trial_limit"
    assert result["solver"]["method"] == "exact_joint_single_swap_improvement"
    assert result["solver"]["proven_optimal"] is False
    assert result["solver"]["bound"] is None and result["solver"]["gap"] is None


def test_native_timeout_is_preserved_and_not_relabelled_infeasible(monkeypatch):
    monkeypatch.setattr("src.products.dfs_portfolio_selection.milp", lambda *args, **kwargs:
                        SimpleNamespace(status=1, x=None, message="Time limit"))
    result = run()
    assert not result["complete"]
    assert result["solver"]["status"] == "time_limit"


@pytest.mark.parametrize("field", ["mean_cents", "p10_cents", "min_cents"])
def test_exact_own_tie_prices_are_independently_checked_on_final_draws(monkeypatch, field):
    original = engine.evaluate_contest_research
    def corrupted(*args, **kwargs):
        result = original(*args, **kwargs)
        result["assumptions"][0]["net"][field]["numerator"] = "123456789"
        return result
    monkeypatch.setattr(engine, "evaluate_contest_research", corrupted)
    with pytest.raises(ValueError, match="Independent final joint payout"):
        run()


@pytest.mark.parametrize("key,value", [
    ("objective", "expected_net"), ("objective", "projection"),
    ("risk_alpha", True), ("risk_alpha", "nan"), ("risk_alpha", "1"), ("risk_alpha", "-0.1"),
    ("risk_weight", False), ("risk_weight", "inf"), ("risk_weight", "-1"),
    ("count", True), ("count", 0), ("count", 151), ("draw_count", 31), ("draw_count", 257),
    ("seed", -1), ("top_k", 102), ("scenario_id", "unknown"),
    ("time_limit", "nan"), ("time_limit", True), ("time_limit", 31),
    ("trial_limit", 0), ("trial_limit", 4097), ("max_overlap", True), ("max_overlap", 10),
    ("max_per_team", 0), ("max_salary", 50001), ("min_salary", 50001),
    ("block_qb_opposing_dst", "false"), ("locked_player_ids", ["unknown"]),
    ("excluded_player_ids", ["buf-qb"]), ("classic_stack_rules", {"version": 99}),
])
def test_invalid_or_unavailable_research_requests_fail_closed(key, value):
    with pytest.raises(ValueError):
        run(**{key: value})


@pytest.mark.parametrize("scores", [{}, {"first": 1}, {"first": True, "alternative": 2, "no-receiver-touchdown": 3},
    {"first": "nan", "alternative": 2, "no-receiver-touchdown": 3},
    {"first": "1000001", "alternative": 2, "no-receiver-touchdown": 3}])
def test_projection_baseline_needs_exact_finite_declared_candidate_mapping(scores):
    with pytest.raises(ValueError):
        run(projection_scores=scores)


def test_duplicate_or_illegal_candidates_are_not_pruned_or_repaired():
    bank, research, lineups = prepared()
    for mutation in ("duplicate_id", "duplicate_roster", "bad_salary"):
        rows = deepcopy(lineups)
        if mutation == "duplicate_id": rows[2]["lineup_id"] = rows[0]["lineup_id"]
        elif mutation == "duplicate_roster": rows[2]["player_ids"] = rows[0]["player_ids"]
        else: rows[2]["player_ids"][0] = "outside-pool"
        with pytest.raises(ValueError):
            engine.select_contest_portfolio(bank, research, rows,
                projection_scores={row["lineup_id"]: 1 for row in rows}, count=1,
                scenario_id=research["field"]["scenarios"][0]["scenario_id"])


def test_changed_prepared_package_or_bank_is_rejected_before_search():
    bank, research, lineups = prepared()
    for target in ("bank", "package", "payout"):
        b, r = deepcopy(bank), deepcopy(research)
        if target == "bank": b["pool"][0]["salary"] += 1
        elif target == "package": r["content_id"] = "0" * 64
        else: r["payout_contract"]["entry_fee_cents"] += 1
        with pytest.raises(ValueError):
            engine.select_contest_portfolio(b, r, lineups,
                projection_scores={row["lineup_id"]: 1 for row in lineups}, count=1,
                scenario_id=r["field"]["scenarios"][0]["scenario_id"])


def test_construction_controls_validate_each_whole_candidate():
    with pytest.raises(ValueError, match="salary range"):
        run(min_salary=46000)
    with pytest.raises(ValueError, match="salary range"):
        run(max_salary=44000)
    with pytest.raises(ValueError, match="team limit"):
        run(max_per_team=2)
    with pytest.raises(ValueError, match="Classic stack rules"):
        run(classic_stack_rules={"version": 1, "attachments": {"mode": "forbidden", "count": 0}})


def test_candidate_count_limit_is_checked_before_chunked_validation():
    bank, research, lineups = prepared()
    with pytest.raises(ValueError, match="1–600"):
        engine.select_contest_portfolio(bank, research, lineups * 201,
            projection_scores={}, count=1, scenario_id=research["field"]["scenarios"][0]["scenario_id"])


@pytest.mark.parametrize("key,value", [
    ("player_exposure_limits", []), ("player_exposure_limits", {"buf-qb": None}),
    ("player_exposure_limits", {"outside": {}}), ("player_exposure_limits", {"buf-qb": {"other": 1}}),
    ("group_exposure_limits", {}), ("group_exposure_limits", [None]),
    ("group_exposure_limits", [{"id": "x", "player_ids": None}]),
    ("group_exposure_limits", [{"id": "x", "player_ids": [["buf-qb"], "buf-rb"]}]),
    ("group_exposure_limits", [{"id": "x", "player_ids": ["buf-qb", "buf-qb"]}]),
    ("group_exposure_limits", [{"id": "x", "player_ids": ["buf-qb", "outside"]}]),
    ("group_exposure_limits", [{"id": "x", "player_ids": ["buf-qb", "buf-rb"], "other": 1}]),
    ("group_exposure_limits", [{"id": "x", "player_ids": ["buf-qb", "buf-rb"]}] * 2),
])
def test_malformed_nested_exposure_controls_raise_targeted_value_errors(key, value):
    with pytest.raises(ValueError):
        run(**{key: value})


@pytest.mark.parametrize("contest_type,count", [("single_entry", 2), ("three_max", 4)])
def test_declared_contest_entry_cap_cannot_be_exceeded(contest_type, count):
    raw, pool, lineups, field, payout = fixture()
    field["contest"]["contest_type"] = contest_type
    field["scenarios"][0]["ownership_contest_type"] = contest_type
    bank = prepare_scenario_bank(raw, context=raw["context"], pool=pool, now=NOW)
    research = prepare_contest_research(bank, field, payout)
    with pytest.raises(ValueError, match="permits at most"):
        engine.select_contest_portfolio(bank, research, lineups, projection_scores={row["lineup_id"]: 1 for row in lineups},
            count=count, scenario_id=field["scenarios"][0]["scenario_id"])


@pytest.mark.parametrize("key,value", [
    ("player_exposure_limits", {"buf-wr1": {"min": "1e-10000000"}}),
    ("player_exposure_limits", {"buf-wr1": {"max": "0." + "9" * 100}}),
    ("player_exposure_limits", {"buf-wr1": {"target": {"count": "1e-10000000"}}}),
    ("group_exposure_limits", [{"id": "pair", "player_ids": ["buf-wr1", "buf-wr2"], "min": "1e-10000000"}]),
    ("group_exposure_limits", [{"id": "pair", "player_ids": ["buf-wr1", "buf-wr2"], "max": "0." + "9" * 100}]),
    ("max_exposure", "1e-10000000"),
])
def test_exposure_precision_cannot_underflow_or_round_away_a_hard_bound(key, value):
    with pytest.raises(ValueError, match="decimal|range"):
        run(**{key: value})


def test_bounded_small_positive_minimum_still_requires_one_appearance():
    result = run(player_exposure_limits={"buf-wr1": {"min": "1e-24", "target": "0"}})
    rule = next(row for row in result["constraints"] if row["id"] == "buf-wr1")
    assert rule["minimum_count"] == 1
    assert result["complete"]
    assert "buf-wr1" in result["selected_lineups"][0]["player_ids"]


def test_bounded_near_one_maximum_still_excludes_one_appearance():
    result = run(player_exposure_limits={"buf-wr1": {"max": "0.999999999999999999999999"}})
    rule = next(row for row in result["constraints"] if row["id"] == "buf-wr1")
    assert rule["maximum_count"] == 0
    assert result["complete"]
    assert "buf-wr1" not in result["selected_lineups"][0]["player_ids"]


def test_native_milp_tolerance_does_not_become_exact_target_or_baseline_proof():
    bank, research, rows = prepared()
    rows = [rows[0], rows[2]]
    result = engine.select_contest_portfolio(bank, research, rows,
        projection_scores={"first": 1, "no-receiver-touchdown": 100}, count=1,
        scenario_id="baseline", draw_count=32, trial_limit=1,
        player_exposure_limits={"buf-wr1": {"target": "0.500000000000000000000001"},
                                "mia-wr2": {"target": "0.499999999999999999999999"}})
    # Both targets round to .5 in the native floating solve. Exact arithmetic
    # prefers the first candidate, but the limited seed keeps the higher score.
    assert result["selected_lineup_ids"] == ["no-receiver-touchdown"]
    assert result["solver"]["native_target_stage_status"] == "optimal"
    assert result["solver"]["target_stage_status"] == "unproven"
    assert result["solver"]["target_optimum_proven_exact"] is False
    assert result["solver"]["target_deviation_count"] == "1.000000000000000000000002"
    assert result["solver"]["baseline_status"] == "optimal"
    assert result["solver"]["baseline_proven_exact"] is False
    assert "floating MILP tolerance" in result["solver"]["baseline_proof_scope"]


def test_exhaustive_search_proves_exact_fractional_target_preference():
    bank, research, rows = prepared()
    rows = [rows[0], rows[2]]
    result = engine.select_contest_portfolio(bank, research, rows,
        projection_scores={"first": 1, "no-receiver-touchdown": 100}, count=1,
        scenario_id="baseline", draw_count=32,
        player_exposure_limits={"buf-wr1": {"target": "0.500000000000000000000001"},
                                "mia-wr2": {"target": "0.499999999999999999999999"}})
    assert result["selected_lineup_ids"] == ["first"]
    assert result["solver"]["target_stage_status"] == "optimal"
    assert result["solver"]["target_optimum_proven_exact"] is True
    assert result["solver"]["target_deviation_count"] == "0.999999999999999999999998"
    assert result["solver"]["baseline_proven_exact"] is False


def test_exact_zero_target_miss_proves_target_optimum_during_truncated_search():
    result = run(trial_limit=1, player_exposure_limits={"buf-wr1": {"target": "0"}})
    assert result["solver"]["status"] == "feasible_heuristic"
    assert result["solver"]["target_stage_status"] == "optimal"
    assert result["solver"]["target_optimum_proven_exact"] is True
    assert result["solver"]["target_deviation_count"] == "0"


def test_goal_bound_applies_after_exact_target_preference():
    preferred = run(player_exposure_limits={"buf-wr1": {"target": "0"}})
    unrestricted = run()
    assert preferred["solver"]["proven_optimal"] is True
    assert money(preferred["solver"]["bound"]) < money(unrestricted["solver"]["bound"])
    assert "minimum exact total target miss" in preferred["solver"]["bound_scope"]
    assert preferred["solver"]["target_deviation_fraction"] == {"unit": "appearances", "numerator": "0", "denominator": "1"}


def test_total_target_deviation_decimal_is_not_rounded_by_process_context():
    value = Fraction("100000.000000000000000000000001")
    with localcontext() as context:
        context.prec = 6
        assert engine._count_decimal(value) == "100000.000000000000000000000001"
