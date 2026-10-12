"""Synthetic candidate universes: no private entries or forecast claims."""
from itertools import combinations
from types import SimpleNamespace

import pandas as pd
import pytest

from src.products import dfs_portfolio_selection as selection


def candidate(*ids, score=1):
    return {"ok": True, "lineup": [{"player_id": pid, "slot": str(i)} for i, pid in enumerate(ids)],
            "total_points": score}


def test_stable_decimal_lower_upper_and_soft_target():
    assert selection.exposure_counts({"min": "0.14", "max": "0.58", "target": "0.4"}, 50) == {
        "minimum_count": 7, "maximum_count": 29, "target_count": "20.0"}
    assert selection.exposure_counts({"min": "0.333", "max": "0.667"}, 150)["minimum_count"] == 50
    assert selection.exposure_counts({"min": {"count": 50}, "max": {"count": 50}, "target": {"count": 50}}, 150) == {
        "minimum_count": 50, "maximum_count": 50, "target_count": "50"}
    assert selection.exposure_counts({"target": {"count": 49.95}}, 150)["target_count"] == "49.95"


def test_global_min_target_max_and_pair_cap_are_selected_together():
    candidates = [candidate(*pair, score=10-i) for i, pair in enumerate(combinations("abcd", 2))]
    result = selection.select_portfolio(candidates, count=3, player_ids=list("abcd"),
        player_exposure_limits={"a": {"min": "0.34", "target": "0.67", "max": "1"}},
        group_exposure_limits=[{"id": "ab", "player_ids": ["a", "b"], "max": "0"}])
    assert result["ok"] and result["complete"]
    sets = [set(r["player_id"] for r in entry["lineup"]) for entry in result["lineups"]]
    assert sum("a" in ids for ids in sets) == 2
    assert not any({"a", "b"}.issubset(ids) for ids in sets)
    assert result["portfolio_selection"]["solver_status"] == "optimal"
    assert result["portfolio_selection"]["candidate_pool_only"]


def test_global_lock_is_counted_and_conflicting_cap_is_not_exempted():
    result = selection.select_portfolio([candidate("a", "b"), candidate("a", "c")],
        count=2, player_ids=list("abc"), locked_player_ids={"a"}, max_exposure="0.5")
    assert not result["ok"]
    assert result["portfolio_selection"]["solver_status"] == "constraint_conflict"
    assert "a" in result["error"]
    assert result["count"] == 0


def test_duplicates_permutations_and_shortfall_never_fill():
    result = selection.select_portfolio([candidate("a", "b"), candidate("b", "a")],
        count=2, player_ids=list("ab"))
    assert not result["ok"]
    assert result["portfolio_selection"]["solver_status"] == "insufficient_candidates"
    assert result["portfolio_selection"]["candidate_count"] == 1


def test_soft_target_miss_remains_visible_not_infeasible():
    result = selection.select_portfolio([candidate("a", "b"), candidate("a", "c")],
        count=2, player_ids=list("abc"), player_exposure_limits={"b": {"target": "1"}})
    assert result["ok"]
    target = result["portfolio_selection"]["targets"][0]
    assert target["actual_count"] == 1 and target["deviation_count"] == "-1"


def test_reordering_candidates_preserves_unique_selection_and_manifest():
    candidates = [candidate(*pair, score=i) for i, pair in enumerate(combinations("abcd", 2))]
    first = selection.select_portfolio(candidates, count=2, player_ids=list("abcd"))
    second = selection.select_portfolio(candidates[::-1], count=2, player_ids=list("abcd"))
    assert first["portfolio_selection"]["manifest"] == second["portfolio_selection"]["manifest"]
    assert first["lineups"] == second["lineups"]


def test_time_limit_is_not_infeasibility(monkeypatch):
    monkeypatch.setattr(selection, "milp", lambda *a, **k: SimpleNamespace(status=1, x=None, message="Time limit"))
    result = selection.select_portfolio([candidate("a"), candidate("b")], count=1, player_ids=list("ab"))
    assert not result["ok"]
    assert result["portfolio_selection"]["solver_status"] == "time_limit"


