"""Ordinary acquisitions use server terms; staff and transfers keep their authority."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.acquisition_window import player_survives_upcoming_draft
from src.draft_hub.pre_draft_cap import expires_before_draft
from src.draft_hub.schemas import LeagueRules


@pytest.fixture
def instant_league(hub_db, trusted_native_catalog, monkeypatch):
    monkeypatch.setattr("src.draft_hub.acquisition_window.get_nfl_state",
                        lambda *a, **k: {"season": 2026, "season_type": "regular", "week": 1})
    monkeypatch.setattr("src.draft_hub.league_live_scoring.get_nfl_state",
                        lambda *a, **k: {"season": 2026, "season_type": "regular", "week": 1})
    monkeypatch.setattr("src.draft_hub.acquisition_window._now_et",
                        lambda now=None: datetime(2026, 9, 10, 10, tzinfo=ZoneInfo("America/New_York")))
    monkeypatch.setattr("src.core.schedule_utils.current_projection_week", lambda *a, **k: 1)
    monkeypatch.setattr("src.draft_hub.hub_scoring._utcnow", lambda: datetime(2026, 9, 1, tzinfo=timezone.utc))
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_game_started", lambda *a, **k: False)
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_week_slate_complete", lambda *a, **k: False)
    rules = LeagueRules(roster={"wr": {"max": 10, "starter": 1}}, auction={"min_bid": 5})
    league = storage.create_league("instant-owner", "Instant acquisition", 2026, rules, team_count=2)
    storage.update_league_settings(league["id"], draft_completed=True)
    home = storage.get_team_by_user(league["id"], "instant-owner")
    away = storage.join_league("instant-manager", league["room_code"], "Manager")
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "instant-manager", "auth_type": "dev"}

    def body(pid="incoming", **fields):
        trusted_native_catalog(pid, name=f"Player {pid}", team="KC", position="WR")
        return {"player_id": pid, "player_name": f"Player {pid}", "team": "KC", "position": "WR",
                "salary": 0, "contract_years": 1, **fields}

    try:
        yield league, home, away, rules, body, TestClient(app)
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


@pytest.mark.parametrize("submitted", [
    {"salary": 0},
    {"salary": 0, "contract_years": 99, "contract_type": "extension", "source": "draft", "acquisition_type": "draft"},
    {"salary": 100, "contract_years": 3, "contract_type": "rookie", "source": "auction", "acquisition_type": "post_draft_fa"},
    {"salary": 8, "contract_years": -5, "contract_type": "forged", "source": "forged", "acquisition_type": "forged"},
])
def test_native_auction_instant_terms_ignore_client_staff_fields(instant_league, submitted):
    league, _, away, _, body, client = instant_league
    response = client.post("/api/hub/roster", json=body(**submitted))
    assert response.status_code == 200, response.text
    row = response.json()["slot"]
    assert row["team_id"] == away["id"] and row["salary"] == 1 and row["contract_years"] == 1
    assert row["source"] == "free_agency"
    contract = row["contract"]
    assert contract["source"] == "free_agency" and contract["acquisition_type"] == "fa_contract"
    assert contract["contract_type"] == "veteran" and not contract.get("contract_type_manual")
    assert contract["schedule"] == [{"year_offset": 0, "salary": 1}]
    assert not player_survives_upcoming_draft(row)
    assert expires_before_draft(row, draft_completed=False)
    assert not storage.list_fa_bids(league["id"], status=None)


@pytest.mark.parametrize("draft_type", ["snake", "linear"])
def test_pick_instant_terms_have_no_financial_type(instant_league, draft_type):
    league, _, _, rules, body, client = instant_league
    rules.draft_type = draft_type
    rules.salary_cap = 0
    storage.update_league_rules(league["id"], rules)
    response = client.post("/api/hub/roster", json=body(
        salary=100, contract_years=99, contract_type="extension", source="draft", acquisition_type="fa_contract"))
    assert response.status_code == 200, response.text
    row = response.json()["slot"]
    assert row["salary"] == 0 and row["contract_years"] == 1 and row["source"] == "free_agency"
    assert row["contract"] == {"current_salary": 0.0, "years_remaining": 1,
                               "acquisition_type": "free_agency", "source": "free_agency"}


def test_actual_one_dollar_fee_controls_cap_even_when_client_submits_zero(instant_league):
    league, _, away, rules, body, client = instant_league
    rules.salary_cap = 0.5
    storage.update_league_rules(league["id"], rules)
    response = client.post("/api/hub/roster", json=body("unaffordable", salary=0))
    assert response.status_code == 400 and "Over cap" in response.text
    assert storage.list_team_roster(league["id"], away["id"]) == []
    rules.salary_cap = 1
    storage.update_league_rules(league["id"], rules)
    response = client.post("/api/hub/roster", json=body("affordable", salary=99))
    assert response.status_code == 200, response.text
    assert response.json()["slot"]["salary"] == 1
    response = client.post("/api/hub/roster", json=body("second", salary=0))
    assert response.status_code == 400 and "Over cap" in response.text
    assert len(storage.list_team_roster(league["id"], away["id"])) == 1


def test_explicit_commissioner_staff_override_keeps_manual_terms(instant_league):
    league, _, _, rules, body, client = instant_league
    rules.salary_cap = 1
    storage.update_league_rules(league["id"], rules)
    payload = body(salary=15, contract_years=3, contract_type="extension", source="auction", staff_edit=True)
    denied = client.post("/api/hub/roster", json=payload)
    assert denied.status_code == 403
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "instant-owner", "auth_type": "dev"}
    response = client.post("/api/hub/roster", json=payload)
    assert response.status_code == 200, response.text
    row = response.json()["slot"]
    assert row["salary"] == 15 and row["contract_years"] == 3 and row["source"] == "auction"
    assert row["contract"]["contract_type"] == "extension" and row["contract"]["contract_type_manual"]


def test_force_transfer_keeps_actual_existing_contract(instant_league):
    league, home, away, _, body, client = instant_league
    from src.draft_hub.contracts import build_contract_from_roster_edit
    rules = LeagueRules.model_validate(storage.get_league(league["id"])["rules"])
    original = build_contract_from_roster_edit(rules, current_salary=19, years_remaining=3, contract_type="extension")
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, {**body("carried", salary=19, contract_years=3),
                                       "contract": original, "source": "auction"}, team_id=home["id"])
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "instant-owner", "auth_type": "dev"}
    response = client.post("/api/hub/roster", json=body(
        "carried", salary=0, contract_years=99, contract_type="forged", source="draft", acquisition_type="fa_contract",
        team_id=away["id"], force=True))
    assert response.status_code == 200, response.text
    row = response.json()["slot"]
    assert row["team_id"] == away["id"] and row["salary"] == 19 and row["contract_years"] == 3
    assert row["contract"] == original and row["source"] == "auction"
