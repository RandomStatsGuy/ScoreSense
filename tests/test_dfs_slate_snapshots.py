from copy import deepcopy
import json

import pandas as pd
import pytest
from fastapi import HTTPException

from src.products import dfs_results
from src.products.dfs_slate_snapshots import capture_salary_snapshot, resolve_salary_snapshot, validate_catalog
from src.products.dfs_salaries import parse_salary_csv
from src.integrations.external_projections import _normalize_name
from test_dfs_snapshots import pool


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(dfs_results, "RESULTS_DB", tmp_path / "results.db")


def salaries():
    frame = pool().rename(columns={"Player": "player_name", "Team": "team", "Position": "position"})
    frame["name_key"] = frame["player_name"].map(_normalize_name)
    frame["site"] = "draftkings"
    frame["game_info"] = "AAA@BBB 09/28/2026 08:00PM ET"
    return frame


def capture(frame=None, **kwargs):
    return capture_salary_snapshot("alice", salaries() if frame is None else frame,
        site="draftkings_showdown", source="provider_catalog",
        slate={"slate_id": "123", "category": "showdown"}, **kwargs)


def test_catalog_snapshot_is_immutable_and_account_scoped():
    frame = salaries()
    first = capture(frame)
    repeat = capture(frame.iloc[::-1])
    assert first == repeat
    frame.loc[0, "salary"] = 1234
    second = capture(frame)
    assert second["id"] != first["id"]
    original, summary = resolve_salary_snapshot("alice", first["id"], site="draftkings_showdown", slate_id="123")
    assert original.iloc[0]["salary"] == 4000
    assert summary["source"] == "provider_catalog"
    assert not summary["scoring_verified"]
    assert not summary["lock_state_verified"]
    with pytest.raises(ValueError, match="account"):
        resolve_salary_snapshot("bob", first["id"], site="draftkings_showdown")


@pytest.mark.parametrize("field,value", [("salary", 4200), ("cpt_salary", 6400), ("dfs_id", "99999"),
    ("cpt_dfs_id", "changed"), ("team", "CCC"), ("position", "WR"), ("game_info", "AAA@CCC")])
def test_changed_browser_rows_are_rejected(field, value):
    snapshot = capture()
    frame = salaries()
    frame.loc[0, field] = value
    with pytest.raises(ValueError, match="changed"):
        resolve_salary_snapshot("alice", snapshot["id"], site="draftkings_showdown", supplied_rows=frame.to_dict("records"))


def test_added_removed_or_duplicated_browser_rows_are_rejected():
    snapshot = capture()
    frame = salaries()
    for changed in [frame.iloc[:-1], pd.concat([frame, frame.iloc[:1]])]:
        with pytest.raises(ValueError, match="changed"):
            resolve_salary_snapshot("alice", snapshot["id"], site="draftkings_showdown", supplied_rows=changed.to_dict("records"))


@pytest.mark.parametrize("site,slate", [("draftkings", "123"), ("fanduel_single", "123"), ("draftkings_showdown", "456")])
def test_snapshot_cannot_cross_format_or_slate(site, slate):
    with pytest.raises(ValueError, match="different slate or format"):
        resolve_salary_snapshot("alice", capture()["id"], site=site, slate_id=slate)


def test_missing_game_metadata_is_not_claimed_complete():
    summary = capture(salaries().drop(columns="game_info"))
    assert not summary["game_metadata_complete"]


def test_game_info_is_retained_from_csv_and_mixed_games_fail():
    frame = parse_salary_csv("Name,ID,Position,Salary,TeamAbbrev,Game Info\nOne,1,QB,4000,KC,KC@LV\nTwo,2,WR,3000,LV,KC@LV\n")
    assert frame["game_info"].tolist() == ["KC@LV", "KC@LV"]
    assert len(validate_catalog(frame, site="draftkings_showdown")) == 2
    frame.loc[1, "game_info"] = "KC@LV 10/01/2026"
    with pytest.raises(ValueError, match="multiple games"):
        validate_catalog(frame, site="draftkings_showdown")
    frame.loc[1, "game_info"] = "SF@SEA"
    with pytest.raises(ValueError, match="listed game"):
        validate_catalog(frame, site="draftkings")


def test_rules_site_and_team_checks():
    frame = salaries()
    with pytest.raises(ValueError, match="format"):
        validate_catalog(frame, site="draftkings_showdown", slate={"category": "main"})
    with pytest.raises(ValueError, match="single-game"):
        validate_catalog(frame, site="draftkings")
    with pytest.raises(ValueError, match="different DFS site"):
        validate_catalog(frame, site="fanduel_single")
    frame["team"] = "AAA"
    with pytest.raises(ValueError, match="exactly two"):
        validate_catalog(frame, site="draftkings_showdown")


def test_duplicate_role_ids_and_malformed_salary_fail():
    frame = salaries()
    frame.loc[1, "dfs_id"] = frame.loc[0, "dfs_id"]
    with pytest.raises(ValueError, match="multiple players"):
        validate_catalog(frame, site="draftkings_showdown")
    frame = salaries()
    frame.loc[0, "cpt_dfs_id"] = frame.loc[0, "dfs_id"]
    with pytest.raises(ValueError, match="distinct"):
        validate_catalog(frame, site="draftkings_showdown")
    frame["salary"] = frame["salary"].astype(float)
    frame.loc[0, "salary"] = 1.5
    with pytest.raises(ValueError, match="whole numbers"):
        validate_catalog(frame, site="draftkings_showdown")


