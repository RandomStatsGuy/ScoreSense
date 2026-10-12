"""Synthetic exact-slot and declaration gates; no real entry acceptance claims."""
from copy import deepcopy
import csv
from decimal import Decimal
import io
from types import SimpleNamespace

import numpy as np
import pytest

from scripts.dev.verify_dfs_late_swap import late_swap_fixture, template_fixture
from src.products import dfs_late_swap as engine


def prepared(**kwargs):
    return engine.prepare_late_swap_package(late_swap_fixture(**kwargs))


def test_complete_plan_retains_all_entries_and_exact_started_slots_without_mutation():
    raw = late_swap_fixture()
    original = deepcopy(raw)
    package = engine.prepare_late_swap_package(raw)
    frozen = deepcopy(package)
    preview = engine.late_swap_summary(package)
    report = engine.plan_late_swap(package)
    assert raw == original and package == frozen
    assert preview["entry_count"] == report["requested_count"] == report["selected_count"] == 2
    assert preview["candidate_count"] == 4 and preview["locked_slot_count"] == 4
    assert report["complete"] and report["audit"]["ok"] and report["audit"]["locked_slots_preserved"]
    assert report["solver"]["status"] == "optimal_candidate_pool"
    assert report["solver"]["proven_optimal"] is True
    assert report["solver"]["evaluated_trials"] == 9
    assert Decimal(report["proposed"]["projection_sum"]) > Decimal(report["baseline"]["projection_sum"])
    for entry in report["entries"]:
        assert entry["locked_slots"] == {"QB": "q0", "WR1": "w0"}
        assert entry["before_slots"]["WR1"] == entry["after_slots"]["WR1"] == "w0"
        assert entry["salary_before"] == entry["salary_after"] == 36000
    assert all(not report["capabilities"][key] for key in ("accepted_readback_authenticated", "current_lock_verified", "platform_export_ready", "conditional_remaining_evaluation", "expected_payout"))


def test_repeated_accepted_rosters_preserved_and_all_locked_appearances_count():
    raw = late_swap_fixture(entry_count=3, alternatives_per_entry=0)
    package = engine.prepare_late_swap_package(raw)
    report = engine.plan_late_swap(package)
    assert report["complete"] and report["selected_count"] == 3 and report["unique_count"] == 1
    assert [row["entry_id"] for row in report["entries"]] == ["000001", "000002", "000003"]
    assert next(row for row in report["audit"]["hard_counts"] if row["id"] == "w0")["actual_count"] == 3
    raw["controls"] = {"player_exposure_limits": {"w0": {"max": ".5"}}}
    blocked = engine.plan_late_swap(engine.prepare_late_swap_package(raw))
    assert not blocked["complete"] and blocked["selected_count"] == 0
    assert blocked["solver"]["status"] == "infeasible_candidate_pool"


@pytest.mark.parametrize("slot", ["WR2", "WR3", "FLEX"])
def test_locked_wr_cannot_move_to_another_exact_wr_or_flex_slot(slot):
    raw = late_swap_fixture()
    candidate = raw["candidates"][0]["slots"]
    candidate["WR1"], candidate[slot] = candidate[slot], candidate["WR1"]
    with pytest.raises(ValueError, match="locked player identity or exact slot"):
        engine.prepare_late_swap_package(raw)


def test_started_incoming_player_not_in_original_entry_is_rejected():
    raw = late_swap_fixture()
    extra = {**raw["catalog"][3], "player_id": "other-early-wr", "dfs_id": "9898", "name": "Other started WR"}
    raw["catalog"].append(extra)
    raw["candidates"][0]["slots"]["WR2"] = "other-early-wr"
    with pytest.raises(ValueError, match="adds or moves a started player"):
        engine.prepare_late_swap_package(raw)


def test_unlocked_wr_flex_permutation_is_valid_and_keeps_early_wr_in_place():
    raw = late_swap_fixture(entry_count=1, alternatives_per_entry=1)
    slots = raw["candidates"][0]["slots"]
    slots["WR2"], slots["FLEX"] = slots["FLEX"], slots["WR2"]
    report = engine.plan_late_swap(engine.prepare_late_swap_package(raw))
    assert report["complete"] and report["entries"][0]["after_slots"]["WR1"] == "w0"
    assert report["entries"][0]["candidate_id"].startswith("synthetic-")


