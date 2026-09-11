import json
import pytest
from fastapi import HTTPException
from src.draft_hub import storage, team_room
from src.draft_hub.presets import load_preset


def league_team():
    ws = storage.get_or_create_workspace("owner")
    league = storage.create_league("owner", "Room league", 2026, load_preset("salary_cap_auction_v1"), workspace_id=ws["id"])
    team = storage.get_team_by_user(league["id"], "owner")
    return league, team


def test_share_is_opt_in_idempotent_revocable_and_rotated(hub_db):
    _, team = league_team()
    assert team_room.settings(team["id"])["share_token"] is None
    token = team_room.share(team["id"], True)
    assert len(token) >= 40
    assert team_room.share(team["id"], True) == token
    assert team_room.shared_team(token)["id"] == team["id"]
    team_room.share(team["id"], False)
    assert team_room.shared_team(token) is None
    assert team_room.share(team["id"], True) != token
    assert team_room.shared_team("' OR 1=1") is None


def test_nickname_overrides_are_scoped_and_resettable(hub_db):
    league, team = league_team()
    storage.join_league("visitor", league["room_code"], "Other")
    other = storage.get_team_by_user(league["id"], "visitor")
    team_room.nickname(team["id"], "player", "The Neighborhood")
    team_room.nickname(team["id"], "other-player", "Other")
    assert json.loads(team_room.settings(other["id"])["nicknames_json"]) == {}
    team_room.nickname(team["id"], "player", None)
    assert json.loads(team_room.settings(team["id"])["nicknames_json"]) == {"other-player": "Other"}


def test_room_owner_gate_rejects_other_members_and_cross_league(hub_db):
    from app.hub_routes import _room_team
    league, team = league_team()
    storage.join_league("visitor", league["room_code"], "Other")
    assert _room_team(league["id"], team["id"], "visitor")["id"] == team["id"]
    with pytest.raises(HTTPException) as exc:
        _room_team(league["id"], team["id"], "visitor", owner=True)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException):
        _room_team("wrong-league", team["id"], "owner")


def test_room_payload_is_allowlisted_and_does_not_leak_contracts(hub_db, monkeypatch):
    from src.draft_hub import hub_scoring, league_sleeper_sync, draft_enrichment
    league, team = league_team()
    storage.update_workspace_prefs("owner", {"atmosphere": "cozy"})
    monkeypatch.setattr(league_sleeper_sync, "resolve_sleeper_league_id", lambda _: "")
    scoring={"available":True,"week":1,"current_week":1,"season":2026,"matchups":[{"teams":[
        {"hub_team_id":team["id"],"is_viewer":True,"points":0,"starters":[{"player_id":"p","name":"Player","position":"QB","team":"PHI","points":0,"proj":23}]},
        {"hub_team_id":"other","team_name":"Opponent","points":0,"user_sub":"secret"}]}]}
    monkeypatch.setattr(hub_scoring,"build_hub_live_week",lambda *a,**k:scoring)
    monkeypatch.setattr(hub_scoring,"nfl_game_started",lambda *a,**k:False)
    monkeypatch.setattr(hub_scoring,"nfl_week_slate_complete",lambda *a,**k:False)
    monkeypatch.setattr(draft_enrichment,"build_player_media_batch",lambda _: {})
    room=team_room.build_room(team)
    assert room["theme"] == "cozy"
    assert room["state"] == "pregame" and room["score"] is None
    assert room["starters"][0]["points"] is None
    assert "user_sub" not in json.dumps(room)
    assert "salary" not in json.dumps(room)
    assert "rules" not in room
    assert room["starters"][0]["can_manage"] is False
    assert room["starters"][0]["projection_status"] == "available"
    # Opening a historical room must not borrow today's bench or reforecast.
    scoring["current_week"] = 2
    scoring["matchups"][0]["teams"][0]["starters"][0]["proj"] = 99
    monkeypatch.setattr(storage, "list_roster", lambda *a: [{"player_id": "new", "player_name": "New signing"}])
    historical = team_room.build_room(team, 1)
    assert historical["state"] == "final"
    assert historical["starters"][0]["projection"] == 23
    assert historical["bench"] == []
    scoring["matchups"][0]["teams"][0]["starters"].append({"player_id": "late", "name": "Late player", "team": "KC", "proj": 20})
    missing = team_room.build_room(team, 1)["starters"][1]
    assert missing["projection"] is None
    assert missing["projection_status"] == "not_saved"

    assert scoring["matchups"][0]["teams"][0]["starters"][0]["proj"] == 99


