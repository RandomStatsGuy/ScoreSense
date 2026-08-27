"""SCORE-42: one server-calculated manager rookie-extension command."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.contract_typing import advance_roster_contracts_for_draft_complete
from src.draft_hub.contracts import (
    apply_rookie_extension_command,
    build_rookie_contract,
    can_manager_rookie_extend,
    compute_rookie_extension_start_salary,
)
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _final_year_rookie(*, player_id: str = "00-0039001", salary: float = 10.0) -> dict:
    return {
        "player_id": player_id,
        "player_name": "Test Rookie",
        "team": "NE",
        "position": "RB",
        "salary": salary,
        "contract_years": 1,
        "source": "sheet",
        "roster_status": "active",
        "contract": {
            **build_rookie_contract(salary, 2),
            "years_remaining": 1,
            "schedule": [{"year_offset": 0, "salary": salary}],
        },
    }


def test_server_ignores_client_start_salary():
    rules = load_preset("salary_cap_auction_v1")
    row = _final_year_rookie(salary=10)
    assert compute_rookie_extension_start_salary(row, rules) == 15.0
    contract, applied = apply_rookie_extension_command(
        row, rules, extension_years=3, draft_completed=False
    )
    assert applied is False
    pending = contract["pending_extension"]
    assert pending["start_salary"] == 15.0
    assert pending["years"] == 3
    assert [y["salary"] for y in pending["contract"]["schedule"]] == [15, 20, 25]


def test_idempotent_same_years_and_reject_conflict():
    rules = load_preset("salary_cap_auction_v1")
    row = _final_year_rookie()
    first, _ = apply_rookie_extension_command(row, rules, extension_years=2, draft_completed=False)
    row["contract"] = first
    second, already = apply_rookie_extension_command(
        row, rules, extension_years=2, draft_completed=False
    )
    assert already is True
    assert second["pending_extension"]["years"] == 2

    with pytest.raises(ValueError, match="already queued"):
        apply_rookie_extension_command(row, rules, extension_years=3, draft_completed=False)


def test_eligibility_gates_window_type_and_years():
    rules = load_preset("salary_cap_auction_v1")
    row = _final_year_rookie()

    ok, _ = can_manager_rookie_extend(row, rules, draft_completed=False)
    assert ok is True

    ok, msg = can_manager_rookie_extend(row, rules, draft_completed=True)
    assert ok is False
    assert "before the draft" in msg.lower()

    mid = _final_year_rookie(player_id="00-0039002")
    mid["contract"]["years_remaining"] = 2
    mid["contract_years"] = 2
    ok, msg = can_manager_rookie_extend(mid, rules, draft_completed=False)
    assert ok is False
    assert "final year" in msg.lower()

    vet = _final_year_rookie(player_id="00-0039003")
    vet["contract"]["contract_type"] = "veteran"
    ok, msg = can_manager_rookie_extend(vet, rules, draft_completed=False)
    assert ok is False
    assert "veteran" in msg.lower()


def test_one_and_three_year_durations_survive_draft_complete_tick():
    rules = load_preset("salary_cap_auction_v1")
    one = _final_year_rookie(player_id="ext-1", salary=10)
    three = _final_year_rookie(player_id="ext-3", salary=12)
    one["contract"], _ = apply_rookie_extension_command(
        one, rules, extension_years=1, draft_completed=False
    )
    three["contract"], _ = apply_rookie_extension_command(
        three, rules, extension_years=3, draft_completed=False
    )

    summary = advance_roster_contracts_for_draft_complete(rules, [one, three])
    assert summary["extensions_activated"] == 2
    by_id = {u["player_id"]: u for u in summary["updates"]}
    assert by_id["ext-1"]["contract"]["years_remaining"] == 1
    assert by_id["ext-1"]["contract"]["contract_type"] == "extension"
    assert by_id["ext-3"]["contract"]["years_remaining"] == 3
    assert [y["salary"] for y in by_id["ext-3"]["contract"]["schedule"]] == [17, 22, 27]


def test_manager_rookie_extend_endpoint_own_team_only(hub_db):
    rules = LeagueRules()
    league = storage.create_league("comm-ext", "Extend League", 2026, rules, team_count=10)
    owner = storage.join_league("mgr-ext", league["room_code"], "Owner")
    other = storage.join_league("other-ext", league["room_code"], "Other")
    ws_id = storage.roster_workspace_for_league(league)

    mine = _final_year_rookie(player_id="00-0039101", salary=10)
    theirs = _final_year_rookie(player_id="00-0039102", salary=11)
    storage.add_roster_slot(ws_id, mine, team_id=owner["id"])
    storage.add_roster_slot(ws_id, theirs, team_id=other["id"])

    client = _client_for("mgr-ext")
    try:
        # Client salary must be ignored — server uses 10 + 5 = 15.
        ok = client.post(
            "/api/hub/contract/rookie-extend",
            json={"player_id": "00-0039101", "extension_years": 3, "start_salary": 99},
        )
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert body["pending_extension"] is True
        assert body["already_applied"] is False
        assert body["start_salary"] == 15.0
        assert body["extension_years"] == 3
        pending = body["slot"]["contract"]["pending_extension"]
        assert pending["start_salary"] == 15.0
        assert [y["salary"] for y in pending["contract"]["schedule"]] == [15, 20, 25]

        again = client.post(
            "/api/hub/contract/rookie-extend",
            json={"player_id": "00-0039101", "extension_years": 3},
        )
        assert again.status_code == 200
        assert again.json()["already_applied"] is True

        blocked = client.post(
            "/api/hub/contract/rookie-extend",
            json={"player_id": "00-0039102", "extension_years": 1},
        )
        assert blocked.status_code == 403
        assert "own team" in blocked.json()["detail"].lower()

        # Legacy renew alias also works for managers (no commissioner gate).
        vet = _final_year_rookie(player_id="00-0039103", salary=8)
        vet["contract"]["contract_type"] = "veteran"
        storage.add_roster_slot(ws_id, vet, team_id=owner["id"])
        bad = client.post(
            "/api/hub/contract/renew",
            json={"player_id": "00-0039103", "extension_years": 1, "start_salary": 1},
        )
        assert bad.status_code == 400
        assert "veteran" in bad.json()["detail"].lower() or "rookie" in bad.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_legacy_extend_ignores_new_salary(hub_db):
    rules = LeagueRules()
    league = storage.create_league("comm-legacy", "Legacy Ext", 2026, rules, team_count=8)
    team = storage.get_team_by_user(league["id"], "comm-legacy")
    ws_id = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(ws_id, _final_year_rookie(player_id="00-0039201", salary=12), team_id=team["id"])

    client = _client_for("comm-legacy")
    try:
        res = client.post(
            "/api/hub/contract/extend",
            json={"player_id": "00-0039201", "extension_years": 1, "new_salary": 50},
        )
        assert res.status_code == 200, res.text
        assert res.json()["start_salary"] == 17.0
        assert res.json()["slot"]["contract"]["pending_extension"]["start_salary"] == 17.0
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