@pytest.mark.parametrize("projection_result", [None, SimpleNamespace(status=1, x=None)])
def test_projection_timeout_retains_verified_soft_target_incumbent(monkeypatch, projection_result):
    # The first stage proves the target optimum before the projection budget expires.
    target_result = SimpleNamespace(status=0, x=[1, 0, 0, 0], fun=0)
    results = iter([target_result, projection_result])
    monkeypatch.setattr(selection, "milp", lambda *a, **k: next(results))
    result = selection.select_portfolio([candidate("a"), candidate("b")],
        count=1, player_ids=list("ab"), player_exposure_limits={"a": {"target": "1"}})
    assert result["ok"] and result["complete"]
    assert result["lineups"][0]["lineup"][0]["player_id"] == "a"
    assert result["portfolio_selection"]["solver_status"] == "feasible_time_limit"
    assert result["portfolio_selection"]["incumbent_stage"] == "soft_targets"
    assert result["portfolio_selection"]["targets"][0]["deviation_count"] == "0"


def test_overlapping_hard_groups_report_candidate_pool_infeasibility():
    candidates = [candidate(*pair) for pair in combinations("abcd", 2)]
    result = selection.select_portfolio(candidates, count=2, player_ids=list("abcd"),
        group_exposure_limits=[{"id": "ab", "player_ids": ["a", "b"], "min": "1"},
                               {"id": "cd", "player_ids": ["c", "d"], "min": "1"}])
    assert not result["ok"]
    assert result["portfolio_selection"]["solver_status"] == "infeasible_candidate_pool"


@pytest.mark.parametrize("limits", [{"min": "nan"}, {"max": "1.1"}, {"min": ".8", "max": ".2"}])
def test_invalid_bounds_reject(limits):
    with pytest.raises(ValueError):
        selection.exposure_counts(limits, 10)


def classic_pool():
    rows = []
    for pos, n, score in [("QB", 4, 22), ("RB", 10, 18), ("WR", 14, 17), ("TE", 7, 13), ("DST", 4, 8)]:
        for i in range(n):
            team = ["BUF", "NYJ", "MIA", "NE"][i % 4]
            opponent = {"BUF": "NYJ", "NYJ": "BUF", "MIA": "NE", "NE": "MIA"}[team]
            rows.append({"player_id": f"{pos}{i}", "Player": f"Synthetic {pos} {i}",
                "Position": pos, "Team": team, "Opponent": opponent, "salary": 4500,
                "dfs_id": str(10000 + len(rows)), "Projected Points": score-i*.29,
                "Low (P10)": score-5-i*.29, "High (P90)": score+7-i*.29})
    return pd.DataFrame(rows)


def test_classic_pipeline_constraints_projections_and_snapshot_are_preserved():
    from src.products.lineup_optimizer import optimize_from_pool_dataframe
    frame = classic_pool()
    original = frame.copy(deep=True)
    result = optimize_from_pool_dataframe(frame, site="draftkings", portfolio_mode="global",
        lineup_count=6, max_overlap=7, max_exposure=.84, seed=17,
        player_exposure_limits={"QB0": {"min": {"count": 2}, "target": {"count": 3}, "max": {"count": 4}}},
        group_exposure_limits=[{"id": "rb-pair", "player_ids": ["RB0", "RB1"], "max": {"count": 2}}])
    assert result["ok"] and result["validation"]["ok"]
    assert result["count"] == 6
    assert not any(audit["conflicts"] or audit["unknown"] for audit in result["portfolio_selection"]["strategy_audit"])
    assert all(row["count"] <= 5 for row in result["exposure"])
    qb = next(row for row in result["exposure"] if row["player_id"] == "QB0")
    assert 2 <= qb["count"] <= 4
    assert result["build_snapshot"]["content"]["parameters"]["seed"] == 17
    assert result["build_snapshot"]["content"]["engine"]["version"] == "global_candidate_milp_v1"
    pd.testing.assert_frame_equal(frame, original)


def test_qb_opposing_dst_safety_block_and_explicit_override():
    from src.products.lineup_optimizer import optimize_from_pool_dataframe
    frame = classic_pool()
    kwargs = dict(site="draftkings", portfolio_mode="global", lineup_count=1, max_overlap=8,
                  locked_player_ids=["QB0", "DST1"])
    blocked = optimize_from_pool_dataframe(frame, **kwargs)
    assert not blocked["ok"]
    allowed = optimize_from_pool_dataframe(frame, block_qb_opposing_dst=False, **kwargs)
    assert allowed["ok"]
    assert allowed["portfolio_selection"]["strategy_audit"][0]["conflicts"] == [["QB0", "DST1"]]
    assert allowed["build_snapshot"]["content"]["parameters"]["block_qb_opposing_dst"] is False


