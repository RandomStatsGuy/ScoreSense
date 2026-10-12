"""Independent exhaustive assignment, exposure and exact-slot oracles.

Synthetic input sums test mechanics only; no actual accepted state, forecast or
conditional return is inferred from these deliberately artificial fixtures.
"""
from collections import Counter
from copy import deepcopy
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, localcontext
from fractions import Fraction
from itertools import product

import pytest

from scripts.dev.verify_dfs_late_swap import CONTEXT, SLOTS, late_swap_fixture, template_fixture
from src.products import dfs_late_swap as engine


def appearance_amount(value, count):
    return Decimal(str(value["count"])) if isinstance(value, dict) else Decimal(str(value)) * count


def exhaustive_assignments(package):
    """Enumerate tiny entry assignments without using planner helpers or reports."""
    entries = package["accepted_state"]["entries"]
    catalog = {p["player_id"]: p for p in package["catalog"]}
    controls, count = package["controls"], len(entries)
    groups = [[entry["slots"], *[candidate["slots"] for candidate in package["candidates"]
                                if candidate["entry_id"] == entry["entry_id"]]] for entry in entries]
    rules = [("player", pid, {pid}, rule) for pid, rule in controls.get("player_exposure_limits", {}).items()]
    rules += [("group", rule["id"], set(rule["player_ids"]), rule) for rule in controls.get("group_exposure_limits", [])]
    feasible = []
    for slots_by_entry in product(*groups):
        sets = [set(slots.values()) for slots in slots_by_entry]
        if any(not set(controls.get("locked_player_ids", [])).issubset(ids) or
               ids.intersection(controls.get("excluded_player_ids", [])) for ids in sets):
            continue
        valid = True
        for baseline, slots, ids in zip(entries, slots_by_entry, sets):
            if set(slots) != set(SLOTS) or len(ids) != 9 or not ids.issubset(catalog):
                valid = False
                break
            salary = sum(catalog[pid]["salary"] for pid in slots.values())
            if not controls.get("min_salary", 0) <= salary <= controls.get("max_salary", 50000):
                valid = False
            for slot, pid in slots.items():
                p = catalog[pid]
                eligible = {"RB", "WR", "TE"} if slot == "FLEX" else {slot.rstrip("123")}
                if p["position"] not in eligible:
                    valid = False
                was = baseline["slots"][slot]
                if catalog[was]["lock_state"] == "locked" and pid != was:
                    valid = False
                if p["lock_state"] == "locked" and baseline["slots"][slot] != pid:
                    valid = False
                if p["lock_state"] == "unlocked" and p["status"] != "eligible":
                    valid = False
            teams = Counter(catalog[pid]["team"] for pid in ids)
            if controls.get("max_per_team") and max(teams.values()) > controls["max_per_team"]:
                valid = False
            if len({catalog[pid]["game_id"] for pid in ids}) < 2:
                valid = False
            qb, dst = catalog[slots["QB"]], catalog[slots["DST"]]
            if controls.get("block_qb_opposing_dst", True) and dst["team"] == qb["opponent"]:
                valid = False
            native = controls.get("classic_stack_rules")
            if native:
                receiving = set(native["attachments"].get("receiving_rb_ids", []))
                attached = sum(p["team"] == qb["team"] and (p["position"] in {"WR", "TE"} or pid in receiving)
                               for pid, p in catalog.items() if pid in ids and p["position"] != "QB")
                brought = sum(catalog[pid]["team"] == qb["opponent"] and catalog[pid]["position"] != "DST"
                              for pid in ids)
                for relation, actual in ((native["attachments"], attached), (native["bring_back"], brought)):
                    mode, bound = relation["mode"], relation["count"]
                    if ((mode == "minimum" and actual < bound) or (mode == "maximum" and actual > bound) or
                        (mode == "exact" and actual != bound) or (mode == "forbidden" and actual != 0)):
                        valid = False
        if not valid:
            continue
        overlap = controls.get("max_overlap")
        if overlap is not None and any(len(first & second) > overlap
            for i, first in enumerate(sets) for second in sets[:i]):
            continue
        appearances = Counter(pid for ids in sets for pid in ids)
        if "max_exposure" in controls:
            maximum = int((Decimal(str(controls["max_exposure"])) * count).to_integral_value(rounding=ROUND_FLOOR))
            if any(value > maximum for value in appearances.values()):
                continue
        miss = Decimal(0)
        for scope, rid, members, rule in rules:
            actual = sum(members.issubset(ids) for ids in sets)
            minimum = int(appearance_amount(rule.get("min", 0), count).to_integral_value(rounding=ROUND_CEILING))
            maximum = int(appearance_amount(rule.get("max", 1), count).to_integral_value(rounding=ROUND_FLOOR))
            if not minimum <= actual <= maximum:
                valid = False
            if "target" in rule:
                miss += abs(Decimal(actual) - appearance_amount(rule["target"], count))
        if not valid:
            continue
        score = sum((Decimal(str(catalog[pid]["projection"])) for slots in slots_by_entry for pid in slots.values()
                     if catalog[pid]["lock_state"] == "unlocked"), Decimal(0))
        feasible.append((miss, -score, slots_by_entry))
    return sorted(feasible, key=lambda row: row[:2])


