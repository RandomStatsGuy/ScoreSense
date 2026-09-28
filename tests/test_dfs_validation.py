"""Independent validation catches corrupted solver outputs, not just infeasibility."""
from copy import deepcopy

import pandas as pd
import pytest

from src.products import lineup_optimizer as optimizer
from src.products.dfs_validation import validate_generated_lineups


def pool():
    positions = ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "TE", "TE", "DST", "DST", "K"]
    return pd.DataFrame([
        {"player_id": f"p{i}", "Player": f"Player {i}", "Position": pos,
         "Team": "AAA" if i % 2 else "BBB", "Projected Points": 25 - i,
         "Low (P10)": 10 - i, "High (P90)": 35 - i,
         "salary": 4000, "cpt_salary": 6000, "dfs_id": str(100 + i), "cpt_dfs_id": str(200 + i)}
        for i, pos in enumerate(positions)
    ])


@pytest.mark.parametrize("site", ["seasonal", "draftkings", "fanduel", "draftkings_showdown", "fanduel_single"])
def test_all_formats_return_independently_checked_rows(site):
    frame = pool()
    if site == "fanduel":
        frame.loc[frame["player_id"] == "p8", "Team"] = "CCC"
    result = optimizer.optimize_from_pool_dataframe(frame, site=site)
    assert result["ok"], result
    assert result["validation"]["ok"]
    assert not result["validation"]["issues"]


@pytest.mark.parametrize("field,value,code", [
    ("salary", 1, "salary_mismatch"),
    ("dfs_id", "wrong", "salary_id"),
    ("player_id", "wrong", "unknown_player"),
    ("team", "wrong", "player_identity"),
    ("slot", "FLEX1", "roster_slots"),
    ("proj", float("nan"), "projection_mismatch"),
])
def test_validation_rejects_corrupted_generated_rows(field, value, code):
    frame = pool()
    result = optimizer.optimize_from_pool_dataframe(frame, site="draftkings_showdown")
    result["lineup"][0][field] = value
    checked = validate_generated_lineups(result, optimizer._players_from_pool(frame),
                                        site="draftkings_showdown", salary_cap=50000)
    assert not checked["ok"]
    assert checked["lineup"] == []
    assert code in {issue["code"] for issue in checked["validation"]["issues"]}


def test_return_path_cannot_publish_corrupt_solver_result(monkeypatch):
    frame = pool()
    result = optimizer.optimize_from_pool_dataframe(frame, site="draftkings")
    result["total_salary"] = 1
    monkeypatch.setattr(optimizer, "optimize_lineup", lambda *args, **kwargs: result)
    checked = optimizer.optimize_from_pool_dataframe(frame, site="draftkings")
    assert not checked["ok"]
    assert "salary_total" in {issue["code"] for issue in checked["validation"]["issues"]}


def test_validation_checks_portfolio_identity_ignoring_slot_order():
    frame = pool()
    result = optimizer.optimize_from_pool_dataframe(frame, site="draftkings_showdown", lineup_count=3, max_overlap=6)
    assert result["validation"]["ok"]
    duplicate = deepcopy(result["lineups"][0])
    duplicate["lineup"] = list(reversed(duplicate["lineup"]))
    result["lineups"].append(duplicate)
    checked = validate_generated_lineups(result, optimizer._players_from_pool(frame),
                                        site="draftkings_showdown", salary_cap=50000)
    assert not checked["ok"]
    assert "duplicate_lineup" in {issue["code"] for issue in checked["validation"]["issues"]}


def test_missing_export_ids_remain_previewable_but_are_reported():
    frame = pool().assign(dfs_id="", cpt_dfs_id="")
    result = optimizer.optimize_from_pool_dataframe(frame, site="draftkings_showdown")
    assert result["ok"]
    assert not result["validation"]["export_ids_complete"]


def test_validator_checks_locks_and_limits_independently():
    frame = pool()
    result = optimizer.optimize_from_pool_dataframe(frame, site="draftkings_showdown")
    checked = validate_generated_lineups(result, optimizer._players_from_pool(frame),
        site="draftkings_showdown", salary_cap=20000, min_salary=45000, max_per_team=1,
        locked_player_ids=["not-selected"], locked_captain_id="not-selected")
    codes = {issue["code"] for issue in checked["validation"]["issues"]}
    assert {"missing_lock", "captain_lock", "salary_limit", "team_limit"} <= codes


@pytest.mark.parametrize("result", [
    {"ok": True, "lineups": None}, {"ok": True, "lineups": []},
    {"ok": True, "lineup": None}, {"ok": True, "lineup": [None]},
])
def test_malformed_solver_outputs_fail_closed(result):
    checked = validate_generated_lineups(result, [], site="draftkings")
    assert not checked["ok"]
    assert checked["validation"]["issues"]
