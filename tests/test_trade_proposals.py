"""Multi-party trade proposals, dead-cap assign, and member roster reads."""

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.presets import load_preset
from src.draft_hub.draft_state import start_draft
from src.draft_hub.trade_proposals import (
    execute_multiparty_trade,
    force_execute_proposal,
    propose_trade,
    respond_to_proposal,
    validate_trade_package,
)


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _two_team_league(hub_db, *, a_salary=40, b_salary=35):
    comm = "prop-comm"
    member = "prop-member"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Prop League", 2026, rules, workspace_id=ws["id"])
    team_a = storage.get_team_by_user(league["id"], comm)
    team_b = storage.join_league(member, league["room_code"], "Team B")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "p-a",
            "player_name": "Player A",
            "team": "SEA",
            "position": "WR",
            "salary": a_salary,
            "contract_years": 2,
        },
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "p-b",
            "player_name": "Player B",
            "team": "SF",
            "position": "RB",
            "salary": b_salary,
            "contract_years": 1,
        },
        team_id=team_b["id"],
    )
    return league, team_a, team_b, ws, comm, member


def test_member_can_read_league_rosters(hub_db):
    league, team_a, team_b, ws, comm, member = _two_team_league(hub_db)
    client = _client_for(member)
    try:
        res = client.get(f"/api/hub/league/{league['id']}/rosters")
        assert res.status_code == 200
        data = res.json()
        assert len(data["teams"]) >= 2
        assert "stats" in data["teams"][0]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_propose_accept_executes(hub_db):
    league, team_a, team_b, ws, comm, member = _two_team_league(hub_db)
    prop = propose_trade(
        league["id"],
        created_by_sub=comm,
        proposer_team_id=team_a["id"],
        parties=[
            {"team_id": team_a["id"], "sends": ["p-a"], "drops": []},
            {"team_id": team_b["id"], "sends": ["p-b"], "drops": []},
        ],
    )
    assert prop["status"] == "pending"
    assert prop["acceptances"][team_a["id"]] == "accepted"
    assert prop["acceptances"][team_b["id"]] == "pending"

    updated = respond_to_proposal(
        prop["id"], team_id=team_b["id"], approve=True, user_sub=member
    )
    assert updated["status"] == "executed"
    assert storage.get_roster_slot(ws["id"], "p-a")["team_id"] == team_b["id"]
    assert storage.get_roster_slot(ws["id"], "p-b")["team_id"] == team_a["id"]


def test_dead_cap_assign_on_drop(hub_db):
    league, team_a, team_b, ws, comm, member = _two_team_league(hub_db, a_salary=50, b_salary=10)
    # A drops p-a and assigns dead cap to B; B sends p-b to A
    parties = [
        {"team_id": team_a["id"], "sends": [], "drops": ["p-a"]},
        {"team_id": team_b["id"], "sends": ["p-b"], "drops": []},
    ]
    assignments = [
        {
            "player_id": "p-a",
            "from_team_id": team_a["id"],
            "assigned_to_team_id": team_b["id"],
        }
    ]
    check = validate_trade_package(league["id"], parties, assignments)
    assert check["ok"], check["errors"]
    assert check["dead_cap_assignments"][0]["amount"] == 25.0  # 50% of 50

    execute_multiparty_trade(league["id"], parties, assignments)
    cut = storage.get_roster_slot(ws["id"], "p-a")
    assert cut["team_id"] == team_b["id"]
    assert cut["roster_status"] == "cut_before_draft"
    assert storage.get_roster_slot(ws["id"], "p-b")["team_id"] == team_a["id"]


def test_over_cap_with_dead_rejected(hub_db):
    league, team_a, team_b, ws, comm, member = _two_team_league(hub_db, a_salary=180, b_salary=180)
    # B already at 180; if A drops and assigns full dead (90) to B while B keeps 180 → over
    parties = [
        {"team_id": team_a["id"], "sends": [], "drops": ["p-a"]},
        {"team_id": team_b["id"], "sends": [], "drops": []},
    ]
    assignments = [
        {
            "player_id": "p-a",
            "from_team_id": team_a["id"],
            "assigned_to_team_id": team_b["id"],
        }
    ]
    check = validate_trade_package(league["id"], parties, assignments)
    assert not check["ok"]
    assert any("over cap" in e.lower() for e in check["errors"])


def test_mid_draft_trade_syncs_budgets_and_logs_event(hub_db):
    league, team_a, team_b, ws, comm, member = _two_team_league(hub_db, a_salary=40, b_salary=10)
    for pid in ("p-a", "p-b"):
        storage.update_roster_slot(ws["id"], pid, contract_years=2, any_team=True)
    start_draft(league["id"], comm)
    execute_multiparty_trade(
        league["id"],
        [
            {"team_id": team_a["id"], "sends": ["p-a"], "drops": []},
            {"team_id": team_b["id"], "sends": ["p-b"], "drops": []},
        ],
    )
    a = storage.get_team(team_a["id"])
    b = storage.get_team(team_b["id"])
    # Cap 200; after swap A holds $10, B holds $40.
    assert float(a["budget_remaining"]) == 190
    assert float(b["budget_remaining"]) == 160
    events = storage.list_draft_events(league["id"], limit=20)
    assert any(e.get("event_type") == "trade" for e in events)


def test_commissioner_force_apply(hub_db):
    league, team_a, team_b, ws, comm, member = _two_team_league(hub_db)
    prop = propose_trade(
        league["id"],
        created_by_sub=comm,
        proposer_team_id=team_a["id"],
        parties=[
            {"team_id": team_a["id"], "sends": ["p-a"], "drops": []},
            {"team_id": team_b["id"], "sends": ["p-b"], "drops": []},
        ],
    )
    forced = force_execute_proposal(prop["id"], commissioner_sub=comm)
    assert forced["status"] == "executed"
    assert storage.get_roster_slot(ws["id"], "p-a")["team_id"] == team_b["id"]