@pytest.mark.parametrize("mutation", ["lock-unknown", "kickoff-missing", "kickoff-naive", "locked-future", "unlocked-past", "game-lock-mismatch",
    "source-future", "lock-source-old", "readback-hash", "readback-time", "readback-source", "contest-disabled", "contest-global", "context-mismatch",
    "numeric-entry", "numeric-dfs", "salary-bool", "salary-float", "duplicate-canonical", "duplicate-dfs", "duplicate-entry", "duplicate-candidate",
    "duplicate-player", "slot-extra", "slot-missing", "wrong-slot", "over-cap", "missing-right", "denied-right", "unknown-control", "player-bounds-null",
    "groups-null", "projection-null", "projection-nan", "projection-bool", "projection-precision", "top-extra", "player-extra", "candidate-unknown-entry"])
def test_malformed_or_unreliable_snapshot_rejects_atomically(mutation):
    raw = late_swap_fixture()
    if mutation == "lock-unknown": raw["catalog"][1]["lock_state"] = "unknown"
    elif mutation == "kickoff-missing": raw["catalog"][1]["kickoff_at"] = None
    elif mutation == "kickoff-naive": raw["catalog"][1]["kickoff_at"] = "2026-10-11T22:00:00"
    elif mutation == "locked-future": raw["catalog"][0]["kickoff_at"] = "2026-10-11T22:00:00Z"
    elif mutation == "unlocked-past": raw["catalog"][1]["kickoff_at"] = "2026-10-11T19:00:00Z"
    elif mutation == "game-lock-mismatch": raw["catalog"][1]["kickoff_at"] = "2026-10-11T23:00:00Z"
    elif mutation == "source-future": raw["sources"][1]["as_of"] = "2026-10-11T21:00:00Z"
    elif mutation == "lock-source-old": raw["sources"][3]["as_of"] = "2026-10-11T19:59:00Z"
    elif mutation == "readback-hash": raw["accepted_state"]["readback_sha256"] = "a" * 64
    elif mutation == "readback-time": raw["accepted_state"]["as_of"] = "2026-10-11T19:59:00Z"
    elif mutation == "readback-source": raw["accepted_state"]["source_id"] = "rules"
    elif mutation == "contest-disabled": raw["contest"]["late_swap_enabled"] = False
    elif mutation == "contest-global": raw["contest"]["lock_policy"] = "slate"
    elif mutation == "context-mismatch": raw["context"]["site"] = "fanduel"
    elif mutation == "numeric-entry": raw["accepted_state"]["entries"][0]["entry_id"] = 1
    elif mutation == "numeric-dfs": raw["catalog"][0]["dfs_id"] = 1000
    elif mutation == "salary-bool": raw["catalog"][0]["salary"] = True
    elif mutation == "salary-float": raw["catalog"][0]["salary"] = 4000.0
    elif mutation == "duplicate-canonical": raw["catalog"][1]["player_id"] = raw["catalog"][0]["player_id"]
    elif mutation == "duplicate-dfs": raw["catalog"][1]["dfs_id"] = raw["catalog"][0]["dfs_id"]
    elif mutation == "duplicate-entry": raw["accepted_state"]["entries"][1]["entry_id"] = "000001"
    elif mutation == "duplicate-candidate": raw["candidates"][1]["candidate_id"] = raw["candidates"][0]["candidate_id"]
    elif mutation == "duplicate-player": raw["candidates"][0]["slots"]["RB2"] = raw["candidates"][0]["slots"]["RB1"]
    elif mutation == "slot-extra": raw["candidates"][0]["slots"]["WR4"] = "w4"
    elif mutation == "slot-missing": del raw["candidates"][0]["slots"]["FLEX"]
    elif mutation == "wrong-slot": raw["candidates"][0]["slots"]["TE"], raw["candidates"][0]["slots"]["WR2"] = "w2", "t0"
    elif mutation == "over-cap": raw["catalog"][0]["salary"] = 50000
    elif mutation == "missing-right": del raw["sources"][0]["rights"]["display"]
    elif mutation == "denied-right": raw["sources"][0]["rights"]["hosted_ingestion"] = False
    elif mutation == "unknown-control": raw["controls"]["skip_hard_limits"] = True
    elif mutation == "player-bounds-null": raw["controls"]["player_exposure_limits"] = None
    elif mutation == "groups-null": raw["controls"]["group_exposure_limits"] = None
    elif mutation == "projection-null": raw["catalog"][1]["projection"] = None
    elif mutation == "projection-nan": raw["catalog"][1]["projection"] = "NaN"
    elif mutation == "projection-bool": raw["catalog"][1]["projection"] = True
    elif mutation == "projection-precision": raw["catalog"][1]["projection"] = "0.0000000000001"
    elif mutation == "top-extra": raw["submit"] = True
    elif mutation == "player-extra": raw["catalog"][0]["url"] = "private"
    elif mutation == "candidate-unknown-entry": raw["candidates"][0]["entry_id"] = "999"
    before = deepcopy(raw)
    with pytest.raises(ValueError):
        engine.prepare_late_swap_package(raw)
    assert raw == before


