"""Synthetic complete-roster comparisons; no simulated outcomes or paid data."""
from itertools import combinations

import pandas as pd
import pytest

from src.products import dfs_classic_comparison as comparison
from src.products import lineup_optimizer as optimizer


def pool():
    specs = [("qA", "QB", "BUF", "KC", 22), ("qB", "QB", "KC", "BUF", 19),
             ("rA", "RB", "BUF", "KC", 17), ("rB", "RB", "KC", "BUF", 16),
             ("rC", "RB", "SEA", "LAR", 15), ("rD", "RB", "LAR", "SEA", 13),
             ("wA", "WR", "BUF", "KC", 18), ("wA2", "WR", "BUF", "KC", 12),
             ("wB", "WR", "KC", "BUF", 14), ("wB2", "WR", "KC", "BUF", 11),
             ("wC", "WR", "SEA", "LAR", 15), ("tA", "TE", "BUF", "KC", 10),
             ("tB", "TE", "KC", "BUF", 9), ("dA", "DST", "BUF", "KC", 8),
             ("dB", "DST", "KC", "BUF", 7), ("dC", "DST", "SEA", "LAR", 6)]
    return pd.DataFrame([{"player_id": pid, "Player": pid, "Position": pos, "Team": team,
        "Opponent": opponent, "Projected Points": proj + .001 * i, "Low (P10)": proj - 4,
        "High (P90)": proj + 6, "salary": 4000 + (i % 4) * 500, "dfs_id": str(i + 1),
        "Injury Status": "", "on_bye": False} for i, (pid, pos, team, opponent, proj) in enumerate(specs)])


def request(id="one", qb="qA", mode="exact", count=1, bring="optional", rb=()):
    return {"id": id, "qb_id": qb, "attachments": {"mode": mode, "count": count, "receiving_rb_ids": list(rb)},
            "bring_back": {"mode": bring, "count": 1 if bring == "minimum" else 0}}


def test_exact_attachment_matches_exhaustive_complete_nine_player_alternatives():
    frame = pool()
    report = comparison.compare_classic_lineups(frame, requests=[request()], completions=2)
    row = report["candidates"][0]
    assert row["status"] == "optimal"
    candidates = []
    for chosen in combinations(frame.to_dict("records"), 9):
        ids = {p["player_id"] for p in chosen}
        counts = {pos: sum(p["Position"] == pos for p in chosen) for pos in ("QB", "RB", "WR", "TE", "DST")}
        attachments = sum(p["Team"] == "BUF" and p["Position"] in {"WR", "TE"} for p in chosen)
        if ("qA" in ids and counts["QB"] == counts["DST"] == 1 and counts["RB"] >= 2 and
                counts["WR"] >= 3 and counts["TE"] >= 1 and sum(p["salary"] for p in chosen) <= 50000 and
                attachments == 1 and "dB" not in ids):
            candidates.append(sum(p["Projected Points"] for p in chosen))
    assert row["objective_score"] == pytest.approx(max(candidates))
    assert len(row["result"]["lineup"]) == 9 and row["result"]["validation"]["ok"]
    assert len(row["completions"]) == 2
    assert len({tuple(sorted(p["player_id"] for p in entry["result"]["lineup"])) for entry in row["completions"]}) == 2
    assert row["stack_audit"]["attachments"]["actual_count"] == 1
    assert report["semantics"] == "sum_of_player_objective_inputs_not_lineup_quantile_or_expected_payout"


def test_locks_receiving_rb_bringback_and_original_rules_are_all_retained():
    report = comparison.compare_classic_lineups(pool(), requests=[request(rb=["rA"], bring="minimum")],
        locked_player_ids=["rA", "rB"], excluded_player_ids=["wA"], completions=1)
    row = report["candidates"][0]
    ids = {p["player_id"] for p in row["result"]["lineup"]}
    assert {"rA", "rB"}.issubset(ids) and "wA" not in ids
    assert row["stack_audit"]["attachments"]["player_ids"] == ["rA"]
    assert "rB" in row["stack_audit"]["bring_back"]["player_ids"]
    base = {"version": 1, "attachments": {"mode": "minimum", "count": 2}, "bring_back": {"mode": "optional", "count": 0}}
    conflict = comparison.compare_classic_lineups(pool(), requests=[request()], classic_stack_rules=base, completions=1)
    assert conflict["candidates"][0]["status"] == "infeasible"


def test_focus_limits_primary_qbs_only_and_keeps_omitted_challengers_and_complements():
    report = comparison.compare_classic_lineups(pool(), requests=[request("a"), request("b", "qB")], stack_qb_ids=["qA"], completions=1)
    assert [row["in_primary_scope"] for row in report["candidates"]] == [True, False]
    assert report["best_primary_id"] == "a"
    assert report["best_challenger_id"] == "b"
    assert any(p["team"] == "SEA" for p in report["candidates"][0]["result"]["lineup"])


def test_missing_relationship_is_not_evaluated_as_a_valid_forbidden_bringback():
    frame = pool(); frame.loc[frame.player_id.eq("qA"), "Opponent"] = ""
    report = comparison.compare_classic_lineups(frame, requests=[request(bring="forbidden")], completions=1)
    assert report["candidates"][0]["status"] == "infeasible"