def test_database_tampering_is_detected():
    snapshot = capture()
    with dfs_results.connect() as db:
        payload = json.loads(db.execute("SELECT payload FROM salary_snapshots").fetchone()[0])
        payload["content"]["rows"][0]["salary"] = 1
        db.execute("UPDATE salary_snapshots SET payload=?", (json.dumps(payload),))
    with pytest.raises(ValueError, match="integrity"):
        resolve_salary_snapshot("alice", snapshot["id"], site="draftkings_showdown")


def test_optimizer_uses_retained_catalog_and_preserves_provenance(monkeypatch):
    import app.api as api
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kwargs: (pool().drop(columns=["salary", "cpt_salary", "dfs_id", "cpt_dfs_id"]), {"season": 2026, "week": 1}))
    snapshot = capture()
    request = api.LineupOptimizeRequest(site="draftkings_showdown", slate_id="123", salary_snapshot_id=snapshot["id"],
        include_captain_comparison=True)
    result = api.lineup_optimize(request, {"sub": "alice"})
    assert result["ok"]
    assert result["slate_validation"]["id"] == snapshot["id"]
    assert result["build_snapshot"]["content"]["source_context"]["salary_snapshot"]["id"] == snapshot["id"]
    assert result["captain_comparison"]["complete"]
    with pytest.raises(HTTPException) as error:
        api.lineup_optimize(request, {"sub": "bob"})
    assert error.value.status_code == 400
    with pytest.raises(HTTPException) as error:
        api.lineup_optimize(request, None)
    assert error.value.status_code == 401


def test_authenticated_salary_load_returns_bound_snapshot(monkeypatch):
    import app.api as api
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kwargs: (pool().drop(columns=["salary", "cpt_salary", "dfs_id", "cpt_dfs_id"]), {}))
    monkeypatch.setattr(api, "fetch_slate_salaries", lambda *args, **kwargs: salaries())
    monkeypatch.setattr(api, "list_slates", lambda *args, **kwargs: [{"slate_id": "123", "category": "showdown", "site": "draftkings"}])
    loaded = api.lineup_load_salaries(site="draftkings_showdown", slate_id="123", _user={"sub": "alice"})
    snapshot = loaded["salary_snapshot"]
    retained, _ = resolve_salary_snapshot("alice", snapshot["id"], site="draftkings_showdown", supplied_rows=loaded["salaries"])
    assert len(retained) == 8


def test_legacy_request_remains_explicitly_unbound(monkeypatch):
    import app.api as api
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kwargs: (pool(), {}))
    result = api.lineup_optimize(api.LineupOptimizeRequest(site="draftkings_showdown"), {})
    assert result["ok"]
    assert result["slate_validation"]["scope"] == "unbound_client_inputs"


def test_uploaded_catalog_is_retained_without_provider_attestation(monkeypatch):
    import asyncio
    from io import BytesIO
    from starlette.datastructures import UploadFile
    import app.api as api
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kwargs: (pool().drop(columns=["salary", "cpt_salary", "dfs_id", "cpt_dfs_id"]), {}))
    csv = "Name,ID,Position,Salary,TeamAbbrev,Game Info\nOne,1,QB,4000,KC,KC@LV\nTwo,2,WR,3000,LV,KC@LV\n"
    loaded = asyncio.run(api.lineup_import_salaries(UploadFile(BytesIO(csv.encode())), site="draftkings_showdown", _user={"sub": "alice"}))
    snapshot = loaded["salary_snapshot"]
    assert snapshot["source"] == "uploaded_csv"
    assert snapshot["slate_id"] == ""
    assert snapshot["game_metadata_complete"]
    assert not snapshot["scoring_verified"]


def test_rules_drift_requires_catalog_reload(monkeypatch):
    from src.products import dfs_config
    snapshot = capture()
    changed = deepcopy(dfs_config.SITE_CONFIGS["draftkings_showdown"])
    changed["salary_cap"] = 49000
    monkeypatch.setitem(dfs_config.SITE_CONFIGS, "draftkings_showdown", changed)
    with pytest.raises(ValueError, match="rules changed"):
        resolve_salary_snapshot("alice", snapshot["id"], site="draftkings_showdown")


def test_cross_game_role_rows_cannot_disappear_during_collapse():
    frame = parse_salary_csv("Name,ID,Position,Roster Position,Salary,TeamAbbrev,Game Info\nOne,1,QB,FLEX,4000,KC,KC@LV\nOne,2,QB,CPT,6000,KC,KC@LV NEXT WEEK\nTwo,3,WR,FLEX,3000,LV,KC@LV\n")
    with pytest.raises(ValueError, match="multiple games"):
        validate_catalog(frame, site="draftkings_showdown")


def test_bound_requests_cannot_relax_format_limits():
    snapshot = capture()
    for cap in (-1, 0, 50001):
        with pytest.raises(ValueError, match="salary cap"):
            resolve_salary_snapshot("alice", snapshot["id"], site="draftkings_showdown", salary_cap=cap)
    resolve_salary_snapshot("alice", snapshot["id"], site="draftkings_showdown", salary_cap=49000)
    frame = salaries().drop(columns=["cpt_salary", "cpt_dfs_id"])
    frame["site"] = "fanduel"
    snapshot = capture_salary_snapshot("alice", frame, site="fanduel", source="uploaded_csv")
    with pytest.raises(ValueError, match="at most 4"):
        resolve_salary_snapshot("alice", snapshot["id"], site="fanduel", max_per_team=5)
