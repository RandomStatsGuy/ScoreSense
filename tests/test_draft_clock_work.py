"""The server clock advances commands without paying for room presentation."""
import asyncio
import threading
from datetime import datetime, timedelta, timezone

import pytest

from src.draft_hub import draft_state, storage, test_draft
from src.draft_hub.presets import load_preset


def _league(sub, *, test_mode=False, preset="salary_cap_auction_v1", team_count=1):
    ws = storage.get_or_create_workspace(sub)
    return storage.create_league(
        sub, "Clock test", 2026, load_preset(preset),
        team_count=team_count, workspace_id=ws["id"], test_mode=test_mode,
    )


def _forbid_views(monkeypatch):
    def fail(*args, **kwargs):
        pytest.fail("Clock advancement constructed a room view")
    monkeypatch.setattr(draft_state, "get_room_state", fail)
    monkeypatch.setattr(test_draft, "get_room_state", fail)


@pytest.mark.parametrize("test_mode", [False, True])
def test_idle_tick_never_builds_room(hub_db, monkeypatch, test_mode):
    league = _league("clock-idle", test_mode=test_mode)
    draft_state.start_draft(league["id"], "clock-idle")
    storage.update_draft_session(league["id"], nomination_deadline=None)
    before = storage.get_draft_session(league["id"])
    _forbid_views(monkeypatch)
    assert draft_state.tick_expired_drafts() == []
    assert storage.get_draft_session(league["id"]) == before


def test_scheduled_start_never_builds_room(hub_db, monkeypatch):
    league = _league("clock-scheduled")
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    storage.update_league_settings(league["id"], draft_starts_at=past)
    _forbid_views(monkeypatch)
    assert draft_state.tick_expired_drafts() == [league["id"]]
    assert storage.get_draft_session(league["id"])["status"] == "nominating"


@pytest.mark.parametrize("autodraft", [False, True])
def test_nomination_command_never_builds_room(hub_db, monkeypatch, autodraft):
    league = _league("clock-nominate")
    draft_state.start_draft(league["id"], "clock-nominate")
    team = storage.get_team_by_user(league["id"], "clock-nominate")
    storage.update_team_draft_prefs(team["id"], autodraft=autodraft)
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    storage.update_draft_session(league["id"], nomination_deadline=past)
    player = {"player_id": "clock-wr", "player": "Clock WR", "position": "WR", "team": "DAL"}
    monkeypatch.setattr(test_draft, "_pick_nomination_payload", lambda *args: player)
    _forbid_views(monkeypatch)
    assert draft_state.tick_expired_drafts() == [league["id"]]
    session = storage.get_draft_session(league["id"])
    assert session["status"] == "bidding"
    assert session["current_nominee"]["player_id"] == "clock-wr"
    assert session["high_bidder_team_id"] == team["id"]
    # The empty command result must still count as a successful action.
    assert len([e for e in storage.list_draft_events(league["id"]) if e["event_type"] == "nominate"]) == 1


def test_check_timers_builds_one_view_with_caller_identity(hub_db, monkeypatch):
    league = _league("clock-viewer")
    draft_state.start_draft(league["id"], "clock-viewer")
    storage.update_draft_session(league["id"], nomination_deadline=None)
    original = draft_state.get_room_state
    calls = []
    def view(league_id, user_sub=None):
        calls.append(user_sub)
        return original(league_id, user_sub)
    monkeypatch.setattr(draft_state, "get_room_state", view)
    monkeypatch.setattr(test_draft, "get_room_state", lambda *args: pytest.fail("Bot helper built a view"))
    result = draft_state.check_timers(league["id"], "clock-viewer")
    assert result["session"]["status"] == "nominating"
    assert calls == ["clock-viewer"]


