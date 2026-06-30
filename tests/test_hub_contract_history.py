"""Hub contract history commissioner CRUD."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules


def _client_for(sub: str) -> TestClient:
    def _user():
        return {"sub": sub, "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    return TestClient(app)


def _seed_contract_row(league_id: str, *, source_kind: str = "import", player_name: str = "Test Player") -> dict:
    storage.replace_league_contract_season(
        league_id,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Team A",
                "player_name": player_name,
                "position": "QB",
                "cap_hit": 10.0,
                "roster_status": "active",
                "source_kind": source_kind,
            }
        ],
    )
    rows = storage.list_league_contract_rows(league_id, season_year=2024)
    return rows[0]


@pytest.fixture()
def commissioner_league(hub_db):
    league = storage.create_league("comm-hist", "History League", 2025, LeagueRules())
    return league


def test_patch_contract_row_updates_and_audits(commissioner_league):
    lid = commissioner_league["id"]
    row = _seed_contract_row(lid)
    client = _client_for("comm-hist")
    try:
        res = client.patch(
            f"/api/hub/league/{lid}/contract-history/{row['id']}",
            json={"cap_hit": 15.0, "note": "fix typo"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["cap_hit"] == 15.0
        assert body["source_kind"] == "manual"
        with storage.get_conn() as conn:
            edits = conn.execute(
                "SELECT field_name, new_value FROM league_contract_row_edit WHERE row_id = ?",
                (row["id"],),
            ).fetchall()
        assert any(e["field_name"] == "cap_hit" and e["new_value"] == "15.0" for e in edits)
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_post_contract_row_create(commissioner_league):
    lid = commissioner_league["id"]
    client = _client_for("comm-hist")
    try:
        res = client.post(
            f"/api/hub/league/{lid}/contract-history",
            json={
                "season_year": 2024,
                "owner_label": "Caleb K",
                "player_name": "Manual Add",
                "cap_hit": 7.0,
                "position": "RB",
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["player_name"] == "Manual Add"
        assert body["source_kind"] == "manual"
        assert body["cap_hit"] == 7.0
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_reimport_preserves_manual_rows(commissioner_league):
    lid = commissioner_league["id"]
    _seed_contract_row(lid, source_kind="import", player_name="Imported QB")
    manual = storage.insert_league_contract_row(
        lid,
        2024,
        {
            "owner_label": "Aaron D",
            "player_name": "Manual Keeper",
            "position": "WR",
            "cap_hit": 5.0,
            "roster_status": "active",
        },
    )
    storage.replace_league_contract_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Team A",
                "player_name": "New Import",
                "position": "QB",
                "cap_hit": 12.0,
                "roster_status": "active",
                "source_kind": "import",
            }
        ],
    )
    rows = storage.list_league_contract_rows(lid, season_year=2024)
    names = {r["player_name"] for r in rows}
    assert "Manual Keeper" in names
    assert manual["id"] in {r["id"] for r in rows}
    assert "New Import" in names
    assert "Imported QB" not in names
