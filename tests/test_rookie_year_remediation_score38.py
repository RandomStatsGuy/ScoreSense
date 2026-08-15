"""SCORE-38: preview/correct persisted inflated rookie years."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.contracts import build_rookie_contract, build_veteran_contract
from src.draft_hub.presets import load_preset
from src.draft_hub.rookie_year_remediation import (
    apply_inflated_rookie_year_corrections,
    is_inflated_rookie_year_row,
    preview_inflated_rookie_years,
)
from src.draft_hub.schemas import LeagueRules


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _inflated_rookie(*, player_id: str = "00-0038001", salary: float = 8.0) -> dict:
    contract = build_rookie_contract(salary, 2)
    contract["years_exp"] = 1
    contract["inferred_from"] = "nfl_yr_1"
    return {
        "player_id": player_id,
        "player_name": "Inflated Rookie",
        "team": "CLE",
        "position": "QB",
        "salary": salary,
        "contract_years": 2,
        "source": "sheet",
        "roster_status": "active",
        "contract": contract,
    }


def test_detects_inflated_years_exp_one_left_two():
    rules = load_preset("salary_cap_auction_v1")
    row = _inflated_rookie()
    assert is_inflated_rookie_year_row(rules, row, years_exp=1) is True

    correct = _inflated_rookie(player_id="00-0038002")
    correct["contract"]["years_remaining"] = 1
    correct["contract_years"] = 1
    assert is_inflated_rookie_year_row(rules, correct, years_exp=1) is False

    true_rookie = _inflated_rookie(player_id="00-0038003")
    true_rookie["contract"]["years_exp"] = 0
    true_rookie["contract"]["inferred_from"] = "nfl_yr_0"
    assert is_inflated_rookie_year_row(rules, true_rookie, years_exp=0) is False

    manual = _inflated_rookie(player_id="00-0038004")
    manual["contract"]["contract_type_manual"] = True
    assert is_inflated_rookie_year_row(rules, manual, years_exp=1) is False

    vet = {
        "player_id": "00-0038005",
        "contract_years": 2,
        "contract": {**build_veteran_contract(20, 2), "years_exp": 1},
    }
    assert is_inflated_rookie_year_row(rules, vet, years_exp=1) is False


def test_preview_and_apply_corrections(hub_db):
    rules = LeagueRules()
    league = storage.create_league("comm-38", "SCORE-38 League", 2026, rules, team_count=2)
    team = storage.get_team_by_user(league["id"], "comm-38")
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(ws, _inflated_rookie(player_id="00-0038101"), team_id=team["id"])
    storage.add_roster_slot(ws, _inflated_rookie(player_id="00-0038102"), team_id=team["id"])
    keep = _inflated_rookie(player_id="00-0038103")
    keep["contract"]["years_remaining"] = 1
    keep["contract_years"] = 1
    storage.add_roster_slot(ws, keep, team_id=team["id"])

    preview = preview_inflated_rookie_years(league["id"])
    assert preview["count"] == 2
    assert {r["player_id"] for r in preview["rows"]} == {"00-0038101", "00-0038102"}
    assert all(r["suggested_years"] == 1 for r in preview["rows"])

    applied = apply_inflated_rookie_year_corrections(
        league["id"],
        edited_by_sub="comm-38",
        player_ids=["00-0038101"],
    )
    assert applied["corrected"] == 1
    fixed = storage.get_roster_slot(ws, "00-0038101")
    assert int(fixed["contract_years"]) == 1
    assert int(fixed["contract"]["years_remaining"]) == 1
    leftover = storage.get_roster_slot(ws, "00-0038102")
    assert int(leftover["contract"]["years_remaining"]) == 2

    rest = apply_inflated_rookie_year_corrections(league["id"], edited_by_sub="comm-38")
    assert rest["corrected"] == 1
    leftover = storage.get_roster_slot(ws, "00-0038102")
    assert int(leftover["contract"]["years_remaining"]) == 1
    assert preview_inflated_rookie_years(league["id"])["count"] == 0


def test_remediation_endpoints_commissioner_only(hub_db):
    rules = LeagueRules()
    league = storage.create_league("comm-38-api", "SCORE-38 API", 2026, rules, team_count=4)
    owner = storage.join_league("mgr-38-api", league["room_code"], "Owner")
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws,
        _inflated_rookie(player_id="00-0038201"),
        team_id=owner["id"],
    )
    lid = league["id"]

    mgr = _client_for("mgr-38-api")
    try:
        blocked = mgr.get(f"/api/hub/league/{lid}/rookie-year-remediation")
        assert blocked.status_code == 403
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

    comm = _client_for("comm-38-api")
    try:
        preview = comm.get(f"/api/hub/league/{lid}/rookie-year-remediation")
        assert preview.status_code == 200, preview.text
        assert preview.json()["count"] == 1
        applied = comm.post(
            f"/api/hub/league/{lid}/rookie-year-remediation",
            json={"player_ids": ["00-0038201"]},
        )
        assert applied.status_code == 200, applied.text
        assert applied.json()["corrected"] == 1
        row = storage.get_roster_slot(ws, "00-0038201")
        assert int(row["contract"]["years_remaining"]) == 1
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