def test_unknown_or_inactive_unstarted_status_is_explicit_option_rejection():
    raw = late_swap_fixture(entry_count=1)
    next(row for row in raw["catalog"] if row["player_id"] == "rb3")["status"] = "unknown"
    report = engine.plan_late_swap(engine.prepare_late_swap_package(raw))
    assert report["complete"]
    rejected = next(row for row in report["rejected_options"] if row["candidate_id"] == "synthetic-000001-0")
    assert rejected["issues"] == ["unstarted_status_not_declared_eligible"]
    assert report["entries"][0]["candidate_id"] != rejected["candidate_id"]


def test_strategy_conflict_receipts_and_no_silent_relaxation():
    raw = late_swap_fixture()
    raw["controls"] = {"excluded_player_ids": ["w0"]}
    package = engine.prepare_late_swap_package(raw)
    preview = engine.late_swap_summary(package)
    report = engine.plan_late_swap(package)
    assert len(preview["rejected_options"]) == 6
    assert report["solver"]["status"] == "constraint_conflict" and not report["complete"]
    assert report["entries"] == [] and report["selected_count"] == 0


def test_soft_target_precedes_higher_player_input_sum_and_global_pair_limit():
    raw = late_swap_fixture(entry_count=2, alternatives_per_entry=2)
    raw["controls"] = {"player_exposure_limits": {"rb3": {"target": {"count": "1"}}},
                       "group_exposure_limits": [{"id": "late-receivers", "player_ids": ["w4", "flex"], "max": {"count": 1}}]}
    report = engine.plan_late_swap(engine.prepare_late_swap_package(raw))
    assert report["complete"] and report["solver"]["target_deviation_count"] == "0"
    assert sum("rb3" in row["after_slots"].values() for row in report["entries"]) == 1
    assert sum({"w4", "flex"}.issubset(row["after_slots"].values()) for row in report["entries"]) <= 1


def test_reordered_inputs_keep_frozen_package_and_selection_stable():
    raw = late_swap_fixture()
    one = engine.prepare_late_swap_package(raw)
    raw["sources"].reverse(); raw["catalog"].reverse(); raw["candidates"].reverse(); raw["accepted_state"]["entries"].reverse()
    two = engine.prepare_late_swap_package(raw)
    assert one == two
    first, second = engine.plan_late_swap(one), engine.plan_late_swap(two)
    assert first["plan_id"] == second["plan_id"] and first["entries"] == second["entries"]


def test_changed_frozen_inputs_and_wrong_context_are_rejected():
    package = prepared()
    package["content"]["catalog"][0]["salary"] += 1
    with pytest.raises(ValueError, match="changed"):
        engine.plan_late_swap(package)
    with pytest.raises(ValueError, match="context"):
        engine.prepare_late_swap_package(late_swap_fixture(), context={**late_swap_fixture()["context"], "slate_id": "other"})


def test_plan_pins_exact_engine_and_numerical_runtime_versions():
    report = engine.plan_late_swap(prepared())
    assert report["input_manifest"]["engine"] == {"version": engine.ENGINE_VERSION,
        "numpy": engine.np.__version__, "scipy": engine.scipy.__version__}
    assert report["input_manifest"]["catalog_id"] and report["input_manifest"]["controls_id"]


