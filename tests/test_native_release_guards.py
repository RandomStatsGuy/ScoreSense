"""Release eligibility and external-host safety use an isolated league database."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import fa_market, native_score_refresh as worker, priority_waivers as waivers, storage
from src.draft_hub.schemas import LeagueRules


def league(name, *, test_mode=False, status="setup", draft_type="auction"):
    created = storage.create_league(name, name, 2026, LeagueRules(draft_type=draft_type),
                                    team_count=1, test_mode=test_mode)
    storage.update_league_settings(created["id"], draft_completed=True)
    storage.update_league_status(created["id"], status)
    return storage.get_league(created["id"]), storage.get_team_by_user(created["id"], name)


@pytest.mark.parametrize("kind", ["practice", "archived", "deleted"])
def test_durable_queue_excludes_ineligible_current_and_retained_periods(hub_db, monkeypatch, kind):
    inactive, _ = league(kind, test_mode=kind == "practice", status=kind if kind != "practice" else "completed")
    active, _ = league("active", status="completed")
    # Retained error snapshots also feed the queue; neither source can revive an inactive league.
    storage.save_native_live_week(inactive["id"], 2026, 1, {"status": "error"})
    storage.save_native_week_scores(inactive["id"],2026,1,[],[],inactive["rules"]["scoring"],final=False)
    monkeypatch.setattr("src.draft_hub.league_live_scoring.resolve_current_week",lambda:(1,{"season":2026,"season_type":"regular"}))
    monkeypatch.setattr("src.draft_hub.game_center.cached_game_states",lambda *args:{})
    monkeypatch.setattr("src.draft_hub.native_stats.cached_week_snapshot",lambda *args:None)
    worker.queue_current_native_weeks()
    assert worker.refresh_status(inactive["id"],2026,1) is None
    assert worker.refresh_status(active["id"],2026,1)["status"] == "pending"


@pytest.mark.parametrize("kind", ["practice", "archived", "deleted"])
def test_preexisting_ineligible_job_is_skipped_without_provider_or_scores(hub_db, monkeypatch, kind):
    inactive, _ = league(kind, test_mode=kind == "practice", status=kind if kind != "practice" else "completed")
    worker.request_refresh(inactive["id"],2026,1)
    def forbidden(*args,**kwargs):
        raise AssertionError("Ineligible leagues must not load provider data or score")
    monkeypatch.setattr(worker,"get_week_snapshot",forbidden)
    monkeypatch.setattr(worker,"_warm_schedule_cache",forbidden)
    monkeypatch.setattr(worker,"refresh_league_week",forbidden)
    assert worker.refresh_pending_scores() == {"completed":0,"failed":0}
    assert worker.refresh_status(inactive["id"],2026,1)["status"] == "skipped"
    assert storage.get_week_scoring_run(inactive["id"],2026,1) is None
    assert storage.get_native_live_week(inactive["id"],2026,1) is None
    assert storage.list_week_lineups(inactive["id"],2026,1) == []


@pytest.mark.parametrize("draft_type", ["auction", "snake"])
def test_linked_due_acquisitions_do_not_award_or_close_native_claims(hub_db, trusted_native_catalog, draft_type):
    created, team = league("linked-due", draft_type=draft_type)
    trusted_native_catalog("legacy-open",name="Legacy WR",team="KC",position="WR")
    if draft_type == "auction":
        storage.upsert_fa_bid(league_id=created["id"],team_id=team["id"],player_id="legacy-open",player_name="Legacy WR",
                              nfl_team="KC",position="WR",bid_amount=2,window_id="2026-w1-waiver",user_sub="linked-due")
        before = storage.list_fa_bids(created["id"],status=None)
    else:
        waivers.replace_claims(league_id=created["id"],team_id=team["id"],window_id="2026-w1-waiver",
                              claims=[{"player_id":"legacy-open","player_name":"Legacy WR","team":"KC","position":"WR"}],user_sub="linked-due")
        before = waivers.list_claims(created["id"],"2026-w1-waiver")
    storage.update_league_sleeper_id(created["id"],"official-sleeper")
    assert fa_market.process_due_windows(created["id"],None) is None
    assert waivers.process_due_claim_windows(created["id"],None) is None
    after = (storage.list_fa_bids(created["id"],status=None) if draft_type == "auction"
             else waivers.list_claims(created["id"],"2026-w1-waiver"))
    assert after == before
    assert storage.list_team_roster(created["id"],team["id"]) == []


def test_linked_market_with_legacy_open_bid_stays_empty_and_read_only(hub_db, monkeypatch):
    created, team = league("linked-api")
    storage.upsert_fa_bid(league_id=created["id"],team_id=team["id"],player_id="legacy-open",player_name="Legacy WR",
                          nfl_team="KC",position="WR",bid_amount=2,window_id="2026-w1-waiver",user_sub="linked-api")
    storage.update_league_sleeper_id(created["id"],"official-sleeper")
    before = storage.list_fa_bids(created["id"],status=None)
    ctx={"mode":"league","league_id":created["id"],"team_id":team["id"],"rules":created["rules"],
         "season":2026,"sleeper_league_id":"official-sleeper","is_commissioner":True,
         "acquisition_window":{"id":"sleeper_hosted","add_mode":"none","window_id":None}}
    monkeypatch.setattr("app.hub_routes._ctx",lambda *args:ctx)
    app.dependency_overrides[require_hub_user]=lambda:{"sub":"linked-api","auth_type":"dev"}
    try:
        response=TestClient(app).get("/api/hub/fa-market")
    finally:
        app.dependency_overrides.pop(require_hub_user,None)
    assert response.status_code == 200,response.text
    assert response.json()["market"]["players"] == []
    assert response.json()["market"]["my_bids"] == []
    assert "legacy-open" not in response.text
    assert storage.list_fa_bids(created["id"],status=None) == before
    assert storage.list_team_roster(created["id"],team["id"]) == []


def test_pregame_jobs_seed_lineup_headers_before_missing_provider_stats(hub_db, monkeypatch):
    rules = LeagueRules(draft_type="snake", roster={"qb":{"starter":1,"max":2}})
    created = storage.create_league("pregame-release", "Pregame", 2026, rules,team_count=2)
    storage.join_league("pregame-away",created["room_code"],"Away")
    storage.update_league_settings(created["id"],draft_completed=True)
    teams = storage.list_league_teams(created["id"])
    worker.request_refresh(created["id"],2026,1)
    monkeypatch.setattr("src.draft_hub.hub_scoring._utcnow",lambda:datetime(2026,9,1,tzinfo=timezone.utc))
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_week_started",lambda *args,**kwargs:False)
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_week_slate_complete",lambda *args,**kwargs:False)
    def unavailable(*args,**kwargs):
        raise AssertionError("A verified future slate must not depend on an actual statistics response")
    monkeypatch.setattr(worker,"get_week_snapshot",unavailable)
    assert worker.refresh_pending_scores() == {"completed":0,"failed":0}
    assert worker.refresh_status(created["id"],2026,1)["status"] == "upcoming"
    assert all(storage.has_team_lineup_snapshot(created["id"],team["id"],2026,1) for team in teams)
    assert storage.get_week_scoring_run(created["id"],2026,1) is None
