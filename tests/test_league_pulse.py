"""Home league-pulse feed — recent movement + executed trades, newest first."""

from __future__ import annotations

import json

import pytest

from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_client():
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user

    app.dependency_overrides[require_hub_user] = lambda: {
        "sub": "dev",
        "auth_type": "dev",
        "name": "Dev",
    }
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def _insert_movement(league_id: str, *, player: str, kind: str, at: str, **extra) -> None:
    with storage.get_conn() as conn:
        conn.execute(
            """INSERT INTO league_player_movement (
                   league_id, season_year, player_name, event_type,
                   from_owner, to_owner, salary, dead_cap, source, event_at, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test', ?, ?)""",
            (
                league_id,
                2026,
                player,
                kind,
                extra.get("from_owner"),
                extra.get("to_owner"),
                extra.get("salary"),
                extra.get("dead_cap"),
                at,
                at,
            ),
        )


def test_pulse_merges_moves_and_trades_newest_first(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    league = storage.create_league("dev", "Pulse League", 2026, LeagueRules())
    lid = league["id"]

    _insert_movement(lid, player="S. Tucker", kind="cut", at="2026-08-01T10:00:00Z",
                     from_owner="Stephen P", dead_cap=1.0)
    _insert_movement(lid, player="Rico Dowdle", kind="waiver", at="2026-08-03T10:00:00Z",
                     to_owner="Disappointment", salary=7.0)
    with storage.get_conn() as conn:
        conn.execute(
            """INSERT INTO trade_log (league_id, team_a_id, team_b_id, send_a_json, send_b_json, created_at)
               VALUES (?, 'ta', 'tb', ?, ?, '2026-08-02T10:00:00Z')""",
            (
                lid,
                json.dumps({"players": [{"player_name": "Breece Hall"}]}),
                json.dumps({"players": [{"player_name": "Jayden Reed"}]}),
            ),
        )

    res = hub_client.get(f"/api/hub/league/{lid}/pulse")
    assert res.status_code == 200
    events = res.json()["events"]
    assert [e["kind"] for e in events] == ["waiver", "trade", "cut"]
    assert events[0]["player_name"] == "Rico Dowdle"
    assert events[0]["salary"] == 7.0
    assert events[1]["players_a"] == ["Breece Hall"]
    assert events[1]["players_b"] == ["Jayden Reed"]
    assert events[2]["dead_cap"] == 1.0

    limited = hub_client.get(f"/api/hub/league/{lid}/pulse?limit=2").json()["events"]
    assert len(limited) == 2


def test_pulse_requires_membership(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    league = storage.create_league("someone-else", "Not Yours", 2026, LeagueRules())
    res = hub_client.get(f"/api/hub/league/{league['id']}/pulse")
    assert res.status_code == 403
