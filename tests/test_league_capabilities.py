from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.hub_context import resolve_hub_context_for_league
from src.draft_hub.league_capabilities import acquisition_mode, league_capabilities, uses_priority_claims
from src.draft_hub.acquisition_window import TRADE_ACTIVE, resolve_acquisition_window
from src.draft_hub.pre_draft_cap import pre_draft_cap_summary
from src.draft_hub.rules_engine import blocking_acquisition_errors, validate_roster
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.trade_proposals import validate_trade_package


def _rules(draft_type: str, *, salary_cap: float = 200) -> LeagueRules:
    return LeagueRules.model_validate(
        {
            "draft_type": draft_type,
            "salary_cap": salary_cap,
            "roster": {"wr": {"min": 0, "max": 2, "starter": 1}},
        }
    )


def _league(hub_db, rules: LeagueRules):
    commissioner = "capability-commissioner"
    workspace = storage.get_or_create_workspace(commissioner)
    league = storage.create_league(
        commissioner,
        "Capability League",
        2026,
        rules,
        workspace_id=workspace["id"],
        team_count=2,
    )
    team_a = storage.get_team_by_user(league["id"], commissioner)
    team_b = storage.join_league("capability-member", league["room_code"], "Team B")
    return commissioner, workspace, league, team_a, team_b


def test_capabilities_follow_draft_type_not_cap_amount():
    auction = league_capabilities(_rules("auction", salary_cap=0))
    snake = league_capabilities(_rules("snake", salary_cap=200))

    assert auction["economics"] == "salary_cap"
    assert auction["uses_contracts"] is True
    assert auction["acquisition_mode"] == "bid"
    assert snake["economics"] == "none"
    assert snake["uses_contracts"] is False
    assert snake["acquisition_mode"] == "priority"
    assert acquisition_mode(_rules("linear")) == "priority"
    assert uses_priority_claims(_rules("snake")) is True
    assert uses_priority_claims(_rules("auction")) is False


def test_hub_context_exposes_capabilities_and_permissions(hub_db):
    commissioner, _workspace, league, _team_a, _team_b = _league(hub_db, _rules("linear"))

    context = resolve_hub_context_for_league(commissioner, league["id"])

    assert context["capabilities"]["economics"] == "none"
    assert context["capabilities"]["acquisition_mode"] == "priority"
    assert context["can_edit_salaries"] is False


def test_no_money_offseason_trades_do_not_require_surviving_contracts():
    window = resolve_acquisition_window(
        {
            "mode": "league",
            "draft_completed": True,
            "league_status": "active",
            "season": 2026,
            "rules": _rules("snake").model_dump(),
        },
        nfl_state={"season_type": "off", "season": 2026, "week": 1},
    )

    assert window["trade_scope"] == TRADE_ACTIVE


def test_no_money_validation_ignores_legacy_financial_fields():
    rules = _rules("snake", salary_cap=1)
    roster = [
        {
            "player_id": "wr-1",
            "player_name": "Legacy Contract",
            "position": "WR",
            "salary": 999,
            "contract_years": 99,
        }
    ]

    assert blocking_acquisition_errors(rules, roster) == []
    assert validate_roster(rules, roster) == []
    assert pre_draft_cap_summary(rules, roster) is None


def test_no_money_roster_add_persists_neutral_financial_values(hub_db):
    commissioner, _workspace, league, team_a, _team_b = _league(hub_db, _rules("snake"))
    app.dependency_overrides[require_hub_user] = lambda: {
        "sub": commissioner,
        "auth_type": "dev",
    }
    try:
        response = TestClient(app).post(
            "/api/hub/roster",
            json={
                "player_id": "new-wr",
                "player_name": "New Receiver",
                "position": "WR",
                "salary": 87,
                "contract_years": 4,
                "contract_type": "veteran",
                "team_id": team_a["id"],
                "staff_edit": True,
            },
        )
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

    assert response.status_code == 200, response.text
    slot = response.json()["slot"]
    assert slot["salary"] == 0
    assert slot["contract_years"] == 1
    assert (slot.get("contract") or {}).get("contract_type_manual") is not True


def test_no_money_trade_ignores_cap_but_keeps_roster_limits(hub_db):
    rules = _rules("snake")
    rules.roster["wr"]["max"] = 1
    _commissioner, workspace, league, team_a, team_b = _league(hub_db, rules)
    for player_id, team_id in (("a", team_a["id"]), ("b", team_b["id"])):
        storage.add_roster_slot(
            workspace["id"],
            {
                "player_id": player_id,
                "player_name": player_id.upper(),
                "position": "WR",
                "salary": 999,
                "contract_years": 99,
            },
            team_id=team_id,
        )

    balanced = validate_trade_package(
        league["id"],
        [
            {"team_id": team_a["id"], "sends": ["a"], "drops": []},
            {"team_id": team_b["id"], "sends": ["b"], "drops": []},
        ],
    )
    overloaded = validate_trade_package(
        league["id"],
        [
            {"team_id": team_a["id"], "sends": [], "drops": []},
            {"team_id": team_b["id"], "sends": ["b"], "drops": []},
        ],
    )

    assert balanced["ok"] is True
    assert balanced["salary_cap"] is None
    assert balanced["preview"][team_a["id"]]["committed"] is None
    assert overloaded["ok"] is False
    assert any("too many WR" in error for error in overloaded["errors"])


def test_no_money_instant_add_respects_waiver_protection(hub_db):
    from datetime import datetime, timedelta, timezone

    from src.draft_hub.priority_waivers import waiver_protection

    commissioner, _workspace, league, team_a, _team_b = _league(hub_db, _rules("snake"))
    stamp = storage._utcnow()
    eligible = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    with storage.get_conn() as conn:
        conn.execute(
            "INSERT INTO waiver_protection VALUES (?,?,?,?,?)",
            (league["id"], "protected-wr", team_a["id"], eligible, stamp),
        )
    assert waiver_protection(league["id"], "protected-wr") is not None
    app.dependency_overrides[require_hub_user] = lambda: {
        "sub": commissioner,
        "auth_type": "dev",
    }
    try:
        response = TestClient(app).post(
            "/api/hub/roster",
            json={
                "player_id": "protected-wr",
                "player_name": "Protected",
                "position": "WR",
                "salary": 0,
                "contract_years": 1,
                "team_id": team_a["id"],
            },
        )
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

    assert response.status_code == 400
    assert "waiver protection" in response.json()["detail"].lower()
