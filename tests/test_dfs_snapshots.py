from copy import deepcopy
from dataclasses import FrozenInstanceError

import pandas as pd
import pytest

from src.products import lineup_optimizer as optimizer
from src.products.dfs_snapshots import capture_build_snapshot, verify_build_snapshot


def pool():
    return pd.DataFrame([
        {"player_id": f"p{i}", "Player": f"Player {i}", "Position": pos,
         "Team": "AAA" if i % 2 else "BBB", "Projected Points": float(20-i),
         "Low (P10)": float(5-i), "High (P90)": float(30-i),
         "salary": 4000+i*500, "cpt_salary": 6000+i*750,
         "dfs_id": str(100+i), "cpt_dfs_id": str(200+i)}
        for i, pos in enumerate(["QB", "RB", "WR", "TE", "DST", "K", "WR", "RB"])
    ])


def build(frame=None, **kwargs):
    return optimizer.optimize_from_pool_dataframe(pool() if frame is None else frame,
        site="draftkings_showdown", **kwargs)


def test_snapshot_hash_is_stable_sensitive_and_detached():
    frame = pool()
    players = optimizer._players_from_pool(frame)
    context = {"week": 1, "season": 2026}
    frozen = capture_build_snapshot(frame, players, site="draftkings_showdown", parameters={}, context=context)
    original = frozen.to_dict()
    assert verify_build_snapshot(original)
    context["week"] = 2
    frame.loc[0, "salary"] += 100
    players[0].proj = 999
    returned = frozen.to_dict()
    returned["content"]["rules"]["config"]["salary_cap"] = 1
    assert frozen.to_dict() == original
    assert not verify_build_snapshot(returned)
    assert not verify_build_snapshot({})
    with pytest.raises(FrozenInstanceError):
        frozen.payload_json = "changed"
    same = capture_build_snapshot(pool(), optimizer._players_from_pool(pool()),
        site="draftkings_showdown", parameters={}, context={"season": 2026, "week": 1})
    assert same.to_dict()["id"] == original["id"]


@pytest.mark.parametrize("field,value", [("salary", 4200), ("cpt_dfs_id", "changed"),
    ("Projected Points", 21.0), ("Team", "CCC"), ("Injury Status", "Questionable")])
def test_changed_inputs_create_new_snapshot(field, value):
    baseline = build()["build_snapshot"]["id"]
    frame = pool()
    frame.loc[0, field] = value
    assert build(frame)["build_snapshot"]["id"] != baseline


def test_missing_projection_stays_null_and_is_not_eligible():
    frame = pool()
    frame.loc[0, "Projected Points"] = float("nan")
    content = build(frame)["build_snapshot"]["content"]
    assert content["input_pool"][0]["Projected Points"] is None
    assert "p0" not in [row["player_id"] for row in content["eligible_players"]]


def test_generated_seed_reproduces_random_build():
    first = build(lineup_count=3, randomness=.2, max_overlap=6)
    snapshot = first["build_snapshot"]
    seed = snapshot["content"]["parameters"]["seed"]
    assert isinstance(seed, int)
    second = build(lineup_count=3, randomness=.2, max_overlap=6, seed=seed)
    assert first["lineups"] == second["lineups"]
    assert snapshot["id"] == second["build_snapshot"]["id"]


def test_settings_rules_and_context_affect_snapshot():
    baseline = build()["build_snapshot"]["id"]
    assert build(min_salary=100)["build_snapshot"]["id"] != baseline
    assert build(snapshot_context={"season": 2026})["build_snapshot"]["id"] != baseline
    record = build()["build_snapshot"]
    changed = deepcopy(record)
    changed["content"]["rules"]["config"]["salary_cap"] = 1
    assert not verify_build_snapshot(changed)


def test_snapshot_survives_account_scoped_save(tmp_path, monkeypatch):
    from src.products import dfs_results
    monkeypatch.setattr(dfs_results, "RESULTS_DB", tmp_path / "results.db")
    snapshot = build()["build_snapshot"]
    dfs_results.save_build("alice", {"id": "build1", "settings": {"build_snapshot": snapshot}})
    assert dfs_results.read_results("alice")["builds"][0]["settings"]["build_snapshot"] == snapshot
    assert dfs_results.read_results("bob")["builds"] == []