def test_sleeper_nicknames_are_optional_and_filtered(monkeypatch):
    from src.draft_hub import league_live_scoring
    team_room._nickname_cache.clear()
    monkeypatch.setattr(league_live_scoring,"_fetch_json",lambda _: [{"roster_id":4,"metadata":{"nickname_123":"Rocket","owner":"private","nickname_456":None}}])
    assert team_room.sleeper_nicknames("test", "4") == {"123":"Rocket"}
    assert team_room.sleeper_nicknames("test", "5") == {}


def test_pregame_projection_is_frozen_and_never_backfilled_after_kickoff(hub_db):
    key=("league",2026,6,"player")
    assert team_room.projection_snapshot(*key,17,started=False) == 17
    assert team_room.projection_snapshot(*key,18,started=False) == 18
    assert team_room.projection_snapshot(*key,30,started=True) == 18
    assert team_room.projection_snapshot("league",2026,5,"player",30,started=True) is None


def test_public_link_endpoint_is_readonly_and_revocation_takes_effect(hub_db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.hub_routes import router
    from app.auth import require_hub_user
    app=FastAPI();app.include_router(router)
    league, team=league_team()
    monkeypatch.setattr(team_room,"build_room",lambda team,week=None:{"team":{"name":team["name"]},"photo_media_id":None,"starters":[],"bench":[]})
    app.dependency_overrides[require_hub_user]=lambda:{"sub":"owner"}
    client=TestClient(app)
    path=f"/api/hub/league/{league['id']}/teams/{team['id']}/room/share"
    token=client.patch(path,json={"enabled":True}).json()["share_token"]
    # No auth override is necessary for the public read, but it cannot write.
    app.dependency_overrides[require_hub_user]=lambda:{"sub":"stranger"}
    res=client.get(f"/api/hub/shared-room/{token}")
    assert res.status_code==200 and res.json()["can_edit"] is False
    assert "share_token" not in res.json()
    assert res.headers["cache-control"]=="no-store"
    assert client.patch(path,json={"enabled":False}).status_code==403
    assert client.get(f"/api/hub/shared-room/{token}?week=99").status_code==422
    app.dependency_overrides[require_hub_user]=lambda:{"sub":"owner"}
    assert client.patch(path,json={"enabled":False}).status_code==200
    assert client.get(f"/api/hub/shared-room/{token}").status_code==404


def test_nickname_route_rejects_non_owner_inactive_player_and_invalid_text(hub_db, monkeypatch):
    from app.hub_routes import hub_room_nickname, RoomNicknameUpdate
    league, team = league_team()
    storage.join_league("visitor", league["room_code"], "Other")
    monkeypatch.setattr(storage, "list_roster", lambda *a: [
        {"player_id": "active", "roster_status": "active"},
        {"player_id": "cut", "roster_status": "cut_before_draft"},
    ])
    for user, player, text, code in [
        ("visitor", "active", "Nickname", 403),
        ("owner", "cut", "Nickname", 404),
        ("owner", "missing", "Nickname", 404),
        ("owner", "active", "x" * 41, 422),
        ("owner", "active", "two\nlines", 422),
    ]:
        with pytest.raises(HTTPException) as exc:
            hub_room_nickname(league["id"], team["id"], player, RoomNicknameUpdate(nickname=text), {"sub": user})
        assert exc.value.status_code == code
    assert json.loads(team_room.settings(team["id"])["nicknames_json"]) == {}
    hub_room_nickname(league["id"], team["id"], "active", RoomNicknameUpdate(nickname="  Rocket  "), {"sub": "owner"})
    assert json.loads(team_room.settings(team["id"])["nicknames_json"]) == {"active": "Rocket"}
