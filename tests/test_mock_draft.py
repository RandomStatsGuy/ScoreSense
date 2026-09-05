"""Mock draft launcher."""

import json

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_pool import build_nomination_pool
from src.draft_hub.draft_recap import build_draft_recap
from src.draft_hub.draft_state import (
    award_nominee,
    check_timers,
    end_draft,
    get_room_state,
    nominate,
    place_bid,
)
from src.draft_hub.mock_draft import start_mock_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_quick_mock_creates_test_league_and_starts(hub_db):
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=3, auto_start=True)
    assert out["mock_mode"] == "quick_bots"
    assert out["auto_started"] is True
    assert out["state"]["session"]["status"] in ("nominating", "bidding")
    teams = out["state"]["teams"]
    assert sum(1 for t in teams if t.get("is_bot")) == 3
    as_member = get_room_state(out["league_id"], "mock-user")
    assert as_member.get("viewer", {}).get("team_id")
    assert "viewer" not in get_room_state(out["league_id"])


def test_mock_league_nomination_pool_without_workspace(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": [{"player_id": "p1", "player": "Test QB", "position": "QB", "is_rookie": False}]},
    )
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    league = storage.get_league(out["league_id"])
    assert league.get("workspace_id") is None
    rules = LeagueRules.model_validate(league["rules"])
    pool = build_nomination_pool(
        league_id=league["id"],
        pool_mode="full",
        season=int(league["season"]),
        rules=rules,
        workspace_id=storage.roster_workspace_for_league(league),
    )
    assert pool["count"] == 1


def test_mock_league_recap_overview_after_end(hub_db):
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    league_id = out["league_id"]
    team = storage.list_league_teams(league_id)[0]
    ws = storage.roster_workspace_for_league(storage.get_league(league_id))
    storage.add_roster_slot(
        ws,
        {
            "player_id": "p9",
            "player_name": "Mock Pick",
            "team": "KC",
            "position": "WR",
            "salary": 15,
            "contract_years": 1,
        },
        team_id=team["id"],
    )
    storage.append_draft_event(
        league_id,
        "win",
        {
            "team_id": team["id"],
            "team_name": team["name"],
            "player_id": "p9",
            "player_name": "Mock Pick",
            "position": "WR",
            "amount": 15,
            "fair_value": 20,
            "value_grade": "steal",
        },
    )
    end_draft(league_id, "mock-user", force=True)
    overview = storage.league_roster_overview(league_id)
    assert overview["teams"]
    recap = build_draft_recap(league_id, overview=overview)
    assert recap is not None
    assert recap["pick_count"] == 1


def _stub_pool_player(monkeypatch, player):
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: {
            "player_id": player["player_id"],
            "player": player.get("player_name"),
            "player_name": player.get("player_name"),
            "team": player.get("team"),
            "position": player.get("position"),
            "fair_value": player.get("fair_value"),
            "season_proj": player.get("season_proj"),
            "per_game_proj": player.get("per_game_proj"),
        },
    )


def test_mock_award_lands_on_roster_and_blocks_renomination(hub_db, monkeypatch):
    """Mock leagues have no workspace: the award must write to the same roster
    workspace the reads use, and a won player can't be nominated again."""
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    league_id = out["league_id"]
    player = {
        "player_id": "p1",
        "player_name": "Test WR",
        "team": "KC",
        "position": "WR",
        "fair_value": 30,
        "season_proj": 250,
        "per_game_proj": 15,
    }
    _stub_pool_player(monkeypatch, player)
    nominate(league_id, "mock-user", player)
    place_bid(league_id, "mock-user", 5)
    award_nominee(league_id, "mock-user")

    team = storage.get_team_by_user(league_id, "mock-user")
    roster = storage.list_team_roster(league_id, team["id"])
    assert any(str(r.get("player_id")) == "p1" for r in roster)

    with pytest.raises(ValueError, match="already drafted"):
        nominate(league_id, "mock-user", player)


