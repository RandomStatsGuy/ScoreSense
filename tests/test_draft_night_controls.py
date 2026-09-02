"""SCORE-55 / 56 / 65: draft night schedule, pause/skip, nomination queue."""

from datetime import datetime, timedelta, timezone

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_state import (
    check_timers,
    pause_draft,
    place_bid,
    resume_draft,
    set_draft_schedule,
    set_nomination_queue,
    skip_nomination,
    start_draft,
    tick_expired_drafts,
)
from src.draft_hub.league_home import build_draft_schedule
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _league(sub="night-comm", name="Night League", *, test_mode=False, team_count=2):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace(sub)
    return storage.create_league(
        sub, name, 2026, rules, team_count=team_count, workspace_id=ws["id"], test_mode=test_mode
    )


def test_future_schedule_blocks_start_until_force(hub_db):
    league = _league()
    future = (datetime.now(timezone.utc) + timedelta(hours=3)).replace(microsecond=0)
    set_draft_schedule(
        league["id"],
        "night-comm",
        starts_at=future.isoformat(),
        timezone_name="America/New_York",
    )
    saved = storage.get_league(league["id"])
    assert saved["draft_timezone"] == "America/New_York"
    assert saved["draft_starts_at"]
    with pytest.raises(ValueError, match="scheduled"):
        start_draft(league["id"], "night-comm", allow_empty=True)
    state = start_draft(league["id"], "night-comm", force=True, allow_empty=True)
    assert state["session"]["status"] == "nominating"


def test_clear_schedule_keeps_draft_timezone(hub_db):
    league = _league()
    set_draft_schedule(
        league["id"],
        "night-comm",
        starts_at="2026-09-01T20:00",
        timezone_name="America/Chicago",
    )
    set_draft_schedule(league["id"], "night-comm", clear=True)
    saved = storage.get_league(league["id"])
    assert saved["draft_starts_at"] is None
    assert saved["draft_timezone"] == "America/Chicago"


def test_naive_wall_clock_uses_league_timezone(hub_db):
    league = _league()
    set_draft_schedule(
        league["id"],
        "night-comm",
        starts_at="2026-09-01T20:00",
        timezone_name="America/New_York",
    )
    saved = storage.get_league(league["id"])
    when = datetime.fromisoformat(saved["draft_starts_at"])
    # 8pm EDT is 00:00 UTC next day (EDT = UTC-4 on Sep 1).
    assert when.astimezone(timezone.utc).hour in {0, 1}  # EDT or EST


def test_tick_starts_due_live_league(hub_db):
    league = _league(team_count=1)
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    storage.update_league_settings(league["id"], draft_starts_at=past, draft_timezone="UTC")
    changed = tick_expired_drafts()
    assert league["id"] in changed
    session = storage.get_draft_session(league["id"])
    assert session["status"] == "nominating"


def test_pause_blocks_bids_and_timer_expiry(hub_db):
    league = _league()
    start_draft(league["id"], "night-comm", allow_empty=True)
    team = storage.get_team_by_user(league["id"], "night-comm")
    storage.update_draft_session(
        league["id"],
        status="bidding",
        current_nominee_json='{"player_id":"p1","player_name":"Pause WR","position":"WR"}',
        high_bid=1,
        high_bidder_team_id=team["id"],
        bid_deadline=(datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat(),
    )
    pause_draft(league["id"], "night-comm")
    session = storage.get_draft_session(league["id"])
    assert session["paused"] is True
    with pytest.raises(ValueError, match="paused"):
        place_bid(league["id"], "night-comm", 2)
    storage.update_draft_session(
        league["id"],
        bid_deadline=(datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat(),
    )
    state = check_timers(league["id"], "night-comm")
    assert state["session"]["status"] == "bidding"
    assert state["session"]["paused"] is True


def test_resume_shifts_deadlines(hub_db):
    league = _league()
    start_draft(league["id"], "night-comm", allow_empty=True)
    original = storage.get_draft_session(league["id"])["nomination_deadline"]
    storage.update_draft_session(
        league["id"],
        paused=1,
        paused_at=(datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat(),
    )
    resume_draft(league["id"], "night-comm")
    session = storage.get_draft_session(league["id"])
    assert session["paused"] is False
    assert session["nomination_deadline"] > original


def test_skip_nomination_advances_clock(hub_db):
    league = _league()
    storage.join_league("other-night", league["room_code"], "Other")
    start_draft(league["id"], "night-comm", allow_empty=True)
    first = storage.get_draft_session(league["id"])["nominator_index"]
    skip_nomination(league["id"], "night-comm")
    session = storage.get_draft_session(league["id"])
    assert session["status"] == "nominating"
    assert session["nominator_index"] != first
    events = storage.list_draft_events(league["id"])
    skips = [e for e in events if e.get("event_type") == "pass"]
    assert skips and skips[-1]["payload"].get("reason") == "commissioner_skip"


def test_autodraft_uses_queue_then_need_aware(hub_db, monkeypatch):
    league = _league(test_mode=False)
    player = {
        "player_id": "queued-te",
        "player": "Queued TE",
        "player_name": "Queued TE",
        "team": "KC",
        "position": "TE",
        "fair_value": 6,
        "season_proj": 90,
        "is_rookie": False,
    }
    wr = {
        "player_id": "other-wr",
        "player": "Other WR",
        "player_name": "Other WR",
        "team": "DAL",
        "position": "WR",
        "fair_value": 40,
        "season_proj": 180,
        "is_rookie": False,
    }
    monkeypatch.setattr(
        "src.draft_hub.draft_pool.build_nomination_pool",
        lambda **kwargs: {
            "rows": [wr, player],
            "count": 2,
            "drafted_count": 0,
            "hub_available_count": 0,
            "pool_mode": "full",
        },
    )
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: player if kwargs.get("player_id") == "queued-te" else wr,
    )
    start_draft(league["id"], "night-comm", allow_empty=True)
    set_nomination_queue(league["id"], "night-comm", ["queued-te"], autodraft=True)
    state = check_timers(league["id"], "night-comm")
    assert state["session"]["status"] == "bidding"
    assert (state["session"].get("current_nominee") or {}).get("player_id") == "queued-te"
    assert state["viewer"]["nomination_queue"] == []


def test_draft_schedule_payload_countdown():
    future = datetime.now(timezone.utc) + timedelta(minutes=90)
    payload = build_draft_schedule(
        {"draft_starts_at": future.isoformat(), "draft_timezone": "UTC"},
        now=datetime.now(timezone.utc),
    )
    assert payload is not None
    assert payload["is_due"] is False
    assert payload["seconds_until"] > 0