def run(package):
    prepared = engine.prepare_late_swap_package(package, context=CONTEXT)
    return engine.plan_late_swap(prepared), prepared


def test_maximum_bound_soft_target_sum_matches_exact_fraction_oracle():
    # Each permitted 24-digit fraction stays exact on conversion by N=150,
    # but aggregating 750 such targets needs more than Decimal's default 28
    # significant digits. Exact enumeration must retain the aggregate too.
    fraction = "0.999999999999999999999999"
    with localcontext() as context:
        context.prec = 80
        target = str(Decimal(fraction) * 150)
    audit = {"hard_counts": [{"actual_count": 0, "target_count": target} for _ in range(750)]}
    assert Fraction(engine._miss(audit)) == Fraction(fraction) * 150 * 750


@pytest.mark.parametrize("control", ["none", "overlap", "player-max", "fraction-min", "target",
    "fraction-target", "group-max", "group-target", "global-lock", "excluded", "team-limit", "salary",
    "exact-locked-stack", "forbidden-locked-stack", "required-bringback", "qb-dst-default", "qb-dst-override"])
def test_exact_small_assignment_matches_independent_oracle(control):
    package = late_swap_fixture(entry_count=3, alternatives_per_entry=4)
    controls = package["controls"]
    if control == "overlap": controls["max_overlap"] = 8
    elif control == "player-max": controls["player_exposure_limits"] = {"w4": {"max": {"count": 1}}}
    elif control == "fraction-min": controls["player_exposure_limits"] = {"rb3": {"min": "0.333333333333333333333333"}}
    elif control == "target": controls["player_exposure_limits"] = {"rb4": {"target": {"count": "1.5"}}}
    elif control == "fraction-target": controls["player_exposure_limits"] = {"rb4": {"target": "0.333333333333333333333333"}}
    elif control == "group-max": controls["group_exposure_limits"] = [{"id": "base-pair", "player_ids": ["rb1", "w2"], "max": {"count": 1}}]
    elif control == "group-target": controls["group_exposure_limits"] = [{"id": "base-pair", "player_ids": ["rb1", "w2"], "target": {"count": "2.25"}}]
    elif control == "global-lock": controls["locked_player_ids"] = ["rb3"]
    elif control == "excluded": controls["excluded_player_ids"] = ["w4"]
    elif control == "team-limit": controls["max_per_team"] = 4
    elif control == "salary":
        next(p for p in package["catalog"] if p["player_id"] == "w4")["salary"] = 14000
        controls["max_salary"] = 45000
    elif control in {"exact-locked-stack", "forbidden-locked-stack", "required-bringback"}:
        controls["classic_stack_rules"] = {"version": 1,
            "attachments": {"mode": "forbidden" if control == "forbidden-locked-stack" else "exact", "count": 0 if control == "forbidden-locked-stack" else 1, "receiving_rb_ids": []},
            "bring_back": {"mode": "minimum" if control == "required-bringback" else "optional", "count": 1 if control == "required-bringback" else 0}}
    elif control in {"qb-dst-default", "qb-dst-override"}:
        next(p for p in package["catalog"] if p["player_id"] == "d0").update(
            team="MIA", opponent="BUF", game_id="early", lock_state="locked",
            kickoff_at="2026-10-11T19:00:00Z", projection=None)
        if control == "qb-dst-override": controls["block_qb_opposing_dst"] = False
    expected = exhaustive_assignments(package)
    report, _ = run(package)
    assert report["complete"] is bool(expected)
    if not expected:
        assert not report["entries"]
        return
    actual = tuple(row["after_slots"] for row in report["entries"])
    best_assignments = [row[2] for row in expected if row[:2] == expected[0][:2]]
    assert actual in best_assignments
    assert report["audit"]["ok"] is True
    assert report["solver"]["proven_optimal"] is True


