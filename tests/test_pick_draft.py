"""Snake / linear pick drafts vs salary-cap auction."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_recap import build_draft_recap, build_owner_draft_report
from src.draft_hub.draft_state import make_pick, nominate, start_draft
from src.draft_hub.pick_draft import is_pick_draft, team_at_pick_index
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _league(sub, *, preset="snake_draft_v1", team_count=2, test_mode=True, name="Pick League"):
    rules = load_preset(preset)
    ws = None if test_mode else storage.get_or_create_workspace(sub)
    return storage.create_league(
        sub,
        name,
        2026,
        rules,
        team_count=team_count,
        workspace_id=None if test_mode else ws["id"],
        test_mode=test_mode,
    )


def _player(pid):
    return {
        "player_id": pid,
        "player": pid,
        "player_name": pid,
        "team": "KC",
        "position": "WR",
        "fair_value": 12,
        "season_proj": 140,
    }


def _stub_resolve(monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: _player(str(kwargs.get("player_id") or "stub")),
    )


def test_team_at_pick_index_snakes_odd_rounds():
    order = ["a", "b", "c"]
    assert [team_at_pick_index(order, i, "snake") for i in range(6)] == [
        "a",
        "b",
        "c",
        "c",
        "b",
        "a",
    ]
    assert [team_at_pick_index(order, i, "linear") for i in range(6)] == [
        "a",
        "b",
        "c",
        "a",
        "b",
        "c",
    ]


def test_snake_preset_is_pick_draft():
    assert is_pick_draft(load_preset("snake_draft_v1")) is True
    assert is_pick_draft(load_preset("linear_draft_v1")) is True
    assert is_pick_draft(load_preset("salary_cap_auction_v1")) is False


def test_start_snake_enters_picking(hub_db):
    league = _league("snake-comm")
    state = start_draft(league["id"], "snake-comm")
    assert state["session"]["status"] == "picking"
    assert state["draft_type"] == "snake"
    assert state["pick"]["overall"] == 1
    assert state["pick"]["round"] == 1
    assert state["nominator_team_id"]


def test_start_linear_enters_picking(hub_db):
    league = _league("lin-comm", preset="linear_draft_v1")
    state = start_draft(league["id"], "lin-comm")
    assert state["session"]["status"] == "picking"
    assert state["draft_type"] == "linear"


def test_start_auction_still_nominating(hub_db):
    league = _league("auc-comm", preset="salary_cap_auction_v1", team_count=1)
    state = start_draft(league["id"], "auc-comm")
    assert state["session"]["status"] == "nominating"
    assert state["draft_type"] == "auction"
    assert state.get("pick") is None


def test_make_pick_rejected_on_auction(hub_db, monkeypatch):
    _stub_resolve(monkeypatch)
    league = _league("auc-comm", preset="salary_cap_auction_v1", team_count=1)
    start_draft(league["id"], "auc-comm")
    with pytest.raises(ValueError, match="auction"):
        make_pick(league["id"], "auc-comm", _player("p-auc"))


def test_nominate_rejected_on_snake(hub_db, monkeypatch):
    _stub_resolve(monkeypatch)
    league = _league("snake-comm")
    start_draft(league["id"], "snake-comm")
    with pytest.raises(ValueError, match="pick draft"):
        nominate(league["id"], "snake-comm", _player("p-nom"))


def test_snake_pick_assigns_and_reverses_round_two(hub_db, monkeypatch):
    _stub_resolve(monkeypatch)
    league = _league("snake-comm", team_count=2)
    storage.join_league("snake-member", league["room_code"], "Member")
    comm = storage.get_team_by_user(league["id"], "snake-comm")
    member = storage.get_team_by_user(league["id"], "snake-member")
    state = start_draft(league["id"], "snake-comm")
    order = (state["session"].get("nomination_order") or [])
    assert order[:2] == [comm["id"], member["id"]] or set(order[:2]) == {comm["id"], member["id"]}
    first_id = state["nominator_team_id"]
    first_sub = "snake-comm" if str(first_id) == str(comm["id"]) else "snake-member"
    other_sub = "snake-member" if first_sub == "snake-comm" else "snake-comm"
    other_id = member["id"] if first_sub == "snake-comm" else comm["id"]

    with pytest.raises(ValueError, match="turn to pick"):
        make_pick(league["id"], other_sub, _player("p-wrong"))

    state = make_pick(league["id"], first_sub, _player("p1"))
    roster = storage.list_team_roster(league["id"], first_id)
    assert any(r["player_id"] == "p1" for r in roster)
    assert float(roster[0].get("salary") or 0) == 0
    assert state["nominator_team_id"] == other_id
    assert state["pick"]["overall"] == 2

    state = make_pick(league["id"], other_sub, _player("p2"))
    # Snake: round 2 starts with the same team that just picked (reverse).
    assert state["nominator_team_id"] == other_id
    assert state["pick"]["round"] == 2

    state = make_pick(league["id"], other_sub, _player("p3"))
    assert state["nominator_team_id"] == first_id
    # Round 2 ends with the original first seat; round 3 starts with that same seat.
    state = make_pick(league["id"], first_sub, _player("p4"))
    assert state["nominator_team_id"] == first_id
    assert state["pick"]["round"] == 3
    state = make_pick(league["id"], first_sub, _player("p5"))
    assert state["nominator_team_id"] == other_id
    state = make_pick(league["id"], other_sub, _player("p6"))
    assert state["nominator_team_id"] == other_id
    assert state["pick"]["round"] == 4


def test_linear_does_not_reverse(hub_db, monkeypatch):
    _stub_resolve(monkeypatch)
    league = _league("lin-comm", preset="linear_draft_v1", team_count=2)
    storage.join_league("lin-member", league["room_code"], "Member")
    comm = storage.get_team_by_user(league["id"], "lin-comm")
    member = storage.get_team_by_user(league["id"], "lin-member")
    state = start_draft(league["id"], "lin-comm")
    first_id = state["nominator_team_id"]
    first_sub = "lin-comm" if str(first_id) == str(comm["id"]) else "lin-member"
    other_sub = "lin-member" if first_sub == "lin-comm" else "lin-comm"
    other_id = member["id"] if first_sub == "lin-comm" else comm["id"]

    state = make_pick(league["id"], first_sub, _player("p1"))
    assert state["nominator_team_id"] == other_id
    state = make_pick(league["id"], other_sub, _player("p2"))
    assert state["nominator_team_id"] == first_id
    assert state["pick"]["round"] == 2
    state = make_pick(league["id"], first_sub, _player("p3"))
    assert state["nominator_team_id"] == other_id
    state = make_pick(league["id"], other_sub, _player("p4"))
    assert state["nominator_team_id"] == first_id
    assert state["pick"]["round"] == 3
    state = make_pick(league["id"], first_sub, _player("p5"))
    assert state["nominator_team_id"] == other_id
    state = make_pick(league["id"], other_sub, _player("p6"))
    assert state["nominator_team_id"] == first_id


def test_commissioner_force_pick_uses_on_clock_team(hub_db, monkeypatch):
    _stub_resolve(monkeypatch)
    league = _league("snake-comm", team_count=2, test_mode=False)
    storage.join_league("snake-member", league["room_code"], "Member")
    member = storage.get_team_by_user(league["id"], "snake-member")
    comm = storage.get_team_by_user(league["id"], "snake-comm")
    start_draft(league["id"], "snake-comm")
    from src.draft_hub.draft_state import get_room_state, skip_nomination

    room = get_room_state(league["id"], "snake-comm")
    if str(room["nominator_team_id"]) == str(comm["id"]):
        skip_nomination(league["id"], "snake-comm")
        room = get_room_state(league["id"], "snake-comm")
    assert str(room["nominator_team_id"]) == str(member["id"])
    state = make_pick(league["id"], "snake-comm", _player("forced-wr"), force=True)
    member_roster = storage.list_team_roster(league["id"], member["id"])
    comm_roster = storage.list_team_roster(league["id"], comm["id"])
    assert any(r["player_id"] == "forced-wr" for r in member_roster)
    assert not any(r["player_id"] == "forced-wr" for r in comm_roster)
    events = storage.list_draft_events(league["id"])
    picks = [e for e in events if e.get("event_type") == "pick"]
    assert picks and picks[-1]["payload"].get("forced") is True


def test_pick_recap_skips_cap_awards(hub_db):
    rules = load_preset("snake_draft_v1")
    league = storage.create_league("recap-snake", "Snake Recap", 2025, rules, test_mode=True)
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    storage.update_draft_session(league["id"], status="completed", completed_at="2026-01-01T00:00:00+00:00")
    storage.update_league_settings(league["id"], draft_completed=True)
    storage.append_draft_event(
        league["id"],
        "pick",
        {
            "team_id": team["id"],
            "team_name": team["name"],
            "player_id": "p-one",
            "player_name": "First Pick",
            "position": "RB",
            "amount": 0,
            "overall": 1,
            "round": 1,
            "season_proj": 180.4,
        },
    )
    recap = build_draft_recap(league["id"])
    assert recap is not None
    assert recap["pick_draft"] is True
    assert recap["draft_type"] == "snake"
    assert recap["pick_count"] == 1
    auction_ids = {
        "steal_of_draft",
        "reach_of_draft",
        "splash",
        "coupon_clipper",
        "tightwad",
        "empty_wallet",
        "position_obsessed",
        "cap_hoarder",
    }
    assert not any(a["id"] in auction_ids for a in recap["awards"])
    award_blob = " ".join(f"{a.get('title')} {a.get('detail')} {a.get('blurb')}" for a in recap["awards"]).lower()
    for banned in ("cap hoarder", "empty wallet", "amount spent", "fair salary", "auction wins", "notable sales", "$"):
        assert banned not in award_blob
    assert recap["headline"]
    assert "Snake" in recap["headline"] or "snake" in recap["headline"].lower()
    assert recap["total_spent"] == 0
    assert recap.get("record_games") == 14
    assert recap.get("projected_standings")
    assert recap["projected_standings"][0]["points_p10"] <= recap["projected_standings"][0]["points_p50"]
    assert recap["projected_standings"][0]["points_p50"] <= recap["projected_standings"][0]["points_p90"]
    assert recap["notable_picks"][0]["overall"] == 1
    assert recap["notable_picks"][0]["round"] == 1
    assert recap["notable_picks"][0]["season_proj"] == 180.4

    report = build_owner_draft_report(league["id"], team["id"])
    assert report is not None
    assert report["pick_draft"] is True
    assert report["draft_type"] == "snake"
    assert report["picks"][0]["overall"] == 1
    assert report["picks"][0]["round"] == 1
    assert report["picks"][0]["season_proj"] == 180.4
    assert report["total_spent"] == 0


def test_linear_recap_headline_and_no_auction_awards(hub_db):
    rules = load_preset("linear_draft_v1")
    league = storage.create_league("recap-lin", "Linear Recap", 2025, rules, test_mode=True)
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    storage.update_draft_session(league["id"], status="completed", completed_at="2026-01-01T00:00:00+00:00")
    storage.update_league_settings(league["id"], draft_completed=True)
    storage.append_draft_event(
        league["id"],
        "pick",
        {
            "team_id": team["id"],
            "team_name": team["name"],
            "player_id": "p-lin",
            "player_name": "Linear Pick",
            "position": "WR",
            "amount": 0,
            "overall": 1,
            "round": 1,
            "season_proj": 160,
        },
    )
    recap = build_draft_recap(league["id"])
    assert recap["pick_draft"] is True
    assert recap["draft_type"] == "linear"
    assert "linear" in recap["headline"].lower()
    assert "snake" not in recap["headline"].lower()
    auction_ids = {"steal_of_draft", "tightwad", "empty_wallet"}
    assert not any(a["id"] in auction_ids for a in recap["awards"])
    assert recap.get("projected_standings")


def test_http_pick_assigns(hub_db, monkeypatch):
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user

    _stub_resolve(monkeypatch)
    league = _league("http-comm", team_count=1)
    start_draft(league["id"], "http-comm")
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "http-comm", "auth_type": "dev"}
    client = TestClient(app)
    try:
        res = client.post(
            f"/api/hub/league/{league['id']}/pick",
            json=_player("http-wr"),
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["session"]["status"] == "picking"
        assert body.get("pick")
        roster = storage.list_team_roster(
            league["id"],
            storage.get_team_by_user(league["id"], "http-comm")["id"],
        )
        assert any(r["player_id"] == "http-wr" for r in roster)
        nom = client.post(
            f"/api/hub/league/{league['id']}/nominate",
            json=_player("http-nom"),
        )
        assert nom.status_code == 400
        assert "pick draft" in (nom.json().get("detail") or "").lower()
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_practice_mock_inherits_snake_rules(hub_db):
    from src.draft_hub.mock_draft import start_mock_draft

    league = _league("snake-comm", team_count=4)
    out = start_mock_draft(
        "snake-comm",
        mode="quick_bots",
        source_league_id=league["id"],
        bot_count=2,
        auto_start=True,
    )
    mock = storage.get_league(out["league_id"])
    assert mock["rules"]["draft_type"] == "snake"
    session = (out.get("state") or {}).get("session") or storage.get_draft_session(out["league_id"])
    assert session["status"] == "picking"
    assert (out.get("state") or {}).get("draft_type") == "snake"
