"""Draft-night availability calendar window and overlap."""

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.draft_availability import (
    OPEN_DAYS_BEFORE,
    availability_window,
    build_availability_payload,
    save_availability,
    validate_slots,
)
from src.draft_hub.presets import load_preset


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.pop(require_hub_user, None)


def _kickoff():
    return datetime(2026, 9, 10, 20, 20, tzinfo=timezone.utc)


def test_window_opens_31_days_before_and_closes_day_before():
    window = availability_window(
        2026,
        timezone_name="America/New_York",
        now=datetime(2026, 8, 20, 15, 0, tzinfo=timezone.utc),
        first_kickoff=_kickoff(),
    )
    assert window["state"] == "open"
    assert window["first_game_date"] == "2026-09-10"
    assert window["opens_on"] == "2026-08-10"
    assert window["closes_on"] == "2026-09-09"
    assert OPEN_DAYS_BEFORE == 31
    assert window["today"] == "2026-08-20"
    assert "2026-08-10" not in window["dates"]
    assert "2026-08-20" in window["dates"]
    assert "2026-09-09" in window["dates"]
    assert "2026-09-10" not in window["dates"]


def test_window_upcoming_and_closed():
    upcoming = availability_window(
        2026,
        now=datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc),
        first_kickoff=_kickoff(),
    )
    assert upcoming["state"] == "upcoming"
    closed = availability_window(
        2026,
        now=datetime(2026, 9, 10, 16, 0, tzinfo=timezone.utc),
        first_kickoff=_kickoff(),
    )
    assert closed["state"] == "closed"


def test_validate_slots_rejects_outside_window():
    window = availability_window(
        2026,
        now=datetime(2026, 8, 20, 15, 0, tzinfo=timezone.utc),
        first_kickoff=_kickoff(),
    )
    cleaned = validate_slots([{"date": "2026-08-22", "hour": 20}], window)
    assert cleaned == [("2026-08-22", 20)]
    assert validate_slots([{"date": "2026-09-10", "hour": 20}], window) == []
    kept = validate_slots(
        [{"date": "2026-07-01", "hour": 20}, {"date": "2026-08-22", "hour": 20}],
        window,
    )
    assert kept == [("2026-08-22", 20)]
    try:
        validate_slots([{"date": "2026-08-22", "hour": 3}], window)
        raise AssertionError("overnight hour should reject")
    except ValueError as exc:
        assert "hour" in str(exc)


def test_overlap_counts_and_api(hub_db):
    comm = "avail-comm"
    member = "avail-member"
    ws = storage.get_or_create_workspace(comm, season=2026)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Calendar League", 2026, rules, workspace_id=ws["id"])
    other = storage.join_league(member, league["room_code"], "Visitor")
    kick = _kickoff()
    now = datetime(2026, 8, 20, 15, 0, tzinfo=timezone.utc)
    save_availability(
        league["id"],
        comm,
        [{"date": "2026-08-22", "hour": 20}, {"date": "2026-08-23", "hour": 19}],
        now=now,
        first_kickoff=kick,
    )
    save_availability(
        league["id"],
        member,
        [{"date": "2026-08-22", "hour": 20}],
        now=now,
        first_kickoff=kick,
    )
    payload = build_availability_payload(
        league["id"],
        comm,
        now=now,
        first_kickoff=kick,
    )
    assert payload["can_edit"] is True
    assert payload["submitted"] == 2
    best = payload["best"][0]
    assert best["date"] == "2026-08-22"
    assert best["hour"] == 20
    assert best["count"] == 2
    names = {p["name"] for p in best["people"]}
    assert any("Visitor" in n or other["name"] in n for n in names)

    try:
        save_availability(
            league["id"],
            comm,
            [{"date": "2026-08-22", "hour": 20}],
            now=datetime(2026, 9, 10, 16, 0, tzinfo=timezone.utc),
            first_kickoff=kick,
        )
        raise AssertionError("closed window should reject writes")
    except ValueError as exc:
        assert "closed" in str(exc).lower()

    client = _client_for(comm)
    res = client.get(f"/api/hub/league/{league['id']}/availability")
    assert res.status_code == 200
    body = res.json()
    assert "window" in body
    assert "heat" in body


def test_stale_slots_do_not_block_save_or_count_as_marked(hub_db):
    comm = "avail-stale"
    ws = storage.get_or_create_workspace(comm, season=2026)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Stale Calendar", 2026, rules, workspace_id=ws["id"])
    team = storage.get_team_by_user(league["id"], comm)
    later = datetime(2026, 9, 10, 20, 20, tzinfo=timezone.utc)
    now = datetime(2026, 8, 20, 15, 0, tzinfo=timezone.utc)
    storage.replace_team_draft_availability(
        league["id"],
        str(team["id"]),
        comm,
        [("2026-08-06", 20)],
    )
    payload = build_availability_payload(
        league["id"],
        comm,
        now=now,
        first_kickoff=later,
    )
    assert payload["mine"] == []
    assert payload["submitted"] == 0
    saved = save_availability(
        league["id"],
        comm,
        [{"date": "2026-08-06", "hour": 20}, {"date": "2026-08-22", "hour": 19}],
        now=now,
        first_kickoff=later,
    )
    assert saved["mine"] == [{"date": "2026-08-22", "hour": 19}]
    assert saved["submitted"] == 1


def test_window_hides_past_hours_on_today():
    window = availability_window(
        2026,
        timezone_name="America/New_York",
        now=datetime(2026, 8, 20, 22, 30, tzinfo=timezone.utc),
        first_kickoff=_kickoff(),
    )
    assert window["today"] == "2026-08-20"
    assert window["current_hour"] == 18
    assert validate_slots([{"date": "2026-08-20", "hour": 16}], window) == []
    assert validate_slots([{"date": "2026-08-20", "hour": 18}], window) == [("2026-08-20", 18)]
    assert validate_slots([{"date": "2026-08-20", "hour": 12}, {"date": "2026-08-21", "hour": 12}], window) == [
        ("2026-08-21", 12)
    ]
