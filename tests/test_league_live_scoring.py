"""Live Sleeper weekly scoring — pairing, cache TTL, route auth."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.draft_hub import storage
from src.draft_hub.league_live_scoring import (
    DEFAULT_STARTING_SLOTS,
    LIVE_SCORING_MAX_AGE_SECONDS,
    _attach_hub_team_names,
    _live_cache_is_fresh,
    attach_matchup_analytics,
    build_hub_placeholder_week,
    build_sleeper_live_week,
    estimate_team_final,
    get_sleeper_live_week,
    pair_placeholder_teams,
    refresh_sleeper_live_scoring_cache,
    sleeper_week_is_historical,
    starting_slots,
    starting_slots_from_rules,
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
    assert out.get("placeholder") is not True
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


def test_pair_placeholder_teams_rotates_and_handles_odd():
    teams = [
        {"id": "a", "name": "Alpha"},
        {"id": "b", "name": "Beta"},
        {"id": "c", "name": "Chi"},
    ]
    week1 = pair_placeholder_teams(teams, 1)
    assert week1[0][0]["name"] == "Alpha"
    assert week1[0][1]["name"] == "Beta"
    assert week1[1][0]["name"] == "Chi"
    assert week1[1][1] is None
    week2 = pair_placeholder_teams(teams, 2)
    assert week2[0][0]["name"] == "Beta"
    assert week2[0][1]["name"] == "Chi"
    assert week2[1][0]["name"] == "Alpha"
    assert pair_placeholder_teams([{"id": "1", "name": "Solo"}], 4) == [
        ({"id": "1", "name": "Solo"}, None)
    ]
    assert pair_placeholder_teams([{"id": "", "name": "Ghost"}], 1) == []


def test_starting_slots_from_rules_and_placeholder_week():
    rules = LeagueRules.model_validate({
        "roster": {
            "qb": {"starter": 1},
            "rb": {"starter": 2},
            "wr": {"starter": 2},
            "te": {"starter": 1},
            "flex": {"starter": 1},
            "k": {"starter": 1},
            "def": {"starter": 1},
        }
    })
    assert starting_slots_from_rules(rules) == [
        "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"
    ]
    assert starting_slots_from_rules(None) == DEFAULT_STARTING_SLOTS

    payload = build_hub_placeholder_week(
        [
            {"id": "t-b", "name": "Bravo"},
            {"id": "t-a", "name": "Alpha"},
        ],
        viewer_team_id="t-b",
        week=3,
        starting_slots=["QB", "RB"],
        reason="no_sleeper_league",
        nfl_state={"season": "2026", "season_type": "regular", "week": 3},
    )
    assert payload["available"] is True
    assert payload["placeholder"] is True
    assert payload["viewer_matchup_id"] == "hub-1"
    names = [team["team_name"] for team in payload["matchups"][0]["teams"]]
    assert "Alpha" in names and "Bravo" in names
    viewer = next(team for team in payload["matchups"][0]["teams"] if team["is_viewer"])
    assert viewer["hub_team_id"] == "t-b"
    assert payload["standings"][0]["team_name"] == "Alpha"
    assert payload["standings"][0]["wins"] == 0
    assert payload["standings"][0]["rank"] is None
    assert payload["standings_season"] == "none"
    assert payload["starting_slots"] == ["QB", "RB"]
    assert payload["hint"] == "Link Sleeper to fill scores."


def test_placeholder_week_copies_owner_names():
    payload = build_hub_placeholder_week(
        [
            {"id": "t-b", "name": "Bravo", "owner_name": "Bob"},
            {"id": "t-a", "name": "Alpha", "owner_name": "Alice"},
        ],
        viewer_team_id="t-b",
        week=1,
        starting_slots=["QB"],
        reason="no_sleeper_league",
        nfl_state={"season": "2026", "week": 1},
    )
    owners = {team["team_name"]: team.get("owner_name") for team in payload["matchups"][0]["teams"]}
    assert owners["Alpha"] == "Alice"
    assert owners["Bravo"] == "Bob"
    standing_owners = {row["team_name"]: row.get("owner_name") for row in payload["standings"]}
    assert standing_owners["Alpha"] == "Alice"
    assert standing_owners["Bravo"] == "Bob"


def test_attach_hub_team_names_repairs_placeholder_owners():
    payload = build_hub_placeholder_week(
        [{"id": "t-a", "name": "Alpha"}, {"id": "t-b", "name": "Bravo"}],
        week=1,
    )
    repaired = _attach_hub_team_names(
        payload,
        [
            {"id": "t-a", "name": "Alpha", "owner_name": "Alice"},
            {"id": "t-b", "name": "Bravo", "owner_name": "Bob"},
        ],
    )
    owners = {team["team_name"]: team.get("owner_name") for team in repaired["matchups"][0]["teams"]}
    assert owners["Alpha"] == "Alice"
    assert owners["Bravo"] == "Bob"
    standing_owners = {row["team_name"]: row.get("owner_name") for row in repaired["standings"]}
    assert standing_owners["Alpha"] == "Alice"


def test_prior_season_sleeper_week_uses_placeholder(monkeypatch):
    def _fake_fetch(url):
        if "/matchups/" in url:
            raise AssertionError("prior-season weeks must not load last year's matchups")
        if url.endswith("/rosters"):
            return SAMPLE_ROSTERS
        return SAMPLE_LEAGUE

    monkeypatch.setattr("src.draft_hub.league_live_scoring._fetch_json", _fake_fetch)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.get_nfl_state",
        lambda **_: {"week": 1, "season": "2026", "season_type": "regular"},
    )
    out = build_sleeper_live_week(
        "sl-prior",
        1,
        hub_teams=[
            {"id": "t1", "sleeper_roster_id": "1", "name": "Hub One"},
            {"id": "t2", "sleeper_roster_id": "2", "name": "Hub Two"},
        ],
        viewer_team_id="t1",
        nfl_state={"week": 1, "season": "2026", "season_type": "regular"},
    )
    assert out["placeholder"] is True
    assert out["reason"] == "prior_season"
    assert out["standings_season"] == "last"
    assert all(team["points"] == 0 for matchup in out["matchups"] for team in matchup["teams"])
    assert any(row["wins"] + row["losses"] > 0 for row in out["standings"])


def test_hub_pre_draft_holds_same_season_sleeper_scores(monkeypatch):
    def _fake_fetch(url):
        if "/matchups/" in url:
            raise AssertionError("pre-draft hub must not load Sleeper week scores")
        if url.endswith("/rosters"):
            return SAMPLE_ROSTERS
        return {**SAMPLE_LEAGUE, "season": "2026", "status": "in_season"}

    monkeypatch.setattr("src.draft_hub.league_live_scoring._fetch_json", _fake_fetch)
    out = build_sleeper_live_week(
        "sl-pre-draft",
        1,
        hub_teams=[
            {"id": "t1", "sleeper_roster_id": "1", "name": "Hub One"},
            {"id": "t2", "sleeper_roster_id": "2", "name": "Hub Two"},
        ],
        viewer_team_id="t1",
        nfl_state={"week": 1, "season": "2026", "season_type": "regular"},
        hub_pre_draft=True,
    )
    assert out["placeholder"] is True
    assert out["reason"] == "pre_draft"
    assert out["standings_season"] == "last"
    assert all(team["points"] == 0 for matchup in out["matchups"] for team in matchup["teams"])


def test_cached_prior_season_week_overlays_placeholder(monkeypatch, hub_db):
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.resolve_current_week",
        lambda **_: (1, {"week": 1, "season": "2026", "season_type": "regular"}),
    )
    storage.upsert_sleeper_live_scoring_cache(
        "sl-cached-prior",
        1,
        {
            "available": True,
            "season": "2025",
            "week": 1,
            "status": "complete",
            "placeholder": False,
            "matchups": [
                {
                    "matchup_id": "5",
                    "teams": [
                        {"roster_id": "9", "hub_team_id": "you", "points": 114.8, "team_name": "You"},
                        {"roster_id": "7", "hub_team_id": "them", "points": 90.1, "team_name": "Them"},
                    ],
                }
            ],
            "standings": [
                {"roster_id": "7", "hub_team_id": "them", "wins": 10, "losses": 4, "rank": 1},
                {"roster_id": "9", "hub_team_id": "you", "wins": 4, "losses": 10, "rank": 8},
            ],
        },
    )
    out = get_sleeper_live_week(
        "sl-cached-prior",
        hub_teams=[
            {"id": "you", "sleeper_roster_id": "9", "name": "You"},
            {"id": "them", "sleeper_roster_id": "7", "name": "Them"},
        ],
        viewer_team_id="you",
        hub_pre_draft=True,
        refresh=False,
    )
    assert out["placeholder"] is True
    assert out["reason"] == "pre_draft"
    assert out["standings_season"] == "last"
    assert all(team["points"] == 0 for matchup in out["matchups"] for team in matchup["teams"])
    caleb = next(row for row in out["standings"] if row["hub_team_id"] == "you")
    assert caleb["wins"] == 4 and caleb["losses"] == 10
    assert sleeper_week_is_historical(
        {"season": "2025", "status": "complete"},
        {"season": "2026"},
    )


def test_build_sleeper_live_week_empty_matchups_uses_placeholder(monkeypatch):
    def _fake_fetch(url):
        if "/matchups/" in url:
            return []
        if url.endswith("/rosters"):
            return SAMPLE_ROSTERS
        return SAMPLE_LEAGUE

    monkeypatch.setattr("src.draft_hub.league_live_scoring._fetch_json", _fake_fetch)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.get_nfl_state",
        lambda **_: {"week": 5, "season": "2025", "season_type": "regular"},
    )
    hub_teams = [
        {"id": "t1", "sleeper_roster_id": "1", "name": "Hub One"},
        {"id": "t2", "sleeper_roster_id": "2", "name": "Hub Two"},
    ]
    out = build_sleeper_live_week(
        "sl-empty",
        5,
        hub_teams=hub_teams,
        viewer_team_id="t1",
    )
    assert out["available"] is True
    assert out["placeholder"] is True
    assert out["reason"] == "no_matchups"
    assert out["hint"] == "No scored matchups yet. Scores fill in after kickoff."
    names = {team["team_name"] for team in out["matchups"][0]["teams"]}
    assert names == {"Hub One", "Hub Two"}
    assert out["standings_season"] == "last"
    assert any(row["wins"] + row["losses"] > 0 for row in out["standings"])
    assert all(row["rank"] is not None for row in out["standings"])


def test_build_sleeper_live_week_unpaired_rows_use_placeholder(monkeypatch):
    def _fake_fetch(url):
        if "/matchups/" in url:
            return [
                {"roster_id": 1, "matchup_id": None, "points": 0, "starters": []},
                {"roster_id": 2, "matchup_id": None, "points": 0, "starters": []},
            ]
        if url.endswith("/rosters"):
            return SAMPLE_ROSTERS
        return SAMPLE_LEAGUE

    monkeypatch.setattr("src.draft_hub.league_live_scoring._fetch_json", _fake_fetch)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.get_nfl_state",
        lambda **_: {"week": 18, "season": "2025", "season_type": "regular"},
    )
    out = build_sleeper_live_week(
        "sl-unpaired",
        18,
        hub_teams=[
            {"id": "t1", "name": "Hub One"},
            {"id": "t2", "name": "Hub Two"},
        ],
        viewer_team_id="t1",
    )
    assert out["placeholder"] is True
    assert out["reason"] == "no_matchups"
    assert len(out["matchups"]) == 1


def test_placeholder_cache_does_not_pin_viewer(monkeypatch, hub_db):
    def _fake_fetch(url):
        if "/matchups/" in url:
            return []
        if url.endswith("/rosters"):
            return SAMPLE_ROSTERS
        return SAMPLE_LEAGUE

    monkeypatch.setattr("src.draft_hub.league_live_scoring._fetch_json", _fake_fetch)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.get_nfl_state",
        lambda **_: {"week": 5, "season": "2025", "season_type": "regular"},
    )
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.resolve_current_week",
        lambda **_: (5, {"week": 5, "season": "2025", "season_type": "regular"}),
    )
    hub_teams = [
        {"id": "t1", "name": "Alpha", "owner_name": "Alice"},
        {"id": "t2", "name": "Bravo", "owner_name": "Bob"},
        {"id": "t3", "name": "Chi", "owner_name": "Cara"},
        {"id": "t4", "name": "Delta", "owner_name": "Drew"},
    ]
    first = get_sleeper_live_week(
        "sl-shared-viewer",
        hub_teams=hub_teams,
        viewer_team_id="t1",
        refresh=True,
    )
    assert first["placeholder"] is True
    assert first["viewer_matchup_id"] == "hub-1"
    first_viewer = next(team for team in first["matchups"][0]["teams"] if team["is_viewer"])
    assert first_viewer["hub_team_id"] == "t1"

    cached = storage.get_sleeper_live_scoring_cache("sl-shared-viewer", 5)
    assert cached is not None
    assert cached["payload"].get("viewer_matchup_id") is None
    assert not any(
        team.get("is_viewer")
        for matchup in cached["payload"].get("matchups") or []
        for team in matchup.get("teams") or []
    )

    refresh_sleeper_live_scoring_cache("sl-shared-viewer", hub_teams=hub_teams, week=5)
    warmed = storage.get_sleeper_live_scoring_cache("sl-shared-viewer", 5)
    assert warmed["payload"].get("viewer_matchup_id") is None

    second = get_sleeper_live_week(
        "sl-shared-viewer",
        hub_teams=hub_teams,
        viewer_team_id="t3",
        refresh=False,
    )
    assert second["cached"] is True
    assert second["viewer_matchup_id"] == "hub-2"
    second_viewer = next(
        team
        for matchup in second["matchups"]
        for team in matchup["teams"]
        if team["is_viewer"]
    )
    assert second_viewer["hub_team_id"] == "t3"
    assert second_viewer["owner_name"] == "Cara"


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
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.resolve_current_week",
        lambda **_: (2, {"week": 2, "season": "2026", "season_type": "regular"}),
    )
    league = storage.create_league("dev", "Live League", 2026, LeagueRules())
    storage.join_league("other-live", league["room_code"], "Zebra Squad")
    res = hub_client.get(f"/api/hub/league/{league['id']}/live-scoring")
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body["source"] == "hub"
    assert body["placeholder"] is True
    assert body["preseason"] is False
    assert body["reason"] == "hub_unscored"
    assert "scored" in body["hint"].lower()
    assert body["week"] == 2
    assert len(body["matchups"]) == 1
    names = {team["team_name"] for team in body["matchups"][0]["teams"]}
    assert names == {"Commissioner", "Zebra Squad"}
    assert all(team["points"] == 0 for team in body["matchups"][0]["teams"])
    assert [row["team_name"] for row in body["standings"]] == ["Commissioner", "Zebra Squad"]
    assert all(row["wins"] == 0 and row["losses"] == 0 for row in body["standings"])
    assert any(team.get("is_viewer") for team in body["matchups"][0]["teams"])


def test_live_scoring_route_no_sleeper_solo_team(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    monkeypatch.setattr(
        "src.draft_hub.league_live_scoring.resolve_current_week",
        lambda **_: (1, {"week": 1, "season": "2026"}),
    )
    league = storage.create_league("dev", "Solo Live", 2026, LeagueRules())
    res = hub_client.get(f"/api/hub/league/{league['id']}/live-scoring")
    assert res.status_code == 200
    body = res.json()
    assert body["placeholder"] is True
    teams = body["matchups"][0]["teams"]
    assert teams[0]["team_name"] == "Commissioner"
    assert teams[1]["team_name"] == "Opponent TBD"
    assert teams[0]["is_viewer"] is True
    assert len(body["standings"]) == 1


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
