"""Staff add/remove franchise for salary-cap auction leagues."""

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.league_resize import (
    LeagueResizeError,
    apply_add_franchise,
    apply_remove_franchise,
    league_resize_snapshot,
    next_count_on_add,
    next_count_on_remove,
    preview_add_franchise,
    preview_remove_franchise,
)
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {
        "sub": sub,
        "auth_type": "native",
        "email": f"{sub}@example.com",
    }
    return TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.pop(require_hub_user, None)


def _league(comm="resize-comm", *, team_count=8, name="Resize League"):
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    return storage.create_league(
        comm, name, 2026, rules, workspace_id=ws["id"], team_count=team_count
    )


def test_next_count_helpers_keep_open_seats():
    assert next_count_on_add(8, 1) == 8
    assert next_count_on_add(8, 8) == 9
    assert next_count_on_remove(8, 2) == 8
    assert next_count_on_remove(8, 8) == 7
    assert next_count_on_remove(2, 2) == 2


def test_add_franchise_creates_unclaimed_seat_and_bumps_cap(hub_db):
    league = _league(team_count=2)
    storage.join_league("resize-member", league["room_code"], "Incumbent")
    out = apply_add_franchise(league["id"], "Expansion North")
    assert out["ok"] is True
    team = out["team"]
    assert team["name"] == "Expansion North"
    assert team.get("user_sub") in (None, "")
    assert float(team["budget_remaining"]) == 200
    refreshed = storage.get_league(league["id"])
    assert refreshed["team_count"] == 3
    teams = storage.list_league_teams(league["id"])
    assert len(teams) == 3


def test_add_franchise_fills_open_seat_without_raising_cap(hub_db):
    league = _league(team_count=10)
    preview = preview_add_franchise(league["id"], "Seat Two")
    assert preview["ok"] is True
    assert preview["next_team_count"] == 10
    apply_add_franchise(league["id"], "Seat Two")
    assert storage.get_league(league["id"])["team_count"] == 10
    assert len(storage.list_league_teams(league["id"])) == 2


def test_add_franchise_blocked_after_draft_complete(hub_db):
    league = _league()
    storage.update_league_settings(league["id"], draft_completed=True)
    preview = preview_add_franchise(league["id"], "Too Late")
    assert preview["ok"] is False
    assert "already drafted" in preview["blocker"]
    with pytest.raises(LeagueResizeError, match="already drafted"):
        apply_add_franchise(league["id"], "Too Late")


def test_add_franchise_blocked_while_live(hub_db):
    league = _league()
    storage.update_league_status(league["id"], "live")
    storage.update_draft_session(league["id"], status="nominating")
    preview = preview_add_franchise(league["id"], "Live Add")
    assert preview["ok"] is False
    assert "live" in preview["blocker"].lower()


def test_add_franchise_rejects_duplicate_name(hub_db):
    league = _league()
    apply_add_franchise(league["id"], "Harbor")
    preview = preview_add_franchise(league["id"], "harbor")
    assert preview["ok"] is False
    assert "already a franchise" in preview["blocker"]


def test_remove_empty_franchise(hub_db):
    league = _league(team_count=8)
    added = apply_add_franchise(league["id"], "Folding")
    team_id = added["team"]["id"]
    out = apply_remove_franchise(league["id"], team_id, actor_sub="resize-comm")
    assert out["ok"] is True
    names = [t["name"] for t in storage.list_league_teams(league["id"])]
    assert "Folding" not in names
    assert storage.get_league(league["id"])["team_count"] == 8


def test_remove_blocked_with_active_contract(hub_db):
    league = _league(team_count=8)
    added = apply_add_franchise(league["id"], "Loaded")
    team_id = added["team"]["id"]
    ws = storage.roster_workspace_for_league(storage.get_league(league["id"]))
    storage.add_roster_slot(
        ws,
        {
            "player_id": "00-0035640",
            "player_name": "Keeper",
            "team": "SEA",
            "position": "WR",
            "salary": 20,
            "contract_years": 2,
            "source": "sheet",
        },
        team_id=team_id,
    )
    preview = preview_remove_franchise(league["id"], team_id)
    assert preview["ok"] is False
    assert "contract" in preview["blocker"].lower()
    with pytest.raises(LeagueResizeError, match="contract"):
        apply_remove_franchise(league["id"], team_id, actor_sub="resize-comm")


def test_remove_blocked_for_commissioner_and_floor(hub_db):
    league = _league(team_count=2)
    comm_team = storage.get_team_by_user(league["id"], "resize-comm")
    preview = preview_remove_franchise(league["id"], comm_team["id"])
    assert preview["ok"] is False
    assert "primary commissioner" in preview["blocker"]

    other = apply_add_franchise(league["id"], "Second")
    # Two clubs, configured at least 2 — removing the extra is allowed.
    assert preview_remove_franchise(league["id"], other["team"]["id"])["ok"] is True
    apply_remove_franchise(league["id"], other["team"]["id"], actor_sub="resize-comm")
    # One club left — cannot fold the last member seat if we re-add then try to go to 0.
    leftover = storage.list_league_teams(league["id"])
    assert len(leftover) == 1
    last = preview_remove_franchise(league["id"], leftover[0]["id"])
    assert last["ok"] is False
    assert "last franchise" in last["blocker"] or "primary commissioner" in last["blocker"]


def test_invite_after_add_claims_same_seat(hub_db):
    league = _league(team_count=8)
    added = apply_add_franchise(league["id"], "Team Alpha")
    invite_team = storage.get_or_create_league_team_by_name(
        league["id"], "Team Alpha", 200
    )
    assert invite_team["id"] == added["team"]["id"]
    snap = league_resize_snapshot(league["id"])
    assert snap["team_count"] == 8
    assert snap["actual_teams"] == 2
    assert snap["add"]["ok"] is True


def test_franchise_http_add_and_remove(hub_db):
    comm = "http-resize-comm"
    league = _league(comm, team_count=8)
    client = _client_for(comm)
    members = client.get(f"/api/hub/league/{league['id']}/members")
    assert members.status_code == 200
    assert members.json()["resize"]["add"]["ok"] is True

    added = client.post(
        f"/api/hub/league/{league['id']}/franchises",
        json={"name": "Harbor"},
    )
    assert added.status_code == 200
    body = added.json()
    assert body["team"]["name"] == "Harbor"
    team_id = body["team"]["id"]

    member = client.get(f"/api/hub/league/{league['id']}/members")
    removal = next(r for r in member.json()["resize"]["removals"] if r["team_id"] == team_id)
    assert removal["ok"] is True

    gone = client.delete(f"/api/hub/league/{league['id']}/franchises/{team_id}")
    assert gone.status_code == 200
    names = [t["name"] for t in storage.list_league_teams(league["id"])]
    assert "Harbor" not in names


def test_franchise_http_member_cannot_resize(hub_db):
    comm = "http-resize-staff"
    league = _league(comm, team_count=8)
    storage.join_league("http-resize-member", league["room_code"], "Other")
    client = _client_for("http-resize-member")
    res = client.post(
        f"/api/hub/league/{league['id']}/franchises",
        json={"name": "Nope"},
    )
    assert res.status_code == 403