@pytest.mark.parametrize("line_end,bom", [("\r\n", True), ("\n", False), ("\r\n", False)])
def test_internal_csv_round_trip_preserves_exact_locked_cells_metadata_and_unselected_rows(line_end, bom):
    raw = late_swap_fixture()
    package = engine.prepare_late_swap_package(raw)
    report = engine.plan_late_swap(package)
    template = template_fixture(raw).replace("\r\n", line_end)
    if bom: template = "\ufeff" + template
    result = engine.build_late_swap_csv_preview(template, package, report)
    before = list(csv.reader(io.StringIO(template.lstrip("\ufeff"), newline="")))
    after = list(csv.reader(io.StringIO(result["csv"], newline="")))
    assert before[0] == after[0] and before[1] == after[1] and before[-1] == after[-1]
    for old, new in zip(before[2:-1], after[2:-1]):
        assert old[:4] == new[:4] and old[13:] == new[13:]
        assert old[4] == new[4] and old[7] == new[7]
    assert result["manifest"]["round_trip_passed"] and result["manifest"]["metadata_preserved"]
    assert result["manifest"]["platform_export_ready"] is False


@pytest.mark.parametrize("mutation", ["baseline-slot", "contest", "missing-entry", "duplicate-entry", "header-order", "plan-slot", "plan-hash", "incomplete-plan"])
def test_csv_preview_rejects_wrong_baseline_or_changed_plan(mutation):
    raw = late_swap_fixture()
    package = engine.prepare_late_swap_package(raw)
    report = engine.plan_late_swap(package)
    rows = list(csv.reader(io.StringIO(template_fixture(raw), newline="")))
    if mutation == "baseline-slot": rows[2][7], rows[2][11] = rows[2][11], rows[2][7]
    elif mutation == "contest": rows[2][1] = "999"
    elif mutation == "missing-entry": rows.pop(2)
    elif mutation == "duplicate-entry": rows.append(deepcopy(rows[2]))
    elif mutation == "header-order": rows[0][7], rows[0][10] = rows[0][10], rows[0][7]
    elif mutation == "plan-slot": report["entries"][0]["after_slots"]["WR1"] = "w2"
    elif mutation == "plan-hash": report["plan_id"] = "0" * 64
    elif mutation == "incomplete-plan": report["complete"] = False
    output = io.StringIO(newline="")
    csv.writer(output).writerows(rows)
    with pytest.raises(ValueError):
        engine.build_late_swap_csv_preview(output.getvalue(), package, report)


@pytest.mark.parametrize("mutation", ["salary", "dfs-id", "before-slots", "projection", "change-diff"])
def test_resealed_untrusted_report_cannot_change_frozen_entry_facts(mutation):
    raw = late_swap_fixture()
    package = engine.prepare_late_swap_package(raw)
    report = engine.plan_late_swap(package)
    entry = report["entries"][0]
    if mutation == "salary": entry["salary_after"] += 1
    elif mutation == "dfs-id": entry["lineup"][0]["dfs_id"] = "9999"
    elif mutation == "before-slots": entry["before_slots"]["WR1"] = "w2"
    elif mutation == "projection": entry["projection_after"] = "99999"
    elif mutation == "change-diff": entry["changes"] = []
    # Content hashes detect accidental edits; they never grant authority to an
    # imported report, even when an attacker recomputes one.
    report["plan_id"] = engine._report_id(report)
    with pytest.raises(ValueError, match="frozen identities"):
        engine.build_late_swap_csv_preview(template_fixture(raw), package, report)


def test_milp_numerical_certificate_does_not_become_exact_proof():
    package = prepared(entry_count=10, alternatives_per_entry=2)
    report = engine.plan_late_swap(package)
    assert report["complete"] and report["audit"]["ok"]
    assert report["solver"]["method"] == "bounded_per_entry_candidate_milp"
    assert report["solver"]["status"] == "feasible_candidate_pool"
    assert report["solver"]["numerical_optimal"] is True and report["solver"]["proven_optimal"] is False


