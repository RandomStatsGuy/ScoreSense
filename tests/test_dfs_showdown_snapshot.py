from copy import deepcopy

import pandas as pd
import pytest

from src.products.dfs_snapshots import capture_build_snapshot, content_id
from src.products.dfs_showdown_snapshot import restore_comparison_inputs


def fixture():
    request = {"site": "draftkings_showdown", "season": 2026, "week": 5, "slate_id": "synthetic",
        "objective": "ceiling", "salary_cap": 50000, "min_salary": None, "max_per_team": 5,
        "block_bye_weeks": True, "locked_player_ids": ["w"], "excluded_player_ids": ["other"],
        "candidate_player_ids": None, "locked_captain_id": "w", "showdown_rules": {"receiver_captain_qb": "warn"},
        "include_captain_comparison": True}
    pool = pd.DataFrame([{"player_id": "w", "Player": "Synthetic receiver", "Projected Points": 10, "High (P90)": 30,
                          "Injury Status": "Questionable", "salary": 5000}])
    record = capture_build_snapshot(pool, [], site=request["site"], parameters=deepcopy(request),
        context={"requested_season": 2026, "requested_week": 5, "client_slate_id": "synthetic", "pool_meta": {"data_as_of": "archived"}}).to_dict()
    return record, request


def restore(record, request):
    return restore_comparison_inputs(record, site=request["site"], request_values=request)


def test_restore_preserves_exact_frozen_values_statuses_and_source_not_live_inputs():
    record, request = fixture()
    request["projection_overrides"] = {"w": {"proj": 999}}
    request["slate_salaries"] = [{"player_id": "w", "salary": 1}]
    before = deepcopy(record)
    pool, meta, context = restore(record, request)
    assert pool.iloc[0]["Projected Points"] == 10 and pool.iloc[0]["salary"] == 5000
    assert pool.iloc[0]["Injury Status"] == "Questionable"
    assert meta["frozen_comparison"] and context["comparison_source_snapshot_id"] == record["id"]
    pool.loc[0, "Projected Points"] = 123
    assert record == before


@pytest.mark.parametrize("field,value", [("season", 2025), ("week", 4), ("slate_id", "other"),
    ("objective", "median"), ("salary_cap", 49000), ("min_salary", 48000), ("max_per_team", 4),
    ("locked_captain_id", None), ("locked_player_ids", []), ("excluded_player_ids", []),
    ("candidate_player_ids", ["w"]), ("showdown_rules", {"receiver_captain_qb": "off"})])
def test_comparison_cannot_silently_change_frozen_context_or_single_lineup_rules(field, value):
    record, request = fixture()
    request[field] = value
    with pytest.raises(ValueError):
        restore(record, request)


def test_frozen_comparison_rejects_tamper_format_and_noncomparison_use():
    record, request = fixture()
    changed = deepcopy(record)
    changed["content"]["input_pool"][0]["Projected Points"] = 20
    with pytest.raises(ValueError, match="identity changed"):
        restore(changed, request)
    request["site"] = "draftkings"
    with pytest.raises(ValueError, match="single-game"):
        restore(record, request)
    request["site"] = "draftkings_showdown"
    request["include_captain_comparison"] = False
    with pytest.raises(ValueError, match="read-only"):
        restore(record, request)


def test_duplicate_or_unbounded_identity_rows_reject_even_with_recomputed_hash():
    record, request = fixture()
    for rows in ([record["content"]["input_pool"][0]] * 2, [{"player_id": str(i)} for i in range(751)]):
        changed = deepcopy(record)
        changed["content"]["input_pool"] = rows
        changed["id"] = content_id(changed["content"])
        with pytest.raises(ValueError):
            restore(changed, request)


def test_legacy_snapshot_without_new_policy_retains_absence_and_rejects_new_default():
    record, request = fixture()
    record["content"]["parameters"].pop("showdown_rules")
    record["id"] = content_id(record["content"])
    request["showdown_rules"] = None
    assert restore(record, request)[0].iloc[0]["Projected Points"] == 10
    request["showdown_rules"] = {"receiver_captain_qb": "require"}
    with pytest.raises(ValueError, match="original"):
        restore(record, request)


def test_dropping_portfolio_only_settings_keeps_frozen_single_lineup_inputs():
    record, request = fixture()
    request.update(lineup_count=1, randomness=0, max_exposure=None, captain_exposure_limits={})
    assert restore(record, request)[2]["comparison_source_snapshot_id"] == record["id"]


@pytest.mark.parametrize("field", ["rules", "pool_meta", "ids", "captain_limits"])
def test_self_hashed_malformed_snapshot_types_reject_cleanly(field):
    record, request = fixture()
    content = record["content"]
    if field == "rules":
        content["rules"] = []
        content["rules_id"] = content_id(content["rules"])
    elif field == "pool_meta":
        content["source_context"]["pool_meta"] = "bad"
    elif field == "ids":
        content["parameters"]["locked_player_ids"] = 4
    else:
        content["parameters"]["captain_exposure_limits"] = {"w": "bad"}
    record["id"] = content_id(content)
    with pytest.raises(ValueError):
        restore(record, request)


def test_explicit_zero_captain_caps_remain_role_exclusions_while_other_caps_are_context():
    record, request = fixture()
    record["content"]["parameters"]["captain_exposure_limits"] = {"w": 0, "q": .5}
    record["id"] = content_id(record["content"])
    context = restore(record, request)[2]
    assert context["original_captain_exclusions"] == ["w"]
    assert context["original_portfolio_controls"]["captain_exposure_limits"] == {"w": 0, "q": .5}


@pytest.mark.parametrize("field,value", [("salary", {"bad": 5000}), ("cpt_salary", []),
    ("Projected Points", {"bad": 10}), ("value", [1]), ("Team", ["BUF"]), ("on_bye", [False])])
def test_self_hashed_malformed_player_scalars_reject_before_solver_conversion(field, value):
    record, request = fixture()
    record["content"]["input_pool"][0][field] = value
    record["id"] = content_id(record["content"])
    with pytest.raises(ValueError, match="Frozen"):
        restore(record, request)
