"""Live Sleeper weekly scoring — pairing, cache TTL, route auth."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.draft_hub import storage
from src.draft_hub.league_live_scoring import (
    LIVE_SCORING_MAX_AGE_SECONDS,
    _live_cache_is_fresh,
    build_sleeper_live_week,
    get_sleeper_live_week,
    week_picker_meta,
)
from src.draft_hub.schemas import LeagueRules


SAMPLE_MATCHUPS = [
    {
        "roster_id": 1,
        "matchup_id": 3,
        "points": 84.2,
        "starters": ["p1", "p2"],
        "players_points": {"p1": 12.4, "p2": 8.0},
    },
    {
        "roster_id": 2,
        "matchup_id": 3,
        "points": 76.5,
        "starters": ["p3"],
        "players_points": {"p3": 15.2},
    },
    {
        "roster_id": 3,
        "matchup_id": 4,
        "points": 90.0,
        "starters": ["p4"],
        "players_points": {"p4": 20.0},
    },
    {
        "roster_id": 4,
        "matchup_id": 4,
        "points": 88.1,
        "starters": ["p5"],
        "players_points": {"p5": 18.3},
    },
]

SAMPLE_LEAGUE = {"season": "2025", "status": "in_season"}
SAMPLE_PLAYERS = {
    "p1": {"full_name": "Alpha QB", "position": "QB", "team": "KC", "gsis_id": "00-0001"},
    "p2": {"full_name": "Alpha RB", "position": "RB", "team": "KC"},
    "p3": {"full_name": "Beta WR", "position": "WR", "team": "BUF", "gsis_id": "00-0002"},
    "p4": {"full_name": "Gamma TE", "position": "TE", "team": "SF"},
    "p5": {"full_name": "Delta RB", "position": "RB", "team": "DAL"},
}


def test_build_sleeper_live_week_pairs_matchups(monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring._fetch_json",
        lambda url: SAMPLE_LEAGUE if "/league/" in url and "/matchups/" not in url else SAMPLE_MATCHUPS,
    )
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.load_sleeper_players",
        lambda: SAMPLE_PLAYERS,
    )
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.get_nfl_state",
        lambda **_: {"week": 5, "season": "2025", "season_type": "regular"},
    )

    hub_teams = [
        {"sleeper_roster_id": "1", "name": "Hub One"},
        {"sleeper_roster_id": "2", "name": "Hub Two"},
    ]
    out = build_sleeper_live_week("sl-1", 5, hub_teams=hub_teams, viewer_roster_id="1")

    assert out["available"] is True
    assert out["week"] == 5
    assert out["viewer_matchup_id"] == "3"
    assert len(out["matchups"]) == 2

    viewer_match = next(m for m in out["matchups"] if m["matchup_id"] == "3")
    assert len(viewer_match["teams"]) == 2
    viewer = next(t for t in viewer_match["teams"] if t["is_viewer"])
    opponent = next(t for t in viewer_match["teams"] if t["is_opponent"])
    assert viewer["team_name"] == "Hub One"
    assert opponent["team_name"] == "Hub Two"
    assert viewer["points"] == 84.2
    assert viewer["starters"][0]["name"] == "Alpha QB"
    assert viewer["starters"][0]["points"] == 12.4
    assert out["current_week"] == 5
    assert out["max_week"] >= 18


def test_live_cache_ttl_skips_rebuild(monkeypatch, hub_db):
    payload = {
        "available": True,
        "week": 5,
        "matchups": [],
        "synced_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    storage.upsert_sleeper_live_scoring_cache("sl-cache", 5, payload)

    def _boom(*_a, **_k):
        raise AssertionError("should not rebuild while cache fresh")

    monkeypatch.setattr("src.draft_hub.league_live_scoring.build_sleeper_live_week", _boom)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.resolve_current_week",
        lambda **_: (5, {"week": 5, "season": "2025"}),
    )

    out = get_sleeper_live_week("sl-cache", refresh=False)
    assert out["cached"] is True
    assert out["available"] is True


def test_live_cache_stale_triggers_rebuild(monkeypatch, hub_db):
    stale = datetime.now(timezone.utc) - timedelta(seconds=LIVE_SCORING_MAX_AGE_SECONDS + 5)
    storage.upsert_sleeper_live_scoring_cache(
        "sl-stale",
        5,
        {"available": True, "week": 5, "matchups": []},
    )
    with storage.get_conn() as conn:
        conn.execute(
            "UPDATE sleeper_live_scoring_cache SET synced_at = ? WHERE sleeper_league_id = ?",
            (stale.isoformat().replace("+00:00", "Z"), "sl-stale"),
        )

    calls: list[str] = []

    def _build(*_a, **_k):
        calls.append("build")
        return {"available": True, "week": 5, "matchups": [], "synced_at": "now"}

    monkeypatch.setattr("src.draft_hub.league_live_scoring.build_sleeper_live_week", _build)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.resolve_current_week",
        lambda **_: (5, {"week": 5, "season": "2025"}),
    )

    out = get_sleeper_live_week("sl-stale", refresh=False)
    assert calls == ["build"]
    assert out["cached"] is False


def test_live_cache_is_fresh_boundary():
    fresh = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    assert _live_cache_is_fresh(fresh) is True
    old = (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat().replace("+00:00", "Z")
    assert _live_cache_is_fresh(old) is False


def test_week_picker_meta_includes_current_and_max():
    meta = week_picker_meta({"week": 7}, {"settings": {"playoff_week_start": 15}})
    assert meta["current_week"] == 7
    assert meta["max_week"] >= 18


@pytest.fixture()
def hub_client():
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user

    # Pin the viewer to "dev" and clear leftover overrides from other API tests
    # (the app singleton otherwise keeps require_hub_user bound to another sub).
    app.dependency_overrides[require_hub_user] = lambda: {
        "sub": "dev",
        "auth_type": "dev",
        "name": "Dev",
    }
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_live_scoring_route_no_sleeper(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    league = storage.create_league("dev", "Live League", 2026, LeagueRules())
    res = hub_client.get(f"/api/hub/league/{league['id']}/live-scoring")
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is False
    assert body["reason"] == "no_sleeper_league"


def test_live_scoring_route_serves_cache(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    league = storage.create_league("dev", "Cached Live", 2026, LeagueRules())
    storage.update_league_sleeper_id(league["id"], "sl-live-cache")
    storage.upsert_sleeper_live_scoring_cache(
        "sl-live-cache",
        5,
        {
            "available": True,
            "week": 5,
            "season": "2026",
            "matchups": [{"matchup_id": "1", "teams": []}],
        },
    )

    def _boom(*_a, **_k):
        raise AssertionError("live fetch on cached read")

    monkeypatch.setattr("src.draft_hub.league_live_scoring.build_sleeper_live_week", _boom)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.resolve_current_week",
        lambda **_: (5, {"week": 5, "season": "2026"}),
    )

    res = hub_client.get(f"/api/hub/league/{league['id']}/live-scoring")
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body.get("cached") is True
    assert body["week"] == 5


def test_live_scoring_route_week_param(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    league = storage.create_league("dev", "Week Param", 2026, LeagueRules())
    storage.update_league_sleeper_id(league["id"], "sl-week-param")

    def _build(_lid, week, **_kwargs):
        return {
            "available": True,
            "week": int(week),
            "matchups": [],
            "current_week": 5,
            "max_week": 18,
            "synced_at": "now",
        }

    monkeypatch.setattr("src.draft_hub.league_live_scoring.build_sleeper_live_week", _build)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.resolve_current_week",
        lambda **kw: (int(kw.get("week_override") or 5), {"week": 5, "season": "2026"}),
    )

    res = hub_client.get(f"/api/hub/league/{league['id']}/live-scoring?week=3")
    assert res.status_code == 200
    assert res.json()["week"] == 3


def test_live_scoring_route_forbidden_for_non_member(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    league = storage.create_league("comm-live", "Other League", 2026, LeagueRules())

    def _wrong_ctx(_sub):
        return {"league_id": "other-league", "mode": "league"}

    monkeypatch.setattr("app.hub_routes._ctx", _wrong_ctx)
    res = hub_client.get(f"/api/hub/league/{league['id']}/live-scoring")
    assert res.status_code == 403
