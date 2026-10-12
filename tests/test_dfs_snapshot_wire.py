"""Exercise the actual JSON boundary used by browser-originated comparisons."""
from copy import deepcopy
import json
import shutil
import subprocess

import pandas as pd
import pytest

from src.products.dfs_snapshots import capture_build_snapshot, content_id, verify_build_snapshot
from src.products.dfs_showdown_snapshot import restore_comparison_inputs


def browser_roundtrip(value):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is needed to exercise the browser JSON number boundary")
    completed = subprocess.run(
        [node, "-e", "let text=''; process.stdin.on('data', c => text+=c); process.stdin.on('end', () => process.stdout.write(JSON.stringify(JSON.parse(text))));"],
        input=json.dumps(value, allow_nan=False), text=True, encoding="utf-8", capture_output=True, check=True,
    )
    return json.loads(completed.stdout)


def wire_snapshot(site):
    request = {"site": site, "season": 2026, "week": 5, "slate_id": "synthetic-wire",
        "objective": "ceiling", "salary_cap": 50000, "min_salary": None, "max_per_team": 5,
        "block_bye_weeks": True, "locked_player_ids": [], "excluded_player_ids": [],
        "candidate_player_ids": None, "locked_captain_id": None, "showdown_rules": None,
        "comparison_player_id": "w", "comparison_player_slot": "flex"}
    frame = pd.DataFrame([
        {"player_id": "w", "Player": "Synthetic receiver", "Team": "BUF", "Position": "WR",
         "Projected Points": 10.0, "Low (P10)": -0.0, "High (P90)": 22.625,
         "salary": 5000.0, "cpt_salary": 7500.0, "p_zero": 0.125,
         "nullable_role": None, "dfs_id": "100000000000000001", "Injury Status": "Questionable"},
        {"player_id": "q", "Player": "Synthetic quarterback", "Team": "LA", "Position": "QB",
         "Projected Points": 24.5, "Low (P10)": 10.0, "High (P90)": 36.0,
         "salary": 10000.0, "cpt_salary": 15000.0, "p_zero": 1e-7,
         "nullable_role": None, "dfs_id": "100000000000000002", "Injury Status": ""},
    ])
    record = capture_build_snapshot(frame, [], site=site, parameters=deepcopy(request), context={
        "requested_season": 2026, "requested_week": 5, "client_slate_id": "synthetic-wire",
        "pool_meta": {"roles": {"w": {"targets": 0.0}}, "source": None},
    }).to_dict()
    return record, request


@pytest.mark.parametrize("site", ["draftkings_showdown", "fanduel_single"])
def test_fresh_single_game_snapshot_survives_real_javascript_json_roundtrip(site):
    record, request = wire_snapshot(site)
    transported = browser_roundtrip(record)
    assert verify_build_snapshot(transported), "Unchanged numeric values must retain their content identity"
    frame, _, context = restore_comparison_inputs(transported, site=site, request_values=request)
    assert frame.iloc[0]["Projected Points"] == 10.0
    assert frame.iloc[0]["High (P90)"] == 22.625
    assert frame.iloc[1]["p_zero"] == 1e-7
    assert frame.iloc[0]["dfs_id"] == "100000000000000001"
    assert context["comparison_source_snapshot_id"] == record["id"]


@pytest.mark.parametrize("path,value", [
    (("input_pool", 0, "High (P90)"), 22.626),
    (("input_pool", 0, "salary"), 5001),
    (("source_context", "pool_meta", "source"), "altered"),
    (("parameters", "max_per_team"), 4),
])
def test_browser_numeric_identity_does_not_accept_changed_values(path, value):
    record, request = wire_snapshot("draftkings_showdown")
    changed = browser_roundtrip(record)
    target = changed["content"]
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    assert not verify_build_snapshot(changed)
    with pytest.raises(ValueError, match="identity"):
        restore_comparison_inputs(changed, site=request["site"], request_values=request)


def test_original_legacy_hash_still_verifies_without_rewriting_history():
    record, request = wire_snapshot("draftkings_showdown")
    record["content"].pop("content_hash_encoding", None)
    record["id"] = content_id(record["content"])
    before = deepcopy(record)
    assert verify_build_snapshot(record)
    assert restore_comparison_inputs(record, site=request["site"], request_values=request)[0].iloc[0]["Projected Points"] == 10
    assert record == before
    transferred = browser_roundtrip(record)
    assert not verify_build_snapshot(transferred)
    with pytest.raises(ValueError, match="older build snapshot.*Build again to compare"):
        restore_comparison_inputs(transferred, site=request["site"], request_values=request)


def test_classic_snapshot_keeps_legacy_encoding_and_exact_original_hash():
    import hashlib
    frame = pd.DataFrame([{"player_id": "w", "Projected Points": 10.0}])
    record = capture_build_snapshot(frame, [], site="draftkings", parameters={}).to_dict()
    assert "content_hash_encoding" not in record["content"]
    original_hash = hashlib.sha256(json.dumps(record["content"], sort_keys=True,
        separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    assert record["id"] == original_hash and verify_build_snapshot(record)


def test_versioned_nested_rules_digest_uses_the_same_numeric_identity(monkeypatch):
    from src.products.dfs_config import get_site_config
    monkeypatch.setitem(get_site_config("draftkings_showdown"), "diagnostic_numeric_zero", 0.0)
    record, request = wire_snapshot("draftkings_showdown")
    transferred = browser_roundtrip(record)
    assert verify_build_snapshot(transferred)
    assert restore_comparison_inputs(transferred, site=request["site"], request_values=request)[0].iloc[0]["Projected Points"] == 10


@pytest.mark.parametrize("value", [2**53, float(2**53), 10**1000, float("inf"), float("nan")])
def test_versioned_snapshot_rejects_numbers_that_cannot_transfer_exactly(value):
    record, _ = wire_snapshot("draftkings_showdown")
    record["content"]["source_context"]["unsafe_number"] = value
    with pytest.raises(ValueError, match="finite and safe"):
        content_id(record["content"])
    assert not verify_build_snapshot(record)


def test_unknown_hash_encoding_is_rejected_even_with_a_recomputed_digest():
    record, _ = wire_snapshot("draftkings_showdown")
    record["content"]["content_hash_encoding"] = "unknown_v9"
    record["id"] = content_id(record["content"])
    assert not verify_build_snapshot(record)


def test_snapshot_size_limit_remains_enforced_separately_from_identity():
    from src.products.dfs_showdown_snapshot import MAX_BYTES
    record, request = wire_snapshot("draftkings_showdown")
    record["content"]["source_context"]["padding"] = "x" * MAX_BYTES
    record["id"] = content_id(record["content"])
    assert verify_build_snapshot(record)
    with pytest.raises(ValueError, match="exceeds the 8 MB limit"):
        restore_comparison_inputs(record, site=request["site"], request_values=request)