def test_bot_bidding_stops_at_fair_value_ceiling(hub_db, monkeypatch):
    """Bots value players at 0.75x–1.15x fair value — an auction must converge
    near fair price instead of climbing until budgets run out."""
    from src.draft_hub.test_draft import bot_max_price, maybe_bot_bid

    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=3, auto_start=True)
    league_id = out["league_id"]
    fair = 20
    player = {
        "player_id": "p1",
        "player_name": "Test WR",
        "team": "KC",
        "position": "WR",
        "fair_value": fair,
        "season_proj": 250,
        "per_game_proj": 15,
    }
    _stub_pool_player(monkeypatch, player)
    nominate(league_id, "mock-user", player)
    for _ in range(80):
        if maybe_bot_bid(league_id) is None:
            break
    session = storage.get_draft_session(league_id)
    high = float(session.get("high_bid") or 0)
    assert 1 <= high <= fair * 1.15 + 1
    assert maybe_bot_bid(league_id) is None

    # Unvalued players are cheap fliers only.
    assert bot_max_price("bot-x", {"player_id": "p2"}, 1.0) == 3.0


def test_mock_league_empty_recap_after_end_without_picks(hub_db):
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    end_draft(out["league_id"], "mock-user", force=True)
    recap = build_draft_recap(out["league_id"])
    assert recap is None


