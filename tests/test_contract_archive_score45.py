"""SCORE-45: archive expired contracts + unified contract service writes."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import app
from src.draft_hub import storage
from src.draft_hub.contract_service import (
    ARCHIVE_REASON_TICK,
    is_archived_expired,
    list_archived_contracts,
    restore_from_archive,
    rewind_contracts_on_draft_reset,
    tick_contracts_on_draft_complete,
)
from src.draft_hub.draft_state import end_draft, reset_live_draft, start_draft
from src.draft_hub.pre_draft_cap import ROSTER_EXPIRED, is_active_for_pre_draft
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _live_league(sub: str = "archive-commish"):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace(sub)
    return storage.create_league(
        sub,
        "Archive League",
        2026,
        rules,
        workspace_id=ws["id"],
    )


def _add_expiring_vet(league, team_id, ws, pid="expiring-vet"):
    storage.add_roster_slot(
        ws,
        {
            "player_id": pid,
            "player_name": "Expiring Vet",
            "team": "CHI",
            "position": "WR",
            "salary": 20,
            "contract_years": 1,
            "source": "sheet",
            "contract": {
                "contract_type": "veteran",
                "years_remaining": 1,
                "current_salary": 20,
                "schedule": [{"year_offset": 0, "salary": 20}],
            },
        },
        team_id=team_id,
    )


def test_tick_archives_instead_of_deleting(hub_db):
    league = _live_league()
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    ws = storage.roster_workspace_for_league(league)
    _add_expiring_vet(league, team["id"], ws)

    summary = tick_contracts_on_draft_complete(league["id"])
    assert summary["expired"] == 1
    assert summary["archived"] == 1
    assert summary.get("archive_mode") is True

    row = storage.get_roster_slot(ws, "expiring-vet")
    assert row is not None
    assert row["roster_status"] == ROSTER_EXPIRED
    assert int(row["contract_years"]) == 0
    assert is_archived_expired(row)
    archive = row["contract"]["archive"]
    assert archive["reason"] == ARCHIVE_REASON_TICK
    assert archive["as_of"]
    assert archive["snapshot"]["contract"]["years_remaining"] == 1
    assert not is_active_for_pre_draft(row)


def test_reset_restores_from_archive_without_snapshot(hub_db):
    """Lossless reset via archived rows when league snapshot was cleared."""
    league = _live_league("archive-reset")
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    ws = storage.roster_workspace_for_league(league)
    _add_expiring_vet(league, team["id"], ws, pid="arch-1")

    tick_contracts_on_draft_complete(league["id"])
    storage.clear_draft_contract_snapshot(league["id"])

    result = rewind_contracts_on_draft_reset(league["id"])
    assert result["lossless"] is True
    assert result["via"] == "archive"
    assert result["restored"] == 1

    restored = storage.get_roster_slot(ws, "arch-1")
    assert restored["roster_status"] == "active"
    assert int(restored["contract"]["years_remaining"]) == 1
    assert "archive" not in (restored.get("contract") or {})


def test_end_draft_archives_and_reset_restores(hub_db):
    league = _live_league("end-archive")
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    ws = storage.roster_workspace_for_league(league)
    _add_expiring_vet(league, team["id"], ws, pid="end-vet")
    storage.add_roster_slot(
        ws,
        {
            "player_id": "auction-win",
            "player_name": "Auction Win",
            "team": "BUF",
            "position": "RB",
            "salary": 35,
            "contract_years": 1,
            "source": "draft",
            "contract": {
                "contract_type": "veteran",
                "years_remaining": 1,
                "current_salary": 35,
                "schedule": [{"year_offset": 0, "salary": 35}],
            },
        },
        team_id=team["id"],
    )
    start_draft(league["id"], "end-archive")
    end_draft(league["id"], "end-archive")

    after = {r["player_id"]: r for r in storage.list_league_rosters_by_team(league["id"])[team["id"]]}
    assert "end-vet" in after
    assert after["end-vet"]["roster_status"] == ROSTER_EXPIRED
    assert "auction-win" in after
    assert after["auction-win"]["roster_status"] == "active"

    archived = list_archived_contracts(league["id"])
    assert len(archived) == 1
    assert archived[0]["player_id"] == "end-vet"
    assert archived[0]["as_of"]
    assert archived[0]["snapshot"]

    result = reset_live_draft(league["id"], "end-archive")
    assert result["year_rewind"]["lossless"] is True
    restored = {r["player_id"]: r for r in storage.list_league_rosters_by_team(league["id"])[team["id"]]}
    assert restored["end-vet"]["roster_status"] == "active"
    assert int(restored["end-vet"]["contract"]["years_remaining"]) == 1
    assert "auction-win" not in restored


def test_restore_from_archive_helper(hub_db):
    league = _live_league("helper")
    teams = storage.list_league_teams(league["id"])
    ws = storage.roster_workspace_for_league(league)
    _add_expiring_vet(league, teams[0]["id"], ws, pid="helper-vet")
    tick_contracts_on_draft_complete(league["id"])
    row = storage.get_roster_slot(ws, "helper-vet")
    payload = restore_from_archive(row)
    assert payload["roster_status"] == "active"
    assert int(payload["contract_years"]) == 1
    assert payload["contract"]["years_remaining"] == 1


def test_archived_contracts_endpoint(hub_db):
    from app.auth import require_hub_user

    league = _live_league("api-arch")
    teams = storage.list_league_teams(league["id"])
    ws = storage.roster_workspace_for_league(league)
    _add_expiring_vet(league, teams[0]["id"], ws, pid="api-vet")
    tick_contracts_on_draft_complete(league["id"])

    app.dependency_overrides[require_hub_user] = lambda: {"sub": "api-arch", "auth_type": "dev"}
    try:
        client = TestClient(app)
        resp = client.get(f"/api/hub/league/{league['id']}/contracts/archived")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["count"] == 1
        assert body["items"][0]["player_id"] == "api-vet"
        assert body["items"][0]["roster_status"] == ROSTER_EXPIRED
        assert body["items"][0]["snapshot"]["contract"]["years_remaining"] == 1
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_season_change_still_does_not_mutate_years(hub_db):
    """Regression: advancing season must not touch archived or active years."""
    from src.draft_hub.schemas import LeagueRules

    league = storage.create_league(
        commissioner_sub="season-45",
        name="Season 45",
        season=2025,
        rules=LeagueRules(),
    )
    lid = str(league["id"])
    storage.update_league_settings(lid, draft_completed=True)
    ws_id = storage.roster_workspace_for_league(storage.get_league(lid))
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-keep",
            "player_name": "Keep Years",
            "team": "NE",
            "position": "RB",
            "salary": 10,
            "contract_years": 1,
            "contract": {
                "contract_type": "rookie",
                "years_remaining": 1,
                "current_salary": 10,
                "schedule": [{"year_offset": 0, "salary": 10}],
            },
        },
    )
    updated = storage.update_league_season(lid, 2026)
    assert updated["season"] == 2026
    assert updated["draft_completed"] is False
    row = storage.get_roster_slot(ws_id, "00-keep")
    assert int(row["contract"]["years_remaining"]) == 1