def test_common_snapshot_evaluation_replaces_historical_score_without_rewriting_history():
    report = comparison.compare_classic_lineups(pool(), requests=[request()], completions=1)
    historical = report["candidates"][0]["result"]
    original = historical["total_points"]
    frame = pool(); frame["Projected Points"] += 1
    audit = comparison.evaluate_common_snapshot([historical], frame)
    assert audit["lineups"][0]["objective_score"] == pytest.approx(report["candidates"][0]["objective_score"] + 9)
    assert historical["total_points"] == original
    assert audit["complete"] and audit["snapshot_id"] != report["snapshot_id"]
    frame = frame[~frame.player_id.eq(historical["lineup"][0]["player_id"])]
    partial = comparison.evaluate_common_snapshot([historical], frame)
    assert not partial["complete"] and partial["lineups"][0]["objective_score"] is None
    assert partial["lineups"][0]["missing_player_ids"]


def test_actual_timeout_incumbent_is_feasible_not_proven_optimal(monkeypatch):
    real = optimizer.optimize_lineup
    def timeout(*args, **kwargs):
        result = real(*args, **kwargs)
        if result.get("ok"): result["solver_status"] = "feasible_time_limit"
        return result
    monkeypatch.setattr(optimizer, "optimize_lineup", timeout)
    report = comparison.compare_classic_lineups(pool(), requests=[request()], completions=1)
    assert report["candidates"][0]["status"] == "feasible_time_limit"
    assert not report["complete"] and report["candidates"][0]["objective_score"] is not None


def test_corrupted_salary_or_rule_result_fails_independent_audit(monkeypatch):
    real = optimizer.optimize_lineup
    def corrupt(*args, **kwargs):
        result = real(*args, **kwargs)
        if result.get("ok"): result["total_salary"] = 1
        return result
    monkeypatch.setattr(optimizer, "optimize_lineup", corrupt)
    report = comparison.compare_classic_lineups(pool(), requests=[request()], completions=1)
    assert report["candidates"][0]["status"] == "invalid"
    assert report["candidates"][0]["objective_score"] is None


def test_budget_reports_all_omitted_controls_without_silently_pruning_qbs(monkeypatch):
    monkeypatch.setattr(comparison, "MAX_SOLVES", 1)
    report = comparison.compare_classic_lineups(pool(), requests=[request("a"), request("b", "qB")], completions=2)
    assert len(report["candidates"]) == 2
    assert report["candidates"][1]["status"] == "not_evaluated"
    assert report["attempt_count"] == 1 and not report["complete"]


@pytest.mark.parametrize("change", [lambda f: pd.concat([f, f.iloc[[0]]]),
    lambda f: f.assign(player_id=lambda x: x.player_id.where(x.player_id.ne("qA"), " qA "))])
def test_ambiguous_common_pool_ids_fail_before_any_solve(change):
    with pytest.raises(ValueError, match="canonical"):
        comparison.compare_classic_lineups(change(pool()), requests=[request()])


def test_showdown_and_malformed_controls_are_rejected():
    with pytest.raises(ValueError, match="Classic"):
        comparison.compare_classic_lineups(pool(), site="draftkings_showdown")
    with pytest.raises(ValueError):
        comparison.compare_classic_lineups(pool(), requests=[request(mode="exact", count=True)])
    with pytest.raises(ValueError, match="QB"):
        comparison.compare_classic_lineups(pool(), requests=[request(qb="rA")])


def test_default_receiving_rb_variants_only_force_same_team_declared_rbs():
    report = comparison.compare_classic_lineups(pool(), receiving_rb_ids=["rA"], completions=1)
    variants = [r for r in report["candidates"] if ":rb:" in r["id"]]
    assert [(r["qb_id"], r["core_player_ids"]) for r in variants] == [("qA", ["rA"])]
    assert variants[0]["stack_audit"]["attachments"]["player_ids"] == ["rA"]


def test_common_rescore_retains_supplied_finite_inputs_for_now_unavailable_identity():
    report = comparison.compare_classic_lineups(pool(), requests=[request()], completions=1)
    historical = report["candidates"][0]["result"]
    frame = pool()
    inactive_id = next(p["player_id"] for p in historical["lineup"] if p["position"] == "RB")
    frame.loc[frame.player_id.eq(inactive_id), "Injury Status"] = "out"
    audit = comparison.evaluate_common_snapshot([historical], frame)
    assert audit["complete"] and audit["lineups"][0]["objective_score"] == report["candidates"][0]["objective_score"]
    fresh = comparison.compare_classic_lineups(frame, requests=[request()], completions=1)
    assert inactive_id not in {p["player_id"] for p in fresh["candidates"][0]["result"]["lineup"]}


@pytest.mark.parametrize("requested_limit", [0, 9])
def test_fanduel_site_team_limit_cannot_be_removed_by_optional_user_limit(requested_limit):
    report = comparison.compare_classic_lineups(pool(), site="fanduel", max_per_team=requested_limit,
        requests=[request(mode="optional", count=0)], completions=1)
    assert report["constraints"]["max_per_team"] == 4
    row = report["candidates"][0]
    assert row["status"] == "optimal"
    teams = [p["team"] for p in row["result"]["lineup"]]
    assert max(teams.count(team) for team in set(teams)) <= 4


def test_typed_common_pool_team_aliases_cannot_bypass_team_limit_or_mutate_inputs():
    from src.core.team_codes import normalize_team_for_match
    players = optimizer._players_from_pool(pool(), require_salary=True)
    for index, player in enumerate(players):
        if player.team == "BUF": player.team = "LAR" if index % 2 else "LA"
        if player.opponent == "BUF": player.opponent = "LAR"
    original_teams = [p.team for p in players]
    report = comparison.compare_classic_lineups(players, site="fanduel", max_per_team=0,
        requests=[request(mode="optional", count=0)], completions=1)
    teams = [normalize_team_for_match(p["team"]) for p in report["candidates"][0]["result"]["lineup"]]
    assert max(teams.count(team) for team in set(teams)) <= 4
    assert [p.team for p in players] == original_teams