def test_rules_overlay_follows_source_team_count(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("comm", 2025)
    source = storage.create_league(
        "comm", "Ten Team", 2025, rules, team_count=10, workspace_id=ws["id"],
    )
    out = start_mock_draft(
        "comm",
        mode="quick_bots",
        team_count=12,
        bot_count=11,
        source_league_id=source["id"],
        auto_start=False,
    )
    league = storage.get_league(out["league_id"])
    assert league["team_count"] == 10


def test_league_mirror_uses_manager_names(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("comm", 2025)
    source = storage.create_league("comm", "Real League", 2025, rules, workspace_id=ws["id"])
    storage.join_league("mgr-a", source["room_code"], "Alice")
    storage.join_league("mgr-b", source["room_code"], "Bob")

    out = start_mock_draft(
        "comm",
        mode="league_mirror",
        source_league_id=source["id"],
        auto_start=False,
    )
    bot_names = [t["name"] for t in out["state"]["teams"] if t.get("is_bot")]
    assert any("Alice" in n for n in bot_names)
    assert any("Bob" in n for n in bot_names)


def _fake_pool_rows(n=8):
    positions = ["QB", "RB", "WR", "TE", "RB", "WR", "WR", "QB"]
    return [
        {
            "player_id": f"sim-{i}",
            "player": f"Sim Player {i}",
            "team": "KC",
            "position": positions[i % len(positions)],
            "fair_value": 25 - i,
            "season_proj": 200 - i * 5,
            "per_game_proj": 12.0,
            "is_rookie": False,
        }
        for i in range(n)
    ]


def test_simulate_draft_and_owner_contracts(hub_db, monkeypatch):
    from src.draft_hub.draft_recap import build_owner_draft_report
    from src.draft_hub.test_draft import simulate_draft

    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": _fake_pool_rows(12)},
    )
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    league_id = out["league_id"]
    state = simulate_draft(league_id, "mock-user", max_picks=6)
    assert state["session"]["status"] == "completed"
    wins = [e for e in state["events"] if e.get("event_type") == "win"]
    assert len(wins) >= 1

    # Auction ceilings are seeded from team UUIDs, so the human can lose every
    # pick. Prefer mock-user when they won; otherwise use any rostered team so
    # owner-report / contract updates stay covered.
    team = storage.get_team_by_user(league_id, "mock-user")
    roster = storage.list_team_roster(league_id, team["id"]) if team else []
    if not roster:
        for t in storage.list_league_teams(league_id):
            r = storage.list_team_roster(league_id, t["id"])
            if r:
                team, roster = t, r
                break
    assert team is not None and roster, "simulation produced wins but no roster slots"

    report = build_owner_draft_report(
        league_id,
        team["id"],
        roster=roster,
        budget_remaining=float(team["budget_remaining"]),
    )
    assert report is not None
    drafted_ids = {
        str((e.get("payload") or {}).get("player_id"))
        for e in state["events"]
        if e.get("event_type") == "win" and str((e.get("payload") or {}).get("team_id")) == str(team["id"])
    }
    assert report["pick_count"] == len(drafted_ids)
    assert all(int(p["contract_years"]) == 2 for p in report["picks"])
    slot = next(r for r in roster if str(r["player_id"]) in drafted_ids)
    assert int(slot["contract_years"]) == 2
    assert str((slot.get("contract") or {}).get("contract_type")) == "veteran"


def test_quick_mock_snake_preset_starts_picking(hub_db):
    out = start_mock_draft(
        "mock-user",
        mode="quick_bots",
        bot_count=2,
        team_count=3,
        preset_id="snake_draft_v1",
        auto_start=True,
    )
    league = storage.get_league(out["league_id"])
    rules = LeagueRules.model_validate(league["rules"])
    assert rules.draft_type == "snake"
    assert out["state"]["session"]["status"] == "picking"


def test_unknown_preset_rejected(hub_db):
    with pytest.raises(ValueError, match="Unknown preset"):
        start_mock_draft("mock-user", mode="quick_bots", preset_id="not_a_preset")


def test_list_mock_drafts_for_sub(hub_db):
    first = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    start_mock_draft("other-user", mode="quick_bots", bot_count=2, auto_start=False)
    rooms = storage.list_mock_drafts_for_sub("mock-user")
    assert len(rooms) == 1
    assert rooms[0]["league_id"] == first["league_id"]
    assert rooms[0]["draft_type"] == "auction"
    assert rooms[0]["status"] == "setup"


def test_http_mock_draft_preset_and_list(hub_db):
    from fastapi.testclient import TestClient

    from app.api import app
    from app.auth import require_hub_user

    app.dependency_overrides[require_hub_user] = lambda: {"sub": "http-mock", "auth_type": "dev"}
    client = TestClient(app)
    try:
        res = client.post(
            "/api/hub/mock-draft/start",
            json={
                "mode": "quick_bots",
                "preset_id": "linear_draft_v1",
                "team_count": 4,
                "bot_count": 3,
                "auto_start": False,
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["mock_mode"] == "quick_bots"
        league = storage.get_league(body["league_id"])
        assert LeagueRules.model_validate(league["rules"]).draft_type == "linear"

        listed = client.get("/api/hub/mock-drafts")
        assert listed.status_code == 200, listed.text
        rooms = listed.json()["rooms"]
        assert any(r["league_id"] == body["league_id"] for r in rooms)
        assert any(r["draft_type"] == "linear" for r in rooms)

        bad = client.post(
            "/api/hub/mock-draft/start",
            json={"mode": "quick_bots", "preset_id": "nope"},
        )
        assert bad.status_code == 400
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_nan_pool_pick_room_state_is_strict_json(hub_db, monkeypatch):
    """Late-round missing projections used to 500 the end-of-draft HTTP payload."""
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    player = {
        "player_id": "p-nan",
        "player_name": "Depth WR",
        "team": "KC",
        "position": "WR",
        "fair_value": float("nan"),
        "season_proj": float("nan"),
        "per_game_proj": float("inf"),
    }
    _stub_pool_player(monkeypatch, player)
    nominate(out["league_id"], "mock-user", player)
    state = get_room_state(out["league_id"], "mock-user")
    json.dumps(state, allow_nan=False)
    events = [e for e in state["events"] if e.get("event_type") == "nominate"]
    assert events
    payload = events[-1].get("payload") or {}
    assert payload.get("fair_value") is None
    assert payload.get("season_proj") is None


def test_award_auto_ends_when_rosters_are_full(hub_db, monkeypatch):
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    league_id = out["league_id"]
    player = {
        "player_id": "p-last",
        "player_name": "Last WR",
        "team": "KC",
        "position": "WR",
        "fair_value": 10,
        "season_proj": 80,
        "per_game_proj": 8,
    }
    _stub_pool_player(monkeypatch, player)
    nominate(league_id, "mock-user", player)
    monkeypatch.setattr("src.draft_hub.draft_state.all_rosters_full", lambda *a, **k: True)
    award_nominee(league_id, "mock-user")
    session = storage.get_draft_session(league_id)
    assert session["status"] == "completed"
    league = storage.get_league(league_id)
    assert league.get("draft_completed") is True


def test_http_simulate_with_nan_pool_serializes(hub_db, monkeypatch):
    from fastapi.testclient import TestClient

    from app.api import app
    from app.auth import require_hub_user

    rows = _fake_pool_rows(12)
    rows[-1]["fair_value"] = float("nan")
    rows[-1]["season_proj"] = float("nan")
    rows[-1]["per_game_proj"] = float("inf")
    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": rows},
    )
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "http-sim", "auth_type": "dev"}
    client = TestClient(app)
    try:
        started = client.post(
            "/api/hub/mock-draft/start",
            json={
                "mode": "quick_bots",
                "preset_id": "salary_cap_auction_v1",
                "team_count": 3,
                "bot_count": 2,
                "auto_start": True,
            },
        )
        assert started.status_code == 200, started.text
        league_id = started.json()["league_id"]
        sim = client.post(f"/api/hub/league/{league_id}/test/simulate", json={})
        assert sim.status_code == 200, sim.text
        body = sim.json()
        json.dumps(body, allow_nan=False)
        assert body["state"]["session"]["status"] == "completed"
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_unsaved_mocks_are_pruned_when_starting_another(hub_db):
    first = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    second = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    third = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    rooms = storage.list_mock_drafts_for_sub("mock-user")
    ids = {r["league_id"] for r in rooms}
    assert first["league_id"] not in ids
    assert second["league_id"] not in ids
    assert third["league_id"] in ids
    assert storage.get_league(first["league_id"]) is None
    assert storage.get_league(third["league_id"]) is not None


def test_saved_mock_survives_new_unsaved_rooms(hub_db):
    kept = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    storage.set_mock_saved(kept["league_id"], True)
    later = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    rooms = {r["league_id"]: r for r in storage.list_mock_drafts_for_sub("mock-user")}
    assert kept["league_id"] in rooms
    assert later["league_id"] in rooms
    assert rooms[kept["league_id"]]["saved"] is True
    assert rooms[later["league_id"]]["saved"] is False


def test_list_prunes_extra_unsaved_in_progress(hub_db):
    first = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    rules = LeagueRules.model_validate(storage.get_league(first["league_id"])["rules"])
    extras = []
    for i in range(3):
        league = storage.create_league(
            "mock-user",
            f"Extra mock {i}",
            2026,
            rules,
            team_count=4,
            test_mode=True,
        )
        extras.append(league["id"])
    rooms = storage.list_mock_drafts_for_sub("mock-user")
    ids = {r["league_id"] for r in rooms if not r.get("saved")}
    assert extras[-1] in ids
    assert first["league_id"] not in ids
    assert extras[0] not in ids
    assert extras[1] not in ids


def test_saved_mock_cap(hub_db):
    ids = []
    for _ in range(storage.MAX_SAVED_MOCKS):
        out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
        storage.set_mock_saved(out["league_id"], True)
        ids.append(out["league_id"])
    extra = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    with pytest.raises(ValueError, match="favorite mocks"):
        storage.set_mock_saved(extra["league_id"], True)
    assert storage.get_league(ids[0]) is not None


def test_refresh_does_not_reset_in_progress_mock(hub_db, monkeypatch):
    monkeypatch.setattr("src.draft_hub.draft_state._bot_delay_elapsed", lambda *a, **k: False)
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    league_id = out["league_id"]
    player = {
        "player_id": "p-refresh",
        "player_name": "Refresh WR",
        "team": "KC",
        "position": "WR",
        "fair_value": 24,
        "season_proj": 200,
        "per_game_proj": 12,
    }
    _stub_pool_player(monkeypatch, player)
    nominate(league_id, "mock-user", player)
    place_bid(league_id, "mock-user", 5)
    before = get_room_state(league_id, "mock-user")
    after = check_timers(league_id, "mock-user")
    again = check_timers(league_id, "mock-user")
    assert after["session"]["status"] == "bidding"
    assert after["session"]["high_bid"] == before["session"]["high_bid"]
    assert after["session"]["high_bidder_team_id"] == before["session"]["high_bidder_team_id"]
    assert again["session"]["high_bid"] == before["session"]["high_bid"]
    assert again["league"]["id"] == league_id
    assert len(again["picks"]) == len(before["picks"])


def test_http_keep_mock_and_list_saved_flag(hub_db):
    from fastapi.testclient import TestClient

    from app.api import app
    from app.auth import require_hub_user

    app.dependency_overrides[require_hub_user] = lambda: {"sub": "http-keep", "auth_type": "dev"}
    client = TestClient(app)
    try:
        started = client.post(
            "/api/hub/mock-draft/start",
            json={"mode": "quick_bots", "team_count": 4, "bot_count": 3, "auto_start": False},
        )
        assert started.status_code == 200, started.text
        league_id = started.json()["league_id"]
        kept = client.put(f"/api/hub/mock-draft/{league_id}/keep", json={"saved": True})
        assert kept.status_code == 200, kept.text
        assert kept.json()["saved"] is True
        listed = client.get("/api/hub/mock-drafts")
        assert listed.status_code == 200
        rooms = listed.json()["rooms"]
        match = next(r for r in rooms if r["league_id"] == league_id)
        assert match["saved"] is True
        reload = client.get(f"/api/hub/league/{league_id}")
        assert reload.status_code == 200
        assert reload.json()["league"]["id"] == league_id
        assert reload.json()["league"]["mock_saved"] is True
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