@pytest.mark.parametrize("preset,bot", [
    ("salary_cap_auction_v1", True),
    ("snake_draft_v1", True),
    ("snake_draft_v1", False),
])
def test_bot_and_autopick_commands_never_build_rooms(hub_db, monkeypatch, preset, bot):
    league = _league("clock-bot", test_mode=True, preset=preset, team_count=2)
    if bot:
        test_draft.setup_test_draft(league["id"], "clock-bot", bot_count=1)
    draft_state.start_draft(league["id"], "clock-bot")
    team = (next(t for t in storage.list_league_teams(league["id"]) if t.get("is_bot"))
            if bot else storage.get_team_by_user(league["id"], "clock-bot"))
    storage.update_team_draft_prefs(team["id"], autodraft=not bot)
    session = storage.get_draft_session(league["id"])
    storage.update_draft_session(league["id"], nominator_index=session["nomination_order"].index(team["id"]))
    player = {"player_id": "clock-bot-wr", "player": "Clock Bot WR", "position": "WR", "team": "DAL"}
    monkeypatch.setattr(test_draft, "_pick_nomination_payload", lambda *args: player)
    _forbid_views(monkeypatch)
    assert draft_state.tick_expired_drafts() == [league["id"]]
    events = storage.list_draft_events(league["id"])
    event_type = "nominate" if preset == "salary_cap_auction_v1" else "pick"
    assert len([e for e in events if e["event_type"] == event_type]) == 1
    if event_type == "pick":
        assert storage.list_team_roster(league["id"], team["id"])[0]["player_id"] == "clock-bot-wr"


def test_expired_award_never_builds_room(hub_db, monkeypatch):
    league = _league("clock-award")
    draft_state.start_draft(league["id"], "clock-award")
    player = {"player_id": "clock-award-wr", "player": "Clock Award WR", "position": "WR", "team": "DAL"}
    draft_state.nominate(league["id"], "clock-award", player, from_pool=True)
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    storage.update_draft_session(league["id"], bid_deadline=past)
    _forbid_views(monkeypatch)
    assert draft_state.tick_expired_drafts() == [league["id"]]
    team = storage.get_team_by_user(league["id"], "clock-award")
    assert storage.list_team_roster(league["id"], team["id"])[0]["player_id"] == "clock-award-wr"


def test_broadcast_reads_committed_state_without_another_tick(monkeypatch):
    from app import hub_routes
    main_thread = threading.get_ident()
    reads, sent = [], []
    def read(league_id):
        assert threading.get_ident() != main_thread
        reads.append(league_id)
        return {"session": {"status": "bidding"}}
    async def send(league_id, payload):
        sent.append((league_id, payload))
    monkeypatch.setattr(hub_routes, "get_room_state", read)
    monkeypatch.setattr(hub_routes, "check_timers", lambda *args: pytest.fail("Broadcast advanced clock twice"))
    monkeypatch.setattr(hub_routes.draft_room_manager, "has_listeners", lambda league_id: True)
    monkeypatch.setattr(hub_routes.draft_room_manager, "broadcast", send)
    asyncio.run(hub_routes.broadcast_room("changed-league"))
    assert reads == ["changed-league"]
    assert sent == [("changed-league", {"type": "state", "payload": {"session": {"status": "bidding"}}})]


def test_broadcast_without_listeners_builds_no_state(monkeypatch):
    from app import hub_routes
    from src.draft_hub.ws_manager import DraftRoomManager
    monkeypatch.setattr(hub_routes, "draft_room_manager", DraftRoomManager())
    monkeypatch.setattr(hub_routes, "get_room_state", lambda *args: pytest.fail("Built state for an empty room"))
    asyncio.run(hub_routes.broadcast_room("empty-room"))


def _practice_room(sub):
    league = _league(sub, test_mode=True, team_count=2)
    test_draft.setup_test_draft(league["id"], sub, bot_count=1)
    draft_state.start_draft(league["id"], sub)
    return league


def test_unwatched_practice_room_pauses_and_resumes_where_it_left_off(hub_db):
    league = _practice_room("clock-idle-practice")
    deadline = storage.get_draft_session(league["id"])["nomination_deadline"]
    assert draft_state.tick_expired_drafts(watched=set()) == [league["id"]]
    session = storage.get_draft_session(league["id"])
    assert session["paused"] and session["nomination_deadline"] == deadline
    assert storage.list_in_progress_draft_league_ids() == []
    # A later unwatched tick has nothing to advance.
    assert draft_state.tick_expired_drafts(watched=set()) == []

    paused_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    storage.update_draft_session(league["id"], paused_at=paused_at.isoformat())
    assert draft_state.resume_idle_practice_room(league["id"]) is True
    session = storage.get_draft_session(league["id"])
    assert not session["paused"]
    shifted = draft_state._parse_utc(session["nomination_deadline"]) - draft_state._parse_utc(deadline)
    assert timedelta(minutes=9) < shifted < timedelta(minutes=11)


