"""Queue privacy, OAuth state, invite overfill, empty import, and year-tick once."""

import time

import pytest

from app.auth import (
    OAUTH_STATE_MAX_AGE_SEC,
    safe_oauth_next_path,
    sign_oauth_state,
    verify_oauth_state,
)
from src.draft_hub import storage
from src.draft_hub.contract_service import tick_contracts_on_draft_complete
from src.draft_hub.draft_state import get_room_state, set_nomination_queue
from src.draft_hub.league_invites import create_invite
from src.draft_hub.presets import load_preset


def _league(comm: str, name: str, *, team_count: int = 12):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace(comm)
    return storage.create_league(
        comm, name, 2026, rules, workspace_id=ws["id"], team_count=team_count
    )


def test_room_state_hides_other_nomination_queues(hub_db):
    comm = "queue-comm"
    member = "queue-member"
    league = _league(comm, "Queue League")
    storage.join_league(member, league["room_code"], "Member Team")
    set_nomination_queue(league["id"], comm, ["comm-pick"])
    set_nomination_queue(league["id"], member, ["member-pick"])

    member_state = get_room_state(league["id"], member)
    comm_state = get_room_state(league["id"], comm)
    shared = get_room_state(league["id"])

    assert member_state["viewer"]["nomination_queue"] == ["member-pick"]
    assert comm_state["viewer"]["nomination_queue"] == ["comm-pick"]
    assert all("nomination_queue" not in team for team in member_state["teams"])
    assert all("nomination_queue" not in team for team in comm_state["teams"])
    assert all("nomination_queue" not in team for team in shared["teams"])
    assert "viewer" not in shared


def test_oauth_state_rejects_offsite_and_expired(monkeypatch):
    assert safe_oauth_next_path("/hub/home") == "/hub/home"
    assert safe_oauth_next_path("//evil.example/phish") == "/projections/weekly"
    assert safe_oauth_next_path("https://evil.example/phish") == "/projections/weekly"
    assert safe_oauth_next_path("/%2f%2fevil.example") == "/projections/weekly"

    good = sign_oauth_state("/hub/home")
    assert verify_oauth_state(good) == "/hub/home"
    assert verify_oauth_state("tampered." + good.split(".", 1)[1]) == "/projections/weekly"

    now = time.time()
    monkeypatch.setattr("app.auth.time.time", lambda: now)
    stale = sign_oauth_state("/hub/cap")
    monkeypatch.setattr("app.auth.time.time", lambda: now + OAUTH_STATE_MAX_AGE_SEC + 5)
    assert verify_oauth_state(stale) == "/projections/weekly"


def test_invite_cannot_create_a_seat_past_team_count(hub_db):
    comm = "overfill-comm"
    league = _league(comm, "Overfill League", team_count=2)
    first = create_invite(league["id"], "one@example.com", "Seat Two", comm)
    assert first["team_name"] == "Seat Two"
    assert len(storage.list_league_teams(league["id"])) == 2
    with pytest.raises(ValueError, match="full"):
        create_invite(league["id"], "two@example.com", "Seat Three", comm)
    assert len(storage.list_league_teams(league["id"])) == 2
    assert first["team_id"] == storage.get_or_create_league_team_by_name(
        league["id"], "Seat Two", 200
    )["id"]


def test_empty_replace_import_leaves_existing_roster(hub_db):
    comm = "empty-import-comm"
    league = _league(comm, "Empty Import")
    team = storage.get_team_by_user(league["id"], comm)
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws,
        {
            "player_id": "keep-sleeper",
            "player_name": "Keep Sleeper",
            "team": "SEA",
            "position": "WR",
            "salary": 12,
            "contract_years": 2,
            "source": "sleeper",
        },
        team_id=team["id"],
    )
    with pytest.raises(ValueError, match="empty import"):
        storage.import_roster_snapshot(ws, team["id"], [], replace_source="sleeper")
    assert storage.get_roster_slot(ws, "keep-sleeper")["team_id"] == team["id"]
    with pytest.raises(ValueError, match="empty import"):
        storage.import_commissioner_league_sheet(
            league["id"], ws, [], load_preset("salary_cap_auction_v1"), replace_existing=True
        )
    assert storage.get_roster_slot(ws, "keep-sleeper") is not None


def test_year_tick_does_not_burn_a_second_year(hub_db):
    comm = "tick-once-comm"
    league = _league(comm, "Tick Once")
    team = storage.get_team_by_user(league["id"], comm)
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws,
        {
            "player_id": "two-year-vet",
            "player_name": "Two Year Vet",
            "team": "CHI",
            "position": "WR",
            "salary": 20,
            "contract_years": 2,
            "source": "sheet",
            "contract": {
                "contract_type": "veteran",
                "years_remaining": 2,
                "current_salary": 20,
                "schedule": [
                    {"year_offset": 0, "salary": 20},
                    {"year_offset": 1, "salary": 20},
                ],
            },
        },
        team_id=team["id"],
    )
    first = tick_contracts_on_draft_complete(league["id"])
    assert first.get("already_ticked") is not True
    row = storage.get_roster_slot(ws, "two-year-vet")
    years_after_first = int(row["contract"]["years_remaining"])
    assert years_after_first == 1
    second = tick_contracts_on_draft_complete(league["id"])
    assert second.get("already_ticked") is True
    row = storage.get_roster_slot(ws, "two-year-vet")
    assert int(row["contract"]["years_remaining"]) == years_after_first
    assert row["roster_status"] != "expired"
