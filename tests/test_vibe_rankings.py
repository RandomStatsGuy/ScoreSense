"""SCORE-81 Vibes persist + vibe-slate math."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.presets import load_preset
from src.draft_hub.vibe_rankings import (
    AURA_BASE,
    fill_slots_by_score,
    normalize_aura_by_id,
    read_aura,
    vibe_divergences,
    vibe_score,
)


@pytest.fixture(autouse=True)
def _clear_hub_auth_override():
    yield
    app.dependency_overrides.pop(require_hub_user, None)


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _seed_league(hub_db, *, comm="vibe-comm", member="vibe-member"):
    ws = storage.get_or_create_workspace(comm, season=2026)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Vibe League", 2026, rules, workspace_id=ws["id"])
    storage.join_league(member, league["room_code"], "Visitor")
    comm_team = storage.get_team_by_user(league["id"], comm)
    member_team = storage.get_team_by_user(league["id"], member)
    return comm, member, league, comm_team, member_team, rules


def _week_payload(league_id, team_id, rules):
    return {
        "hub_context": {
            "league_id": league_id,
            "team_id": team_id,
            "rules": rules if isinstance(rules, dict) else rules.model_dump(),
            "mode": "league",
        },
        "meta": {"season": 2026, "week": 1, "lineup_source": "hub", "lineup_locked": False},
        "roster": {
            "starters": [
                {
                    "player_id": "rb-bijan",
                    "player_name": "Bijan Robinson",
                    "position": "RB",
                    "team": "ATL",
                    "p50": 17.0,
                    "on_bye": False,
                    "injured": False,
                },
                {
                    "player_id": "rb-gibbs",
                    "player_name": "Jahmyr Gibbs",
                    "position": "RB",
                    "team": "DET",
                    "p50": 16.0,
                    "on_bye": False,
                    "injured": False,
                },
            ],
            "bench": [
                {
                    "player_id": "rb-saquon",
                    "player_name": "Saquon Barkley",
                    "position": "RB",
                    "team": "PHI",
                    "p50": 15.0,
                    "on_bye": False,
                    "injured": False,
                },
                {
                    "player_id": "rb-four",
                    "player_name": "RB Four",
                    "position": "RB",
                    "team": "CHI",
                    "p50": 8.0,
                    "on_bye": False,
                    "injured": False,
                },
            ],
        },
    }


def test_vibe_score_scales_from_aura():
    player = {"p50": 10.0}
    assert vibe_score(player, 50) == pytest.approx(10.0)
    assert vibe_score(player, 0) == pytest.approx(6.0)
    assert vibe_score(player, 99) == pytest.approx(10.0 * (0.6 + 0.4 * 99 / 50))
    assert read_aura({}, "x") == AURA_BASE
    assert normalize_aura_by_id({"x": 140, "": 12, "y": "nope"}) == {"x": 99}


def test_high_aura_bench_enters_the_slate():
    plan = [
        {"key": "RB1", "slot": "RB1", "position": "RB", "index": 0},
        {"key": "RB2", "slot": "RB2", "position": "RB", "index": 1},
    ]
    players = [
        {"player_id": "rb-bijan", "player_name": "Bijan Robinson", "position": "RB", "p50": 17.0},
        {"player_id": "rb-gibbs", "player_name": "Jahmyr Gibbs", "position": "RB", "p50": 16.0},
        {"player_id": "rb-saquon", "player_name": "Saquon Barkley", "position": "RB", "p50": 15.0},
    ]
    aura = {"rb-saquon": 99, "rb-bijan": 20, "rb-gibbs": 50}
    proj = fill_slots_by_score(plan, players, lambda player: float(player.get("p50") or 0))
    vibe = fill_slots_by_score(
        plan,
        players,
        lambda player: vibe_score(player, read_aura(aura, player.get("player_id"))),
    )
    assert proj[0]["player"]["player_id"] == "rb-bijan"
    assert vibe[0]["player"]["player_id"] == "rb-saquon"
    splits = vibe_divergences(proj, vibe)
    assert any(row["player_id"] == "rb-saquon" for row in splits["in_vibe"])
    assert splits["pairs"]


def test_storage_aura_is_per_team_week(hub_db):
    comm, member, league, comm_team, member_team, _rules = _seed_league(hub_db)
    storage.replace_vibe_aura(league["id"], comm_team["id"], 2026, 1, {"rb-bijan": 78})
    storage.replace_vibe_aura(league["id"], member_team["id"], 2026, 1, {"rb-gibbs": 20})
    assert storage.list_vibe_aura(league["id"], comm_team["id"], 2026, 1) == {"rb-bijan": 78}
    assert storage.list_vibe_aura(league["id"], member_team["id"], 2026, 1) == {"rb-gibbs": 20}
    assert storage.list_vibe_aura(league["id"], comm_team["id"], 2026, 2) == {}
    del comm, member


def test_api_vibes_round_trip(hub_db):
    comm, _member, league, comm_team, _member_team, rules = _seed_league(hub_db)
    payload = _week_payload(league["id"], comm_team["id"], rules)
    client = _client_for(comm)
    with patch(
        "src.draft_hub.weekly_command_center.build_weekly_command_center",
        return_value=payload,
    ), patch(
        "src.draft_hub.weekly_command_center.resolve_week_context",
        return_value=(2026, 1),
    ):
        empty = client.get("/api/hub/vibes", params={"season": 2026, "week": 1})
        assert empty.status_code == 200
        assert empty.json()["aura_by_id"] == {}
        assert empty.json()["league_id"] == league["id"]

        saved = client.put(
            "/api/hub/vibes",
            json={"aura_by_id": {"rb-four": 99, "rb-gibbs": 0}, "week": 1, "season": 2026},
        )
        assert saved.status_code == 200
        body = saved.json()
        assert body["aura_by_id"]["rb-four"] == 99
        assert body["aura_by_id"]["rb-gibbs"] == 0
        assert any(
            slot.get("player") and slot["player"]["player_id"] == "rb-four"
            for slot in body["vibe_slots"]
        )
        assert body["divergences"]["pairs"]

        again = client.get("/api/hub/vibes", params={"season": 2026, "week": 1})
        assert again.status_code == 200
        assert again.json()["aura_by_id"]["rb-four"] == 99


def test_api_vibes_do_not_leak_to_other_team(hub_db):
    comm, member, league, comm_team, member_team, rules = _seed_league(hub_db)
    with patch(
        "src.draft_hub.weekly_command_center.build_weekly_command_center",
        side_effect=lambda ctx, **kwargs: _week_payload(
            league["id"], ctx.get("team_id"), rules
        ),
    ), patch(
        "src.draft_hub.weekly_command_center.resolve_week_context",
        return_value=(2026, 1),
    ):
        _client_for(comm).put(
            "/api/hub/vibes",
            json={"aura_by_id": {"rb-bijan": 88}, "week": 1, "season": 2026},
        )
        other = _client_for(member).get("/api/hub/vibes", params={"season": 2026, "week": 1})
        assert other.status_code == 200
        assert other.json()["aura_by_id"] == {}
        assert other.json()["team_id"] == member_team["id"]
        del comm_team


def test_api_vibes_put_requires_a_league_team(hub_db):
    storage.get_or_create_workspace("solo-vibe", season=2026)
    client = _client_for("solo-vibe")
    empty = client.get("/api/hub/vibes", params={"season": 2026, "week": 1})
    assert empty.status_code == 200
    assert empty.json()["aura_by_id"] == {}
    denied = client.put("/api/hub/vibes", json={"aura_by_id": {"x": 80}, "week": 1, "season": 2026})
    assert denied.status_code == 400
    assert "league team" in denied.json()["detail"].lower()


def test_health_lists_vibes():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["features"]["vibes"] is True