def test_milp_fractional_incumbent_cannot_pass_independent_audit(monkeypatch):
    package = prepared(entry_count=10, alternatives_per_entry=2)
    def fake(*args, **kwargs):
        return SimpleNamespace(status=0, x=np.full(30, .5), mip_dual_bound=0, mip_gap=0)
    monkeypatch.setattr(engine, "milp", fake)
    report = engine.plan_late_swap(package)
    assert not report["complete"] and report["selected_count"] == 0
    assert report["solver"]["status"] == "solver_error"


def test_milp_timeout_with_complete_audited_incumbent_keeps_feasible_status(monkeypatch):
    package = prepared(entry_count=10, alternatives_per_entry=2)
    options = engine._options(package["content"])
    x = np.array([1.0 if row["candidate_id"].startswith("baseline:") else 0.0 for row in options])
    monkeypatch.setattr(engine, "milp", lambda *args, **kwargs: SimpleNamespace(status=1, x=x, mip_dual_bound=None, mip_gap=None))
    report = engine.plan_late_swap(package)
    assert report["complete"] and report["audit"]["ok"]
    assert report["solver"]["status"] == "feasible_time_limit" and not report["solver"]["proven_optimal"]


def test_numerical_score_stage_cannot_worsen_tiny_exact_target_preference(monkeypatch):
    raw = late_swap_fixture(entry_count=10, alternatives_per_entry=2)
    raw["controls"] = {"player_exposure_limits": {"rb3": {"target": {"count": "0.500000000000000000000001"}}}}
    package = engine.prepare_late_swap_package(raw)
    options = engine._options(package["content"])
    target_x = np.array([1.0 if row["candidate_id"].startswith("baseline:") else 0.0 for row in options] + [0., 0.])
    baseline_index = next(i for i, row in enumerate(options) if row["candidate_id"] == "baseline:000001")
    rb_index = next(i for i, row in enumerate(options) if row["candidate_id"] == "synthetic-000001-0")
    target_x[baseline_index], target_x[rb_index] = 0., 1.
    score_x = np.array([1.0 if row["candidate_id"].startswith("baseline:") else 0.0 for row in options] + [0., 0.])
    results = iter([SimpleNamespace(status=0, x=target_x, fun=.5),
                    SimpleNamespace(status=0, x=score_x, mip_dual_bound=-350., mip_gap=0.)])
    monkeypatch.setattr(engine, "milp", lambda *args, **kwargs: next(results))
    report = engine.plan_late_swap(package)
    assert report["complete"] and sum("rb3" in row["after_slots"].values() for row in report["entries"]) == 1
    assert report["solver"]["score_stage_candidate_rejected"] == "worse_exact_target_miss"
    assert not report["solver"]["numerical_optimal"] and report["solver"]["bound"] is report["solver"]["gap"] is None


@pytest.mark.parametrize("mutation", ["space-time", "week-date", "overflow-time", "offset-overflow", "offset-minute-rollover", "long-source-id", "unknown-team", "global-max-count"])
def test_strict_timestamp_identity_and_global_fraction_contracts(mutation):
    raw = late_swap_fixture()
    if mutation == "space-time": raw["decision_at"] = "2026-10-11 20:00:00Z"
    elif mutation == "week-date": raw["decision_at"] = "2026-W41-7T20:00:00Z"
    elif mutation == "overflow-time": raw["decision_at"] = "9999-12-31T23:59:59-01:00"
    elif mutation == "offset-overflow": raw["decision_at"] = "2026-10-11T20:00:00+99:00"
    elif mutation == "offset-minute-rollover": raw["decision_at"] = "2026-10-11T20:00:00+01:99"
    elif mutation == "long-source-id": raw["sources"][0]["source_id"] = "x" * 101
    elif mutation == "unknown-team": raw["catalog"][0]["team"] = "XYZ"
    elif mutation == "global-max-count": raw["controls"]["max_exposure"] = {"count": 1}
    with pytest.raises(ValueError):
        engine.prepare_late_swap_package(raw)


@pytest.mark.parametrize("seconds", [0, -1, True, float("inf"), 61])
def test_invalid_search_budgets_rejected(seconds):
    with pytest.raises(ValueError, match="time limit"):
        engine.plan_late_swap(prepared(), time_limit=seconds)
