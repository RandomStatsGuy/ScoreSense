"""SCORE-10 Phase-aware League Home + action center — unit + API payload tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.contracts import build_rookie_contract
from src.draft_hub.league_home import (
    PHASE_IN_SEASON,
    PHASE_LIVE_DRAFT,
    PHASE_OFFSEASON,
    PHASE_PRE_DRAFT,
    build_league_home,
    resolve_league_phase,
)
from src.draft_hub.presets import load_preset


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.pop(require_hub_user, None)


def _seed_league(hub_db, *, sub: str = "home-comm", draft_completed: bool = False):
    ws = storage.get_or_create_workspace(sub, season=2026)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(sub, "Bottom to Top", 2026, rules, workspace_id=ws["id"])
    team = storage.get_team_by_user(league["id"], sub)
    if draft_completed:
        storage.update_league_settings(league["id"], draft_completed=True)
        storage.update_league_status(league["id"], "completed")
    return league, team, ws, sub, rules


def test_resolve_phase_pre_draft():
    phase = resolve_league_phase(
        draft_completed=False,
        league_status="setup",
        draft_session_status="setup",
        nfl_season_type="off",
    )
    assert phase["id"] == PHASE_PRE_DRAFT
    assert phase["primary_cta"]["view"] == "value"
    assert phase["primary_cta"]["label"] == "Draft plan"


def test_resolve_phase_live_draft():
    phase = resolve_league_phase(
        draft_completed=False,
        league_status="live",
        draft_session_status="nominating",
        nfl_season_type="pre",
    )
    assert phase["id"] == PHASE_LIVE_DRAFT
    assert phase["primary_cta"]["view"] == "room"


def test_resolve_phase_in_season():
    phase = resolve_league_phase(
        draft_completed=True,
        league_status="completed",
        draft_session_status="completed",
        nfl_season_type="regular",
    )
    assert phase["id"] == PHASE_IN_SEASON
    assert phase["primary_cta"]["view"] == "week"


def test_resolve_phase_offseason():
    phase = resolve_league_phase(
        draft_completed=True,
        league_status="completed",
        draft_session_status="completed",
        nfl_season_type="off",
    )
    assert phase["id"] == PHASE_OFFSEASON
    assert phase["primary_cta"]["view"] == "roster"


def test_league_home_pre_draft_actions(hub_db):
    league, team, _ws, sub, _rules = _seed_league(hub_db)
    roster_ws = storage.roster_workspace_for_league(league)

    # Over-cap stack + expiring rookie.
    storage.add_roster_slot(
        roster_ws,
        {
            "player_id": "00-expensive",
            "player_name": "Cap Hog",
            "team": "KC",
            "position": "WR",
            "salary": 180,
            "contract_years": 2,
        },
        team_id=team["id"],
    )
    storage.add_roster_slot(
        roster_ws,
        {
            "player_id": "00-rookie1",
            "player_name": "Expiring Rook",
            "team": "SF",
            "position": "RB",
            "salary": 10,
            "contract_years": 1,
            "contract": {
                **build_rookie_contract(10, 2),
                "years_remaining": 1,
                "schedule": [{"year_offset": 0, "salary": 10}],
            },
        },
        team_id=team["id"],
    )
    storage.add_roster_slot(
        roster_ws,
        {
            "player_id": "00-vet2",
            "player_name": "More Cap",
            "team": "BUF",
            "position": "QB",
            "salary": 90,
            "contract_years": 2,
        },
        team_id=team["id"],
    )

    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context(sub)
    stale_built = (datetime.now(timezone.utc) - timedelta(days=50)).isoformat()

    with (
        patch("src.draft_hub.league_home._nfl_season_type", return_value="off"),
        patch(
            "src.draft_hub.league_home.league_data_freshness",
            return_value={
                "available": True,
                "league_id": league["id"],
                "sleeper": {"synced_at": None, "linked": True},
                "scoring": {"synced_at": None, "linked": True},
                "cap_sheets": {
                    "stale": False,
                    "last_imported_at": None,
                    "has_commissioner_files": False,
                },
                "projections": {
                    "built_at": stale_built,
                    "stale": True,
                    "available": True,
                    "season": 2026,
                },
            },
        ),
    ):
        payload = build_league_home(ctx, include_week=False)

    assert payload["phase"]["id"] == PHASE_PRE_DRAFT
    assert payload["status_line"].startswith("Bottom to Top")
    assert "Pre-draft" in payload["status_line"]
    assert payload["meta"]["live_sleeper"] is False
    assert payload["meta"]["persists_nothing"] is True
    assert payload["checklist"]["default_view"] == "value"

    action_ids = [a["id"] for a in payload["actions"]]
    assert "cap_overage" in action_ids
    assert "expiring_contracts" in action_ids
    assert "projections_stale" in action_ids

    overage = next(a for a in payload["actions"] if a["id"] == "cap_overage")
    assert overage["amount"] > 0
    assert overage["href"] == "planner"

    expiring = next(a for a in payload["actions"] if a["id"] == "expiring_contracts")
    assert expiring["count"] >= 1
    assert expiring["href"] == "roster"

    assert payload["attention"]["line"]
    assert "over" in payload["attention"]["line"].lower() or "projection" in payload["attention"]["line"].lower()
    assert payload["freshness"]["projections"]["days_old"] == 50
    assert payload["pre_draft"] is not None
    assert payload["pre_draft"]["expiring_before_draft_count"] >= 1
    assert payload["week_summary"]["available"] is False
    assert any(a["id"] == "invite_managers" for a in payload["actions"])


def test_league_home_in_season_lineup_action(hub_db):
    league, team, _ws, sub, _rules = _seed_league(hub_db, draft_completed=True)
    roster_ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        roster_ws,
        {
            "player_id": "p1",
            "player_name": "Starter",
            "team": "MIA",
            "position": "WR",
            "salary": 20,
            "contract_years": 2,
        },
        team_id=team["id"],
    )

    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context(sub)

    fake_week = {
        "counts": {"decisions": 1},
        "meta": {"season": 2026, "week": 3},
        "summary": {"headline": "1 lineup decision needs attention"},
    }

    with (
        patch("src.draft_hub.league_home._nfl_season_type", return_value="regular"),
        patch(
            "src.draft_hub.league_home.league_data_freshness",
            return_value={
                "available": True,
                "sleeper": {"synced_at": "2026-08-01T00:00:00+00:00", "linked": True},
                "scoring": {"synced_at": None, "linked": True},
                "cap_sheets": {
                    "stale": False,
                    "last_imported_at": None,
                    "has_commissioner_files": False,
                },
                "projections": {
                    "built_at": "2026-08-14T00:00:00+00:00",
                    "stale": False,
                    "available": True,
                    "season": 2026,
                },
            },
        ),
        patch(
            "src.draft_hub.weekly_command_center.build_weekly_command_center",
            return_value=fake_week,
        ),
    ):
        payload = build_league_home(ctx, include_week=True)

    assert payload["phase"]["id"] == PHASE_IN_SEASON
    assert payload["phase"]["primary_cta"]["view"] == "week"
    assert payload["week_summary"]["available"] is True
    assert payload["week_summary"]["decision_count"] == 1
    assert any(a["id"] == "lineup_decisions" for a in payload["actions"])
    lineup = next(a for a in payload["actions"] if a["id"] == "lineup_decisions")
    assert lineup["count"] == 1
    assert lineup["href"] == "week"


def test_league_home_never_live_sleeper(hub_db):
    league, team, _ws, sub, _rules = _seed_league(hub_db)
    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context(sub)
    with (
        patch("src.draft_hub.league_home._nfl_season_type", return_value="off"),
        patch(
            "src.draft_hub.league_home.list_roster_for_context",
            wraps=__import__(
                "src.draft_hub.hub_context", fromlist=["list_roster_for_context"]
            ).list_roster_for_context,
        ) as roster_mock,
        patch(
            "src.draft_hub.league_home.league_data_freshness",
            return_value={
                "available": True,
                "sleeper": {"synced_at": None, "linked": False},
                "scoring": {"synced_at": None, "linked": False},
                "cap_sheets": {
                    "stale": False,
                    "last_imported_at": None,
                    "has_commissioner_files": False,
                },
                "projections": {
                    "built_at": None,
                    "stale": True,
                    "available": False,
                    "season": 2026,
                },
            },
        ),
    ):
        build_league_home(ctx, include_week=False)
    roster_mock.assert_called()
    assert roster_mock.call_args.kwargs.get("live_sleeper") is False


def test_hub_home_api_payload(hub_db):
    league, team, _ws, sub, _rules = _seed_league(hub_db)
    storage.update_league_sleeper_id(league["id"], "sleeper-xyz")
    roster_ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        roster_ws,
        {
            "player_id": "api-p1",
            "player_name": "API Player",
            "team": "DAL",
            "position": "WR",
            "salary": 25,
            "contract_years": 2,
        },
        team_id=team["id"],
    )

    client = _client_for(sub)
    with (
        patch("src.draft_hub.league_home._nfl_season_type", return_value="off"),
        patch(
            "src.draft_hub.league_home.league_data_freshness",
            return_value={
                "available": True,
                "sleeper": {"synced_at": None, "linked": True},
                "scoring": {"synced_at": None, "linked": True},
                "cap_sheets": {
                    "stale": False,
                    "last_imported_at": None,
                    "has_commissioner_files": False,
                },
                "projections": {
                    "built_at": "2026-08-01T00:00:00+00:00",
                    "stale": False,
                    "available": True,
                    "season": 2026,
                },
            },
        ),
    ):
        res = client.get("/api/hub/home?include_week=false")

    assert res.status_code == 200
    body = res.json()
    assert body["phase"]["id"] == PHASE_PRE_DRAFT
    assert "actions" in body
    assert "attention" in body
    assert "cap" in body
    assert body["hub_context"]["league_id"] == league["id"]
    assert body["meta"]["built_for"] == "SCORE-10"


def test_health_feature_league_home():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["features"]["league_home"] is True


def test_solo_home_payload(hub_db):
    sub = "solo-home-user"
    storage.get_or_create_workspace(sub, season=2026)
    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context(sub)
    assert ctx["mode"] == "solo"

    with (
        patch("src.draft_hub.league_home._nfl_season_type", return_value="off"),
        patch(
            "src.draft_hub.hub_freshness._draft_pool_status",
            return_value={
                "season": 2026,
                "available": True,
                "built_at": "2026-08-10T00:00:00+00:00",
                "stale": False,
            },
        ),
    ):
        payload = build_league_home(ctx, include_week=False)

    assert payload["hub_context"]["mode"] == "solo"
    assert payload["phase"]["id"] == PHASE_PRE_DRAFT
    assert "Solo prep" in payload["status_line"]