def test_pair_core_and_target_stages_cannot_drop_an_entry_or_exempt_locks():
    package = late_swap_fixture(entry_count=3, alternatives_per_entry=2)
    for entry in package["accepted_state"]["entries"]:
        package["candidates"].append({"candidate_id": f'combo-{entry["entry_id"]}', "entry_id": entry["entry_id"],
            "slots": {**entry["slots"], "RB1": "rb3", "WR2": "w4"}})
    package["controls"] = {"player_exposure_limits": {"rb3": {"min": {"count": 2}, "target": {"count": "1.5"}},
        "w4": {"max": {"count": 2}}}, "group_exposure_limits": [
        {"id": "new-pair", "player_ids": ["rb3", "w4"], "max": {"count": 1}}]}
    expected = exhaustive_assignments(package)
    report, _ = run(package)
    actual = tuple(row["after_slots"] for row in report["entries"])
    assert report["complete"] and len(actual) == 3
    assert actual in [row[2] for row in expected if row[:2] == expected[0][:2]]
    package["controls"]["player_exposure_limits"]["q0"] = {"max": {"count": 2}}
    assert exhaustive_assignments(package) == []
    failed, _ = run(package)
    assert failed["complete"] is False and failed["entries"] == []


@pytest.mark.parametrize("declared_receiving_rb", [False, True])
def test_started_receiving_rb_counts_only_with_explicit_attachment_eligibility(declared_receiving_rb):
    package = late_swap_fixture(entry_count=2, alternatives_per_entry=2)
    next(p for p in package["catalog"] if p["player_id"] == "rb1").update(
        team="BUF", opponent="MIA", game_id="early", lock_state="locked",
        kickoff_at="2026-10-11T19:00:00Z", projection=None)
    package["candidates"] = [row for row in package["candidates"] if row["slots"]["RB1"] == "rb1"]
    package["controls"] = {"classic_stack_rules": {"version": 1,
        "attachments": {"mode": "exact", "count": 2, "receiving_rb_ids": ["rb1"] if declared_receiving_rb else []},
        "bring_back": {"mode": "optional", "count": 0}}}
    expected = exhaustive_assignments(package)
    report, _ = run(package)
    assert bool(expected) is declared_receiving_rb
    assert report["complete"] is declared_receiving_rb
    if declared_receiving_rb:
        assert all(row["after_slots"]["RB1"] == "rb1" for row in report["entries"])
        assert report["audit"]["ok"] is True


def test_accepted_duplicate_rosters_remain_distinct_even_when_all_slots_locked():
    package = late_swap_fixture(entry_count=2, alternatives_per_entry=0)
    for p in package["catalog"]:
        p.update(lock_state="locked", kickoff_at="2026-10-11T19:00:00Z", projection=None)
    report, _ = run(package)
    assert report["complete"] is True
    assert len(report["entries"]) == 2
    assert report["entries"][0]["after_slots"] == report["entries"][1]["after_slots"]
    assert report["entries"][0]["entry_id"] != report["entries"][1]["entry_id"]
    assert report["changes"] == []
    assert report["audit"]["ok"] is True


def test_unlocked_compatible_reassignment_is_valid_without_manufacturing_locked_flexibility():
    package = late_swap_fixture(entry_count=1, alternatives_per_entry=0)
    slots = deepcopy(package["accepted_state"]["entries"][0]["slots"])
    slots["WR2"], slots["FLEX"] = slots["FLEX"], slots["WR2"]
    package["candidates"] = [{"candidate_id": "unlocked-permutation", "entry_id": "000001", "slots": slots}]
    report, _ = run(package)
    assert report["complete"] is True
    slots["WR1"], slots["FLEX"] = slots["FLEX"], slots["WR1"]
    with pytest.raises(ValueError):
        engine.prepare_late_swap_package(package, context=CONTEXT)


@pytest.mark.parametrize("mutation", ["baseline", "package-id", "after-slots", "entry-id", "salary", "plan-id"])
def test_internal_dry_run_rejects_stale_template_or_tampered_plan(mutation):
    package = late_swap_fixture()
    report, prepared = run(package)
    template = template_fixture(package)
    if mutation == "baseline": template = template.replace("Synthetic w0 (1003)", "Synthetic w4 (1010)")
    elif mutation == "package-id": report["package_id"] = "f" * 64
    elif mutation == "after-slots": report["entries"][0]["after_slots"]["WR1"] = "w4"
    elif mutation == "entry-id": report["entries"][0]["entry_id"] = "123456"
    elif mutation == "salary": report["entries"][0]["salary_after"] = 1
    elif mutation == "plan-id": report["plan_id"] = "f" * 64
    with pytest.raises(ValueError):
        engine.build_late_swap_csv_preview(template, prepared, report)
