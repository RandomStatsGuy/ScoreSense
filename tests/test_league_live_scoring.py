"""Live Sleeper weekly scoring — pairing, cache TTL, route auth."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.draft_hub import storage
from src.draft_hub.league_live_scoring import (
    LIVE_SCORING_MAX_AGE_SECONDS,
    _live_cache_is_fresh,
    attach_matchup_analytics,
    build_sleeper_live_week,
    estimate_team_final,
    get_sleeper_live_week,
    starting_slots,
    week_picker_meta,
    win_probability,
)
from src.draft_hub.schemas import LeagueRules


SAMPLE_MATCHUPS = [
    {
        "roster_id": 1,
        "matchup_id": 3,
        "points": 84.2,
        "starters": ["p1", "p2"],
        "players": ["p1", "p2", "b1", "b2"],
        "players_points": {"p1": 12.4, "p2": 8.0, "b1": 18.4, "b2": 3.1},
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

SAMPLE_LEAGUE = {
    "season": "2025",
    "status": "in_season",
    "roster_positions": ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN", "IR"],
}

SAMPLE_ROSTERS = [
    {"roster_id": 1, "settings": {"wins": 6, "losses": 3, "fpts": 1104, "fpts_decimal": 60}},
    {"roster_id": 2, "settings": {"wins": 7, "losses": 2, "fpts": 1032, "fpts_decimal": 5}},
    {"roster_id": 3, "settings": {"wins": 7, "losses": 2, "fpts": 1200}},
    {"roster_id": 4, "settings": {"wins": 2, "losses": 7, "fpts": 803}},
]


def _fake_fetch(url):
    if "/matchups/" in url:
        return SAMPLE_MATCHUPS
    if url.endswith("/rosters"):
        return SAMPLE_ROSTERS
    return SAMPLE_LEAGUE
SAMPLE_PLAYERS = {
    "p1": {"full_name": "Alpha QB", "position": "QB", "team": "KC", "gsis_id": "00-0001"},
    "p2": {"full_name": "Alpha RB", "position": "RB", "team": "KC"},
    "p3": {"full_name": "Beta WR", "position": "WR", "team": "BUF", "gsis_id": "00-0002"},
    "p4": {"full_name": "Gamma TE", "position": "TE", "team": "SF"},
    "p5": {"full_name": "Delta RB", "position": "RB", "team": "DAL"},
    "b1": {"full_name": "Bench Star", "position": "WR", "team": "GB"},
    "b2": {"full_name": "Bench Two", "position": "RB", "team": "CHI"},
}


def test_build_sleeper_live_week_pairs_matchups(monkeypatch):
    monkeypatch.setattr("src.draft_hub.league_live_scoring._fetch_json", _fake_fetch)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.load_sleeper_players",
        lambda: SAMPLE_PLAYERS,
    )
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.get_nfl_state",
        lambda **_: {"week": 5, "season": "2025", "season_type": "regular"},
    )
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring._load_projection_lookup",
        lambda _season, _week: {},
    )

    hub_teams = [
        {"sleeper_roster_id": "1", "name": "Hub One", "owner_name": "Alice"},
        {"sleeper_roster_id": "2", "name": "Hub Two", "owner_name": "Bob"},
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
    assert viewer["owner_name"] == "Alice"
    assert opponent["team_name"] == "Hub Two"
    assert opponent["owner_name"] == "Bob"
    assert viewer["points"] == 84.2
    assert viewer["starters"][0]["name"] == "Alpha QB"
    assert viewer["starters"][0]["points"] == 12.4
    assert out["current_week"] == 5
    assert out["max_week"] >= 18

    # Game center additions ride the same payload.
    assert out["starting_slots"] == ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]
    assert [row["roster_id"] for row in out["standings"]] == ["3", "2", "1", "4"]
    assert out["standings"][0]["rank"] == 1
    assert out["standings"][2]["team_name"] == "Hub One"
    assert out["standings"][2]["points_for"] == 1104.6
    # Bench summary comes from players − starters on the matchup row.
    assert viewer["bench"] == {
        "points": 21.5,
        "count": 2,
        "top_name": "Bench Star",
        "top_points": 18.4,
    }
    # No projections mocked in → est_final equals live points.
    assert viewer["est_final"] == 84.2
    assert viewer_match["win_prob_by_roster"]["1"] == 1.0


def test_starting_slots_filters_hidden_and_normalizes_flex():
    assert starting_slots(["QB", "RB", "WRRB_FLEX", "SUPER_FLEX", "BN", "IR", "TAXI", "DEF"]) == [
        "QB",
        "RB",
        "FLEX",
        "FLEX",
        "DEF",
    ]
    assert starting_slots(None) == []


def test_estimate_and_win_probability_with_pending_projections():
    viewer = {
        "points": 60.0,
        "starters": [
            {"points": 20.0, "proj": 18.0},
            {"points": 0.0, "proj": 15.0},  # yet to play → pending
        ],
    }
    opponent = {
        "points": 70.0,
        "starters": [
            {"points": 30.0, "proj": 22.0},
            {"points": 0.0, "proj": 2.0},
        ],
    }
    estimate_team_final(viewer)
    estimate_team_final(opponent)
    assert viewer["points_pending"] == 15.0
    assert viewer["est_final"] == 75.0
    assert opponent["est_final"] == 72.0
    prob = win_probability(viewer, opponent)
    assert 0.5 < prob < 0.7, "small projected edge → modest favorite"
    # Once nothing is pending, the current leader is a lock.
    final_a = {"points": 101.2, "starters": [], "points_pending": 0, "est_final": 101.2}
    final_b = {"points": 88.0, "starters": [], "points_pending": 0, "est_final": 88.0}
    assert win_probability(final_a, final_b) == 1.0
    assert win_probability(final_b, final_a) == 0.0


def test_attach_matchup_analytics_joins_projection_index():
    matchups = [
        {
            "matchup_id": "3",
            "teams": [
                {
                    "roster_id": "1",
                    "points": 10.0,
                    "starters": [
                        {"player_id": "00-0001", "sleeper_player_id": "p1", "points": 10.0},
                        {"player_id": "sleeper-p2", "sleeper_player_id": "p2", "points": 0.0},
                    ],
                },
                {
                    "roster_id": "2",
                    "points": 0.0,
                    "starters": [
                        {"player_id": "", "sleeper_player_id": "p3", "points": 0.0},
                    ],
                },
            ],
        },
    ]
    index = {
        "00-0001": {"p50": 14.0},
        "sleeper-p2": {"p50": 9.5},
        "p3": {"p50": 11.0},
    }
    attach_matchup_analytics(matchups, index)
    team_a, team_b = matchups[0]["teams"]
    assert team_a["starters"][0]["proj"] == 14.0
    assert team_a["starters"][1]["proj"] == 9.5
    # Fallback lookup by bare sleeper id works for gsis-less players.
    assert team_b["starters"][0]["proj"] == 11.0
    assert team_a["est_final"] == 19.5
    assert team_b["est_final"] == 11.0
    probs = matchups[0]["win_prob_by_roster"]
    assert probs["1"] > 0.5
    assert probs["1"] + probs["2"] == 1.0


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
