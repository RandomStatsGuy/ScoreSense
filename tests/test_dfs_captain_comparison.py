from itertools import combinations

import pytest

from src.products import lineup_optimizer as optimizer
from src.products import dfs_captain_comparison as comparison
from test_dfs_snapshots import pool, build


@pytest.mark.parametrize("objective,column", [("median", "Projected Points"), ("floor", "Low (P10)"), ("ceiling", "High (P90)")])
def test_each_captain_matches_exhaustive_complete_lineup_search(objective, column):
    frame = pool()
    cap = 35000
    result = build(frame, objective=objective, salary_cap=cap, include_captain_comparison=True)
    report = result["captain_comparison"]
    assert report["complete"]
    assert report["snapshot_id"] == result["build_snapshot"]["id"]
    assert report["eligible_captains"] == len(frame)
    records = frame.to_dict("records")
    for candidate in report["candidates"]:
        captain = next(p for p in records if p["player_id"] == candidate["captain_id"])
        scores = [captain[column]*1.5 + sum(p[column] for p in flex)
                  for flex in combinations([p for p in records if p != captain], 5)
                  if captain["cpt_salary"] + sum(p["salary"] for p in flex) <= cap
                  and len({captain["Team"], *(p["Team"] for p in flex)}) == 2]
        if scores:
            assert candidate["status"] == "optimal"
            assert candidate["objective_score"] == pytest.approx(max(scores))
            assert candidate["result"]["validation"]["ok"]
        else:
            assert candidate["status"] == "infeasible"


def test_locks_exclusions_and_value_objective():
    result = build(objective="value", locked_player_ids=["p7"], excluded_player_ids=["p1"],
                   locked_captain_id="p3", include_captain_comparison=True)
    candidates = result["captain_comparison"]["candidates"]
    assert len(candidates) == 1
    rows = candidates[0]["result"]["lineup"]
    assert "p7" in {r["player_id"] for r in rows}
    assert "p1" not in {r["player_id"] for r in rows}
    assert rows[0]["player_id"] == "p3"
    assert candidates[0]["objective_score"] == pytest.approx(sum(r["proj"]/r["salary"]*1000 for r in rows))


@pytest.mark.parametrize("settings", [{"lineup_count": 2}, {"randomness": .1},
    {"max_exposure": .5}, {"captain_exposure_limits": {"p0": .5}}, {"require_qb_stack": True}])
def test_unsupported_comparison_settings_fail_explicitly(settings):
    with pytest.raises(ValueError, match="deterministic"):
        build(include_captain_comparison=True, **settings)


def test_classic_comparison_is_rejected():
    with pytest.raises(ValueError, match="single-game"):
        optimizer.optimize_from_pool_dataframe(pool(), site="draftkings", include_captain_comparison=True)


def test_budget_does_not_silently_prune_captains(monkeypatch):
    monkeypatch.setattr(comparison, "MAX_CAPTAINS", 2)
    report = build(include_captain_comparison=True)["captain_comparison"]
    assert not report["complete"]
    assert report["evaluated_captains"] == 0
    assert len(report["candidates"]) == 8
    assert all(row["status"] == "not_evaluated" for row in report["candidates"])


def test_solver_timeout_is_unresolved_not_infeasible(monkeypatch):
    real = optimizer.optimize_lineup
    def solve(*args, **kwargs):
        if kwargs.get("solver_time_limit") is not None:
            return {"ok": False, "solver_status": 1, "error": "Time limit"}
        return real(*args, **kwargs)
    monkeypatch.setattr(optimizer, "optimize_lineup", solve)
    report = build(include_captain_comparison=True)["captain_comparison"]
    assert not report["complete"]
    assert all(row["status"] == "unresolved" for row in report["candidates"])


def test_corrupted_candidate_fails_independent_validation(monkeypatch):
    real = optimizer.optimize_lineup
    def solve(*args, **kwargs):
        result = real(*args, **kwargs)
        if kwargs.get("solver_time_limit") is not None and result["ok"]:
            result["total_salary"] = 1
        return result
    monkeypatch.setattr(optimizer, "optimize_lineup", solve)
    report = build(include_captain_comparison=True)["captain_comparison"]
    assert not report["complete"]
    assert all(row["status"] == "invalid" for row in report["candidates"])


def test_salary_reallocation_can_beat_raw_scoring_leader():
    frame = pool().iloc[:7].copy()
    frame["Projected Points"] = [24, 18, 22, 20, 17, 16, 1]
    frame["salary"] = [10000, 6000, 9000, 8000, 7000, 6000, 1000]
    frame["cpt_salary"] = frame["salary"] * 1.5
    report = build(frame, include_captain_comparison=True)["captain_comparison"]
    assert report["complete"]
    assert report["best_evaluated_captain_id"] == "p3"
    assert report["candidates"][0]["objective_score"] == 127


def test_total_deadline_marks_remaining_captains_unexamined(monkeypatch):
    ticks = iter([0, 0, 11, 11, 11, 11, 11, 11, 11])
    monkeypatch.setattr(comparison, "monotonic", lambda: next(ticks))
    report = build(include_captain_comparison=True)["captain_comparison"]
    assert not report["complete"]
    assert report["evaluated_captains"] == 1
    assert sum(row["status"] == "not_evaluated" for row in report["candidates"]) == 7


def test_fanduel_single_uses_its_existing_mvp_rules():
    result = optimizer.optimize_from_pool_dataframe(pool(), site="fanduel_single", include_captain_comparison=True)
    assert result["captain_comparison"]["complete"]
    assert all(row["result"]["lineup"][0]["slot"] == "MVP" for row in result["captain_comparison"]["candidates"])
    assert result["captain_comparison"]["budget"] == result["build_snapshot"]["content"]["captain_comparison_budget"]