def test_unknown_opponents_do_not_silently_pass_default_guard():
    from src.products.lineup_optimizer import optimize_from_pool_dataframe
    frame = classic_pool().drop(columns=["Opponent"])
    result = optimize_from_pool_dataframe(frame, site="draftkings", portfolio_mode="global", lineup_count=1)
    assert not result["ok"]


def test_independent_final_strategy_audit_rejects_generator_policy_failure(monkeypatch):
    from src.products import lineup_optimizer as optimizer
    frame = classic_pool()
    players = optimizer._players_from_pool(frame)
    # Simulate a faulty generator ignoring its policy constraints.
    invalid = optimizer.optimize_lineup(players, roster={"qb": 1, "rb": 2, "wr": 3, "te": 1, "flex": 1, "dst": 1},
        salary_cap=50000, locked_player_ids={"QB0", "DST1"})
    assert invalid["ok"]
    monkeypatch.setattr(optimizer, "optimize_lineup", lambda *args, **kwargs: invalid)
    monkeypatch.setattr(selection, "GENERATION_SECONDS", .2)
    result = selection.generate_global_portfolio(players, count=1, max_overlap=8,
        roster={"qb": 1, "rb": 2, "wr": 3, "te": 1, "flex": 1, "dst": 1}, salary_cap=50000)
    assert not result["ok"] and not result["exposure_valid"]
    assert "independent" in result["error"]


def test_global_count_150_40_percent_target_and_no_repeats():
    # 450 unique candidates; selected incidences are independently counted.
    candidates = [candidate("preferred" if i < 150 else "other", f"p{i}", score=100-i*.01) for i in range(450)]
    result = selection.select_portfolio(candidates, count=150,
        player_ids=["preferred", "other", *(f"p{i}" for i in range(450))],
        player_exposure_limits={"preferred": {"min": ".3", "target": ".4", "max": ".5"}})
    assert result["ok"] and result["count"] == 150
    assert next(row for row in result["exposure"] if row["player_id"] == "preferred")["count"] == 60
    assert len({tuple(sorted(r["player_id"] for r in entry["lineup"])) for entry in result["lineups"]}) == 150


@pytest.mark.parametrize("site", ["seasonal", "draftkings_showdown", "fanduel_single"])
def test_unsupported_global_formats_fail_before_generation(site):
    from src.products.lineup_optimizer import optimize_from_pool_dataframe
    with pytest.raises(ValueError, match="Classic"):
        optimize_from_pool_dataframe(classic_pool(), site=site, portfolio_mode="global")


def test_global_classic_cannot_raise_platform_salary_maximum():
    from src.products.lineup_optimizer import optimize_from_pool_dataframe
    with pytest.raises(ValueError, match="site maximum"):
        optimize_from_pool_dataframe(classic_pool(), site="draftkings", portfolio_mode="global", salary_cap=50001)


def test_api_preserves_exact_counts_and_global_snapshot(monkeypatch):
    import app.api as api
    frame = classic_pool()
    seen = {}
    def load_pool(**kwargs):
        seen.update(kwargs)
        return frame, {"season": 2026, "week": 1}
    monkeypatch.setattr(api, "build_lineup_pool", load_pool)
    request = api.LineupOptimizeRequest(site="draftkings", portfolio_mode="global", lineup_count=3,
        max_overlap=8, player_exposure_limits={"QB0": {"min": {"count": 1}, "max": {"count": 2}}})
    result = api.lineup_optimize(request, {})
    assert result["ok"] and result["count"] == 3
    assert "QB0" in seen["keep_player_ids"]
    assert result["build_snapshot"]["content"]["parameters"]["player_exposure_limits"] == request.player_exposure_limits


def test_api_invalid_global_count_does_not_silently_clamp(monkeypatch):
    import app.api as api
    from fastapi import HTTPException
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kwargs: pytest.fail("Invalid count must not fetch forecasts"))
    with pytest.raises(HTTPException, match="whole number"):
        api.lineup_optimize(api.LineupOptimizeRequest(site="draftkings", portfolio_mode="global", lineup_count=151), {})


@pytest.mark.parametrize("members", [None, "QB0", ["QB0", 5], ["QB0", "QB0"]])
def test_api_invalid_group_shape_returns_400_before_pool_fetch(monkeypatch, members):
    import app.api as api
    from fastapi import HTTPException
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kwargs: pytest.fail("Invalid group must not fetch forecasts"))
    with pytest.raises(HTTPException) as error:
        api.lineup_optimize(api.LineupOptimizeRequest(site="draftkings", portfolio_mode="global",
            group_exposure_limits=[{"id": "core", "player_ids": members}]), {})
    assert error.value.status_code == 400