def test_watched_or_unknown_presence_keeps_practice_room_running(hub_db, monkeypatch):
    monkeypatch.setattr(test_draft, "_pick_nomination_payload", lambda *args: None)
    league = _practice_room("clock-watched-practice")
    storage.update_draft_session(league["id"], nomination_deadline=None)
    draft_state.tick_expired_drafts(watched={league["id"]})
    draft_state.tick_expired_drafts(watched=None)
    assert not storage.get_draft_session(league["id"])["paused"]


def test_real_league_never_idle_pauses(hub_db):
    league = _league("clock-real")
    draft_state.start_draft(league["id"], "clock-real")
    storage.update_draft_session(league["id"], nomination_deadline=None)
    assert draft_state.tick_expired_drafts(watched=set()) == []
    assert not storage.get_draft_session(league["id"])["paused"]


def test_manual_pause_is_not_auto_resumed(hub_db):
    league = _practice_room("clock-manual-pause")
    draft_state.pause_draft(league["id"], "clock-manual-pause")
    assert draft_state.resume_idle_practice_room(league["id"]) is False
    draft_state.check_timers(league["id"], "clock-manual-pause")
    assert storage.get_draft_session(league["id"])["paused"]


def test_opening_room_resumes_idle_pause(hub_db, monkeypatch):
    monkeypatch.setattr(test_draft, "_pick_nomination_payload", lambda *args: None)
    league = _practice_room("clock-return")
    draft_state.tick_expired_drafts(watched=set())
    state = draft_state.check_timers(league["id"], "clock-return")
    assert not storage.get_draft_session(league["id"])["paused"]
    assert not state["session"].get("paused")


def test_presence_is_unknown_until_startup_grace_passes(monkeypatch):
    from src.draft_hub import ws_manager
    clock = [1000.0]
    monkeypatch.setattr(ws_manager.time, "monotonic", lambda: clock[0])
    manager = ws_manager.DraftRoomManager()
    assert manager.watched_league_ids(300) is None
    manager.touch("recent")
    clock[0] += 301
    assert manager.watched_league_ids(300) == set()
    manager.touch("recent")
    clock[0] += 10
    assert manager.watched_league_ids(300) == {"recent"}


def test_idle_clock_slows_down(monkeypatch):
    from app import draft_ticker
    from src.draft_hub.ws_manager import draft_room_manager
    monkeypatch.setattr(draft_ticker, "_ticker_disabled", lambda: False)
    monkeypatch.setattr(draft_ticker, "_TICK_SEC", 0)
    monkeypatch.setattr(draft_ticker, "_IDLE_TICK_SEC", 0.25)
    monkeypatch.setattr(storage, "list_in_progress_draft_league_ids", lambda: [])
    ticks = []
    monkeypatch.setattr(draft_state, "tick_expired_drafts", lambda watched=None: ticks.append(watched) or [])
    monkeypatch.setattr(draft_room_manager, "watched_league_ids", lambda grace: None)
    async def scenario():
        ticker = asyncio.create_task(draft_ticker.draft_ticker_loop())
        await asyncio.sleep(0.1)
        ticker.cancel()
        with pytest.raises(asyncio.CancelledError):
            await ticker
    asyncio.run(scenario())
    assert ticks == [None]


def test_slow_clock_does_not_block_event_loop(monkeypatch):
    from app import draft_ticker, hub_routes
    monkeypatch.setattr(draft_ticker, "_ticker_disabled", lambda: False)
    monkeypatch.setattr(draft_ticker, "_TICK_SEC", 0)
    started = threading.Event()
    release = threading.Event()
    broadcasts = []
    def slow_tick(watched=None):
        started.set()
        assert release.wait(3), "Event loop could not release the clock worker"
        return ["changed-league"]
    async def broadcast(league_id):
        broadcasts.append(league_id)
    monkeypatch.setattr(draft_state, "tick_expired_drafts", slow_tick)
    monkeypatch.setattr(hub_routes, "broadcast_room", broadcast)
    async def scenario():
        ticker = asyncio.create_task(draft_ticker.draft_ticker_loop())
        try:
            assert await asyncio.to_thread(started.wait, 1)
            # This coroutine runs while the synchronous worker is waiting.
            release.set()
            for _ in range(100):
                if broadcasts:
                    break
                await asyncio.sleep(.001)
            assert broadcasts == ["changed-league"]
        finally:
            release.set()
            ticker.cancel()
            with pytest.raises(asyncio.CancelledError):
                await ticker
    asyncio.run(scenario())
