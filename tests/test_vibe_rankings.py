"""SCORE-81 Vibes: persist aura + GET/PUT /api/hub/vibes payload tests."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.hub_scoring import set_team_starters
from src.draft_hub.presets import load_preset
from src.draft_hub.vibe_rankings import (
    AURA_BASE,
    apply_vibe,
    build_vibe_rankings,
    clamp_aura,
    projection_starts,
    vibe_divergences,
    vibe_score,
    vibe_starts,
)


def _pool(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


WR_POOL = _pool(
    [
        {
            "Player": "WR Ace",
            "Projected Points": 18.0,
            "Low (P10)": 8.0,
            "High (P90)": 28.0,
            "Team": "MIA",
            "Opponent": "NE",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-ace",
            "Position": "WR",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "WR Co",
            "Projected Points": 17.0,
            "Low (P10)": 7.0,
            "High (P90)": 26.0,
            "Team": "KC",
            "Opponent": "DEN",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-co",
            "Position": "WR",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "Garrett Wilson",
            "Projected Points": 16.4,
            "Low (P10)": 6.0,
            "High (P90)": 28.0,
            "Team": "NYJ",
            "Opponent": "BUF",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-wilson",
            "Position": "WR",
            "Injury Status": "",
            "Injury Note": "",
        },
    ]
)

RB_POOL = _pool(
    [
        {
            "Player": "RB Starter",
            "Projected Points": 17.0,
            "Low (P10)": 8.0,
            "High (P90)": 26.0,
            "Team": "SF",
            "Opponent": "SEA",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-starter",
            "Position": "RB",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "RB Two",
            "Projected Points": 15.5,
            "Low (P10)": 7.0,
            "High (P90)": 24.0,
            "Team": "DET",
            "Opponent": "CHI",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-two",
            "Position": "RB",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "RB Flex",
            "Projected Points": 14.0,
            "Low (P10)": 6.0,
            "High (P90)": 22.0,
            "Team": "PHI",
            "Opponent": "DAL",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-flex",
            "Position": "RB",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "RB Bye",
            "Projected Points": 12.0,
            "Low (P10)": 5.0,
            "High (P90)": 20.0,
            "Team": "GB",
            "Opponent": "BYE",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-bye",
            "Position": "RB",
            "Injury Status": "",
            "Injury Note": "",
        },
    ]
)

QB_POOL = _pool(
    [
        {
            "Player": "Jordan Love",
            "Projected Points": 19.0,
            "Low (P10)": 10.0,
            "High (P90)": 28.0,
            "Team": "GB",
            "Opponent": "CHI",
            "Week": 1,
            "Season": 2026,
            "player_id": "qb-love",
            "Position": "QB",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "Backup QB",
            "Projected Points": 8.0,
            "Low (P10)": 2.0,
            "High (P90)": 14.0,
            "Team": "NYJ",
            "Opponent": "BUF",
            "Week": 1,
            "Season": 2026,
            "player_id": "qb-backup",
            "Position": "QB",
            "Injury Status": "Out",
            "Injury Note": "ACL",
        },
    ]
)


def _fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True):
    assert allow_compute is False, "vibes must not live-compute weekly projections"
    pos = str(position).lower()
    if pos == "wr":
        df = WR_POOL.copy()
    elif pos == "rb":
        df = RB_POOL.copy()
    elif pos == "qb":
        df = QB_POOL.copy()
    else:
        return pd.DataFrame()
    df.attrs["built_at"] = "2026-08-13T12:00:00+00:00"
    return df


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _seed_league(hub_db, *, sleeper: bool = False, sub: str = "vibe-comm"):
    ws = storage.get_or_create_workspace(sub, season=2026)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(sub, "Vibe League", 2026, rules, workspace_id=ws["id"])
    team = storage.get_team_by_user(league["id"], sub)
    if sleeper:
        storage.update_league_sleeper_id(league["id"], "sleeper-vibe-1")
        storage.update_team_sleeper_link(
            team["id"],
            sleeper_roster_id="1",
            sleeper_team_name="Vibe Team",
            sleeper_player_ids=["wr-ace", "rb-starter", "qb-love"],
        )
    roster_ws = storage.roster_workspace_for_league(league)
    slots = [
        ("wr-ace", "WR Ace", "MIA", "WR", 45),
        ("wr-co", "WR Co", "KC", "WR", 38),
        ("wr-wilson", "Garrett Wilson", "NYJ", "WR", 20),
        ("rb-starter", "RB Starter", "SF", "RB", 35),
        ("rb-two", "RB Two", "DET", "RB", 28),
        ("rb-flex", "RB Flex", "PHI", "RB", 22),
        ("rb-bye", "RB Bye", "GB", "RB", 10),
        ("qb-love", "Jordan Love", "GB", "QB", 25),
        ("qb-backup", "Backup QB", "NYJ", "QB", 5),
        ("te-ace", "TE Ace", "BAL", "TE", 12),
    ]
    for pid, name, team_code, pos, salary in slots:
        storage.add_roster_slot(
            roster_ws,
            {
                "player_id": pid,
                "player_name": name,
                "team": team_code,
                "position": pos,
                "salary": salary,
                "contract_years": 2,
            },
            team_id=team["id"],
        )
    return league, team, ws, sub


def test_aura_math_matches_product_curve():
    assert clamp_aura(-3) == 0
    assert clamp_aura(120) == 99
    assert apply_vibe({}, "p1", "start")["p1"] == AURA_BASE + 14
    assert apply_vibe({"p1": 50}, "p1", "sit")["p1"] == 36
    player = {"p50": 10.0}
    assert vibe_score(player, 50) == pytest.approx(10.0)
    assert vibe_score(player, 0) == pytest.approx(6.0)
    assert vibe_score(player, 99) == pytest.approx(10.0 * (0.6 + 0.4 * 99 / 50))


def test_vibe_slate_diverges_from_projection_when_aura_boosts_bench():
    rules = load_preset("salary_cap_auction_v1")
    players = [
        {"player_id": "wr-a", "position": "WR", "p50": 18.0, "on_bye": False, "injured": False},
        {"player_id": "wr-b", "position": "WR", "p50": 17.0, "on_bye": False, "injured": False},
        {"player_id": "wr-c", "position": "WR", "p50": 16.0, "on_bye": False, "injured": False},
        {"player_id": "rb-a", "position": "RB", "p50": 15.0, "on_bye": False, "injured": False},
        {"player_id": "rb-b", "position": "RB", "p50": 14.0, "on_bye": False, "injured": False},
        {"player_id": "rb-c", "position": "RB", "p50": 10.0, "on_bye": False, "injured": False},
        {"player_id": "qb-a", "position": "QB", "p50": 20.0, "on_bye": False, "injured": False},
        {"player_id": "te-a", "position": "TE", "p50": 8.0, "on_bye": False, "injured": False},
    ]
    proj = projection_starts(players, rules)
    # Boost low RB into FLEX over higher-P50 WR leftover.
    aura = {"rb-c": 99, "wr-c": 0}
    vibe = vibe_starts(players, aura, rules)
    splits = vibe_divergences(proj, vibe)
    vibe_ids = {s["player"]["player_id"] for s in vibe if s.get("player")}
    proj_ids = {s["player"]["player_id"] for s in proj if s.get("player")}
    assert "rb-c" in vibe_ids
    assert "rb-c" not in proj_ids or splits["pairs"]
    assert isinstance(splits["pairs"], list)


def test_storage_round_trip_aura(hub_db):
    league, team, _, _ = _seed_league(hub_db, sleeper=False)
    stored = storage.put_team_vibe_aura(
        league["id"], team["id"], 2026, 1, {"wr-ace": 64, "rb-flex": 22}
    )
    assert stored["wr-ace"] == 64
    assert storage.get_team_vibe_aura(league["id"], team["id"], 2026, 1)["rb-flex"] == 22
    assert storage.get_team_vibe_aura(league["id"], team["id"], 2026, 2) == {}


def test_build_vibe_rankings_payload(hub_db):
    league, team, _, sub = _seed_league(hub_db, sleeper=False)
    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context(sub)
    storage.put_team_vibe_aura(league["id"], team["id"], 2026, 1, {"wr-wilson": 99})

    with patch(
        "src.draft_hub.weekly_command_center.load_weekly_prediction",
        side_effect=_fake_load,
    ), patch(
        "src.draft_hub.weekly_command_center.resolve_week_context",
        return_value=(2026, 1),
    ):
        payload = build_vibe_rankings(ctx, season=2026, week=1)

    assert "aura_by_id" in payload
    assert payload["aura_by_id"]["wr-wilson"] == 99
    assert isinstance(payload["vibe_slots"], list)
    assert "divergences" in payload
    assert payload["meta"]["week"] == 1
    assert payload["meta"]["persists_aura"] is True
    assert payload["hub_context"]["league_id"] == league["id"]
    assert payload["meta"]["can_edit_lineup"] is True
    assert payload["meta"]["sleeper_hosts_scoring"] is False
    assert payload["meta"]["lineup_set_path"] == f"/api/hub/league/{league['id']}/lineup"
    assert all("player_id" in s and "slot" in s for s in payload["starters"])


def test_api_get_put_vibes_persist_across_requests(hub_db):
    league, team, _, sub = _seed_league(hub_db, sleeper=False)
    client = _client_for(sub)
    try:
        with patch(
            "src.draft_hub.weekly_command_center.load_weekly_prediction",
            side_effect=_fake_load,
        ), patch(
            "src.draft_hub.weekly_command_center.resolve_week_context",
            return_value=(2026, 1),
        ), patch(
            "src.draft_hub.league_sleeper_sync.compose_team_roster_from_live_snapshot",
        ) as live:
            put = client.put(
                "/api/hub/vibes",
                json={
                    "week": 1,
                    "season": 2026,
                    "aura_by_id": {"wr-ace": 78, "rb-two": 36},
                },
            )
            assert put.status_code == 200, put.text
            body = put.json()
            assert body["aura_by_id"]["wr-ace"] == 78
            assert body["aura_by_id"]["rb-two"] == 36
            assert isinstance(body["vibe_slots"], list)
            assert "divergences" in body
            live.assert_not_called()

            got = client.get("/api/hub/vibes", params={"season": 2026, "week": 1})
            assert got.status_code == 200
            again = got.json()
            assert again["aura_by_id"]["wr-ace"] == 78
            assert again["aura_by_id"]["rb-two"] == 36
            assert again["hub_context"]["league_id"] == league["id"]
            assert again["hub_context"]["team_id"] == team["id"]

            vote = client.put(
                "/api/hub/vibes",
                json={"week": 1, "season": 2026, "player_id": "wr-ace", "vibe": "start"},
            )
            assert vote.status_code == 200
            assert vote.json()["aura_by_id"]["wr-ace"] == 92
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_sleeper_linked_vibes_are_advice_only(hub_db):
    league, _team, _, sub = _seed_league(hub_db, sleeper=True, sub="vibe-sleeper")
    client = _client_for(sub)
    try:
        with patch(
            "src.draft_hub.weekly_command_center.load_weekly_prediction",
            side_effect=_fake_load,
        ), patch(
            "src.draft_hub.weekly_command_center.resolve_week_context",
            return_value=(2026, 1),
        ):
            res = client.get("/api/hub/vibes", params={"season": 2026, "week": 1})
            assert res.status_code == 200
            data = res.json()
            assert data["meta"]["sleeper_hosts_scoring"] is True
            assert data["meta"]["can_edit_lineup"] is False
            assert data["meta"]["lineup_source"] == "inferred"

            blocked = client.put(
                f"/api/hub/league/{league['id']}/lineup",
                json={
                    "week": 1,
                    "season": 2026,
                    "starters": data["starters"],
                },
            )
            assert blocked.status_code == 409
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_hub_only_apply_vibe_slate_via_lineup_set(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.nfl_game_started",
        lambda *_a, **_k: False,
    )
    league, team, _, sub = _seed_league(hub_db, sleeper=False)
    client = _client_for(sub)
    try:
        with patch(
            "src.draft_hub.weekly_command_center.load_weekly_prediction",
            side_effect=_fake_load,
        ), patch(
            "src.draft_hub.weekly_command_center.resolve_week_context",
            return_value=(2026, 1),
        ):
            vibes = client.put(
                "/api/hub/vibes",
                json={
                    "week": 1,
                    "season": 2026,
                    "aura_by_id": {"wr-wilson": 99, "rb-flex": 0},
                },
            )
            assert vibes.status_code == 200
            payload = vibes.json()
            assert payload["meta"]["can_edit_lineup"] is True
            starters = payload["starters"]
            assert starters

            applied = client.put(
                f"/api/hub/league/{league['id']}/lineup",
                json={"week": 1, "season": 2026, "starters": starters},
            )
            assert applied.status_code == 200, applied.text
            by_id = {row["player_id"]: row for row in applied.json()["lineup"]}
            for entry in starters:
                assert by_id[entry["player_id"]]["lineup_role"] == "starter"
                assert by_id[entry["player_id"]]["slot"] == entry["slot"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_put_vibes_requires_league(hub_db):
    storage.get_or_create_workspace("solo-vibe", season=2026)
    client = _client_for("solo-vibe")
    try:
        res = client.put("/api/hub/vibes", json={"aura_by_id": {"x": 50}, "week": 1})
        assert res.status_code == 400
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_health_feature_flag_vibe_rankings():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["features"]["vibe_rankings"] is True


def test_set_team_starters_helper_still_accepts_vibe_starters(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.nfl_game_started",
        lambda *_a, **_k: False,
    )
    league, team, _, sub = _seed_league(hub_db, sleeper=False, sub="vibe-helper")
    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context(sub)
    with patch(
        "src.draft_hub.weekly_command_center.load_weekly_prediction",
        side_effect=_fake_load,
    ), patch(
        "src.draft_hub.weekly_command_center.resolve_week_context",
        return_value=(2026, 1),
    ):
        payload = build_vibe_rankings(
            ctx,
            season=2026,
            week=1,
            aura_by_id={"wr-ace": 50},
            persist=True,
        )
    rows = set_team_starters(
        league["id"],
        team["id"],
        2026,
        1,
        payload["starters"],
        rules=load_preset("salary_cap_auction_v1"),
    )
    assert any(r["lineup_role"] == "starter" for r in rows)
