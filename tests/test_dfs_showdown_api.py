from copy import deepcopy

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pandas as pd
import pytest
from pydantic import ValidationError

import app.api as api
from app.auth import require_patron
from src.products.dfs_snapshots import capture_build_snapshot


def frozen():
    values = {"site": "draftkings_showdown", "season": 2026, "week": 5, "slate_id": "synthetic",
        "objective": "ceiling", "salary_cap": 50000, "max_per_team": 5,
        "showdown_rules": {"receiver_captain_qb": "warn"}, "include_captain_comparison": True}
    request = api.LineupOptimizeRequest(**values)
    params = request.model_dump()
    pool = pd.DataFrame([{"player_id": "w", "Player": "Synthetic receiver", "Team": "BUF", "Position": "WR",
        "Projected Points": 10, "Low (P10)": 2, "High (P90)": 30, "salary": 5000, "Injury Status": "Questionable"}])
    record = capture_build_snapshot(pool, [], site=values["site"], parameters=params,
        context={"requested_season": 2026, "requested_week": 5, "client_slate_id": "synthetic", "pool_meta": {}}).to_dict()
    return values, record


def test_frozen_api_comparison_does_not_load_live_forecasts_salaries_or_apply_overrides(monkeypatch):
    values, record = frozen()
    values.update(comparison_snapshot=record, projection_overrides={"w": {"proj": 999, "floor": 999, "ceiling": 999}}, salary_snapshot_id="a" * 64)
    def forbidden(*args, **kwargs):
        raise AssertionError("Frozen comparison must not load or compose current inputs")
    monkeypatch.setattr(api, "build_lineup_pool", forbidden)
    monkeypatch.setattr(api, "attach_salaries_to_pool", forbidden)
    import src.products.dfs_inputs as inputs
    monkeypatch.setattr(inputs, "apply_projection_overrides", forbidden)
    seen = {}
    def solve(pool, **kwargs):
        seen.update(pool=pool.copy(), options=kwargs)
        return {"ok": True, "lineup": []}
    monkeypatch.setattr(api, "optimize_from_pool_dataframe", solve)
    result = api.lineup_optimize(api.LineupOptimizeRequest(**values), _user=None)
    assert seen["pool"].iloc[0]["Projected Points"] == 10
    assert seen["options"]["showdown_rules"] == {"receiver_captain_qb": "warn"}
    assert result["comparison_source_snapshot_id"] == record["id"]
    assert result["slate_validation"] == {"scope": "supplied_frozen_comparison", "scoring_verified": False, "lock_state_verified": False}


@pytest.mark.parametrize("rules", [{"receiver_captain_qb": []}, {"receiver_captain_qb": {}},
    {"receiver_captain_qb": "always"}, {"approved_qb_ids": ["q"]}, {"approved_qb_ids": {"BUF": "q"}},
    {"approved_qb_ids": {"BUF": ["q", "q"]}}, {"made_up": 1}])
def test_malformed_pairing_controls_fail_before_loading_any_pool(monkeypatch, rules):
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kwargs: pytest.fail("Invalid controls must reject before data loading"))
    with pytest.raises(HTTPException) as exc:
        api.lineup_optimize(api.LineupOptimizeRequest(site="draftkings_showdown", showdown_rules=rules), _user=None)
    assert exc.value.status_code == 400


def test_changed_frozen_rules_fail_without_solver_or_live_load(monkeypatch):
    values, record = frozen()
    values.update(comparison_snapshot=record, objective="value")
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kwargs: pytest.fail("No live fallback"))
    monkeypatch.setattr(api, "optimize_from_pool_dataframe", lambda *args, **kwargs: pytest.fail("Changed objective must reject"))
    with pytest.raises(HTTPException, match="original") as exc:
        api.lineup_optimize(api.LineupOptimizeRequest(**values), _user=None)
    assert exc.value.status_code == 400


def test_pairing_and_forced_identity_propagate_to_solver_and_pool_keep_set(monkeypatch):
    seen = {}
    def load(**kwargs):
        seen["keep"] = kwargs["keep_player_ids"]
        return pd.DataFrame(columns=["player_id", "Player", "Team", "Position", "Projected Points", "Low (P10)", "High (P90)"]), {}
    def solve(pool, **kwargs):
        seen["options"] = kwargs
        return {"ok": False, "error": "Synthetic empty pool", "lineup": []}
    monkeypatch.setattr(api, "build_lineup_pool", load)
    monkeypatch.setattr(api, "optimize_from_pool_dataframe", solve)
    controls = {"receiver_captain_qb": "require", "approved_qb_ids": {"BUF": ["q"]}}
    api.lineup_optimize(api.LineupOptimizeRequest(site="draftkings_showdown", showdown_rules=controls,
        comparison_player_id="w", comparison_player_slot="flex"), _user=None)
    assert {"q", "w"} <= set(seen["keep"])
    assert seen["options"]["showdown_rules"] == controls
    assert seen["options"]["comparison_player_id"] == "w" and seen["options"]["comparison_player_slot"] == "flex"


def test_new_optional_fields_preserve_legacy_request_absence():
    request = api.LineupOptimizeRequest()
    assert request.showdown_rules is None and request.comparison_snapshot is None
    assert request.comparison_player_id is None and request.comparison_player_slot is None
    with pytest.raises(ValidationError):
        api.LineupOptimizeRequest(comparison_player_slot="both")


def test_patron_denial_precedes_comparison_execution(monkeypatch):
    def denied():
        raise HTTPException(401, "Sign in")
    previous = deepcopy(api.app.dependency_overrides)
    api.app.dependency_overrides[require_patron] = denied
    monkeypatch.setattr(api, "build_lineup_pool", lambda **kwargs: pytest.fail("Denied request cannot load a pool"))
    try:
        response = TestClient(api.app).post("/api/lineup/optimize", json={"site": "draftkings_showdown"})
        assert response.status_code == 401
    finally:
        api.app.dependency_overrides = previous
