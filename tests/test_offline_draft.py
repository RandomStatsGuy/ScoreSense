"""Offline draft: no clocks, owner entry, CSV round-trip."""

from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.acquisition_window import ADD_LOCKED, resolve_acquisition_window
from src.draft_hub.draft_state import check_timers, start_draft
from src.draft_hub.league_home import PHASE_PRE_DRAFT, resolve_league_phase
from src.draft_hub.offline_draft import (
    apply_draft_results_csv,
    export_draft_results_csv,
    parse_draft_results_csv,
    parse_salary_amount,
    preview_draft_results_csv,
    record_draft_result,
    set_owner_entry,
)
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _player(pid: str = "off-rb", name: str = "Offline RB") -> dict:
    return {
        "player_id": pid,
        "player": name,
        "player_name": name,
        "team": "NE",
        "position": "RB",
        "fair_value": 12,
        "season_proj": 140,
        "is_rookie": False,
    }


def _patch_pool(monkeypatch, players: list[dict]) -> None:
    monkeypatch.setattr(
        "src.draft_hub.draft_pool.build_nomination_pool",
        lambda **kwargs: {
            "rows": players,
            "count": len(players),
            "drafted_count": 0,
            "hub_available_count": 0,
            "pool_mode": "full",
        },
    )


def test_offline_start_skips_timers(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("off-comm", "Offline", 2026, rules, team_count=10)
    _patch_pool(monkeypatch, [_player()])
    state = start_draft(league["id"], "off-comm", conduct="offline")
    session = state["session"]
    assert session["conduct"] == "offline"
    assert session["status"] == "nominating"
    assert session.get("nomination_deadline") in (None, "")
    storage.update_draft_session(
        league["id"],
        nomination_deadline=(datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat(),
    )
    after = check_timers(league["id"], "off-comm")
    assert after["session"]["status"] == "nominating"
    assert after["session"].get("current_nominee") is None
    assert league["id"] not in storage.list_in_progress_draft_league_ids()


def test_commissioner_records_auction_win(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("rec-comm", "Record", 2026, rules, team_count=8)
    team = storage.get_team_by_user(league["id"], "rec-comm")
    _patch_pool(monkeypatch, [_player("rec-1", "Record One")])
    state = record_draft_result(
        league["id"],
        "rec-comm",
        player_id="rec-1",
        team_id=team["id"],
        salary=18,
    )
    wins = [e for e in state["events"] if e.get("event_type") == "win"]
    assert len(wins) == 1
    assert wins[0]["payload"]["amount"] == 18
    roster = storage.list_team_roster(league["id"], team["id"])
    assert roster[0]["player_id"] == "rec-1"
    assert roster[0]["source"] == "draft"
    assert float(roster[0]["salary"]) == 18


def test_owner_entry_own_team_only(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("own-comm", "Owners", 2026, rules, team_count=8)
    owner = storage.join_league("own-mgr", league["room_code"], "Owner")
    other = storage.join_league("own-other", league["room_code"], "Other")
    _patch_pool(monkeypatch, [_player("own-1"), _player("own-2", "Second")])

    with pytest.raises(ValueError, match="Commissioner managed"):
        record_draft_result(
            league["id"],
            "own-mgr",
            player_id="own-1",
            team_id=owner["id"],
            salary=10,
        )

    set_owner_entry(league["id"], "own-comm", open_entry=True)
    record_draft_result(
        league["id"],
        "own-mgr",
        player_id="own-1",
        team_id=owner["id"],
        salary=10,
    )
    with pytest.raises(ValueError, match="own team"):
        record_draft_result(
            league["id"],
            "own-mgr",
            player_id="own-2",
            team_id=other["id"],
            salary=8,
        )
    session = storage.get_draft_session(league["id"])
    assert session["status"] == "setup"
    assert session["owner_entry_open"] is True
    league_row = storage.get_league(league["id"])
    assert league_row["status"] == "setup"


def test_owner_entry_does_not_unlock_players_add():
    window = resolve_acquisition_window({
        "mode": "league",
        "draft_completed": False,
        "league_status": "setup",
        "draft_session_status": "setup",
        "owner_entry_open": True,
        "season": 2026,
    })
    assert window["add_mode"] == ADD_LOCKED
    assert window["can_instant_add"] is False
    assert window["can_record_draft_result"] is True
    assert "Free agents Add stays locked" in window["message"]


def test_csv_preview_and_apply(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("csv-comm", "CSV", 2026, rules, team_count=8)
    team = storage.get_team_by_user(league["id"], "csv-comm")
    _patch_pool(monkeypatch, [_player("csv-1", "Csv Back"), _player("csv-2", "Csv Catch")])
    text = (
        "pick,player_id,name,pos,nfl_team,owner,team_id,salary\n"
        f"1,csv-1,Csv Back,RB,NE,Commissioner,{team['id']},22\n"
        "2,,Nobody,WR,KC,Missing,,5\n"
    )
    preview = preview_draft_results_csv(league["id"], text)
    assert preview["ready_count"] == 1
    assert preview["error_count"] == 1
    applied = apply_draft_results_csv(league["id"], "csv-comm", text)
    assert applied["applied"] == 1
    csv_out = export_draft_results_csv(league["id"])
    assert "csv-1" in csv_out
    assert "22" in csv_out


def test_offline_and_record_endpoints(hub_db, monkeypatch):
    rules = LeagueRules()
    league = storage.create_league("api-comm", "API Offline", 2026, rules, team_count=8)
    team = storage.get_team_by_user(league["id"], "api-comm")
    storage.join_league("api-mgr", league["room_code"], "Manager")
    _patch_pool(monkeypatch, [_player("api-1", "Api One")])

    def _client(sub: str) -> TestClient:
        app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
        return TestClient(app)

    client = _client("api-comm")
    try:
        start = client.post(f"/api/hub/league/{league['id']}/start?conduct=offline")
        assert start.status_code == 200, start.text
        assert start.json()["session"]["conduct"] == "offline"

        rec = client.post(
            f"/api/hub/league/{league['id']}/draft/record",
            json={"player_id": "api-1", "team_id": team["id"], "salary": 11},
        )
        assert rec.status_code == 200, rec.text
        assert any(e.get("event_type") == "win" for e in rec.json()["events"])

        export = client.get(f"/api/hub/league/{league['id']}/draft/results.csv")
        assert export.status_code == 200
        assert "api-1" in export.text

        opened = client.post(
            f"/api/hub/league/{league['id']}/draft/owner-entry",
            json={"open": True},
        )
        assert opened.status_code == 200
        assert opened.json()["session"]["owner_entry_open"] is True
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

    other = _client("api-mgr")
    try:
        blocked = other.post(
            f"/api/hub/league/{league['id']}/draft/results/preview",
            json={"csv_text": "pick,player_id,name\n1,x,Y\n"},
        )
        assert blocked.status_code == 403
        assert "commissioner" in blocked.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_owner_entry_keeps_home_pre_draft(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("phase-comm", "Phase", 2026, rules, team_count=8)
    set_owner_entry(league["id"], "phase-comm", open_entry=True)
    session = storage.get_draft_session(league["id"])
    league_row = storage.get_league(league["id"])
    phase = resolve_league_phase(
        draft_completed=False,
        league_status=league_row["status"],
        draft_session_status=session["status"],
        nfl_season_type="off",
    )
    assert phase["id"] == PHASE_PRE_DRAFT
    assert session["status"] == "setup"
    assert league_row["status"] == "setup"


def test_offline_start_ignores_future_schedule(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("sched-comm", "Later", 2026, rules, team_count=8)
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    storage.update_league_settings(league["id"], draft_starts_at=future)
    _patch_pool(monkeypatch, [_player()])
    state = start_draft(league["id"], "sched-comm", conduct="offline")
    assert state["session"]["conduct"] == "offline"
    assert state["session"]["status"] == "nominating"


def test_malformed_csv_is_a_value_error():
    old = csv.field_size_limit()
    csv.field_size_limit(12)
    try:
        with pytest.raises(ValueError, match="quotes and commas"):
            parse_draft_results_csv("pick,player_id,name\n1,x," + ("Z" * 40) + "\n")
    finally:
        csv.field_size_limit(old)


def test_csv_preview_flags_salary_and_budget(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("sal-comm", "Salary", 2026, rules, team_count=8)
    team = storage.get_team_by_user(league["id"], "sal-comm")
    _patch_pool(monkeypatch, [_player("sal-1", "Sal One"), _player("sal-2", "Sal Two")])
    bad = (
        "pick,player_id,name,pos,nfl_team,owner,team_id,salary\n"
        f"1,sal-1,Sal One,RB,NE,Commissioner,{team['id']},abc\n"
        f"2,sal-2,Sal Two,RB,NE,Commissioner,{team['id']},9999\n"
    )
    preview = preview_draft_results_csv(league["id"], bad)
    assert preview["ready_count"] == 0
    assert preview["error_count"] == 2
    messages = " ".join(row["error"] for row in preview["errors"])
    assert "dollar amount" in messages
    assert "leftover" in messages


def test_record_requires_a_position(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("pos-comm", "Pos", 2026, rules, team_count=8)
    team = storage.get_team_by_user(league["id"], "pos-comm")
    _patch_pool(monkeypatch, [_player("pos-1", "No Pos") | {"position": ""}])
    with pytest.raises(ValueError, match="position"):
        record_draft_result(
            league["id"],
            "pos-comm",
            player_id="pos-1",
            team_id=team["id"],
            salary=5,
        )


def test_parse_salary_amount_rejects_nan():
    assert parse_salary_amount("") is None
    assert parse_salary_amount("$12") == 12.0
    with pytest.raises(ValueError, match="dollar amount"):
        parse_salary_amount("abc")
    with pytest.raises(ValueError, match="dollar amount"):
        parse_salary_amount(float("nan"))


def test_commissioner_records_pick_draft(hub_db, monkeypatch):
    rules = load_preset("snake_draft_v1")
    league = storage.create_league("pick-comm", "Picks", 2026, rules, team_count=8)
    team = storage.get_team_by_user(league["id"], "pick-comm")
    _patch_pool(monkeypatch, [_player("pick-1", "Pick One")])
    state = record_draft_result(
        league["id"],
        "pick-comm",
        player_id="pick-1",
        team_id=team["id"],
        salary=99,
    )
    picks = [e for e in state["events"] if e.get("event_type") == "pick"]
    assert len(picks) == 1
    roster = storage.list_team_roster(league["id"], team["id"])
    assert roster[0]["player_id"] == "pick-1"
    assert float(roster[0]["salary"]) == 0
