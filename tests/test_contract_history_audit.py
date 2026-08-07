"""Rules-aware contract history audit."""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.contract_history_audit import apply_audit_patches, audit_contract_history
from src.draft_hub.legacy_contract_history import build_player_contract_journey
from src.draft_hub.schemas import LeagueRules


def _client_for(sub: str) -> TestClient:
    def _user():
        return {"sub": sub, "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    return TestClient(app)


@pytest.fixture()
def commissioner_league(hub_db):
    return storage.create_league("audit-user", "Audit League", 2025, LeagueRules())


def _seed_season(league_id: str, season: int, rows: list[dict]) -> None:
    storage.replace_league_contract_season(league_id, season, rows)


def test_renewal_step_up_mismatch(commissioner_league):
    lid = commissioner_league["id"]
    _seed_season(
        lid,
        2023,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "P Mahomes",
                "position": "QB",
                "cap_hit": 20.0,
                "roster_status": "active",
                "original_draft_year": 2018,
            }
        ],
    )
    _seed_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "P Mahomes",
                "position": "QB",
                "cap_hit": 20.0,
                "roster_status": "active",
                "original_draft_year": 2018,
            }
        ],
    )
    audit = audit_contract_history(lid, season_year=2024)
    codes = {i["code"] for i in audit["issues"]}
    assert "renewal_step_mismatch" in codes
    issue = next(i for i in audit["issues"] if i["code"] == "renewal_step_mismatch")
    assert issue["expected"] == 25.0


def test_rookie_flat_renewal_ok(commissioner_league):
    lid = commissioner_league["id"]
    _seed_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "R Rookie",
                "position": "RB",
                "cap_hit": 10.0,
                "roster_status": "active",
                "original_draft_year": 2024,
            }
        ],
    )
    _seed_season(
        lid,
        2025,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "R Rookie",
                "position": "RB",
                "cap_hit": 10.0,
                "roster_status": "active",
                "original_draft_year": 2024,
            }
        ],
    )
    audit = audit_contract_history(lid, season_year=2025)
    assert "renewal_step_mismatch" not in {i["code"] for i in audit["issues"]}


def test_missing_cut_row(commissioner_league):
    lid = commissioner_league["id"]
    _seed_season(
        lid,
        2023,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "Cut Me",
                "position": "WR",
                "cap_hit": 30.0,
                "roster_status": "active",
            }
        ],
    )
    _seed_season(lid, 2024, [])
    audit = audit_contract_history(lid, season_year=2024)
    issue = next(i for i in audit["issues"] if i["code"] == "missing_cut_row")
    assert issue["expected"]["cap_hit"] == 15.0


def test_dead_cap_wrong(commissioner_league):
    lid = commissioner_league["id"]
    _seed_season(
        lid,
        2023,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "Dead Cap",
                "position": "TE",
                "cap_hit": 20.0,
                "roster_status": "active",
            }
        ],
    )
    _seed_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "Dead Cap",
                "position": "TE",
                "cap_hit": 20.0,
                "roster_status": "cut",
                "prior_salary": 20.0,
            }
        ],
    )
    audit = audit_contract_history(lid, season_year=2024)
    issue = next(i for i in audit["issues"] if i["code"] == "dead_cap_wrong")
    assert issue["expected"] == 10.0


def test_in_season_waiver_not_dollar(commissioner_league):
    lid = commissioner_league["id"]
    _seed_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "Waiver Guy",
                "position": "RB",
                "cap_hit": 1.0,
                "roster_status": "active",
                "acquisition_type": "waiver",
                "contract_phase": "extension",
            }
        ],
    )
    audit = audit_contract_history(lid, season_year=2024)
    assert "in_season_waiver_not_dollar" in {i["code"] for i in audit["issues"]}


def test_post_draft_fa_as_waiver(commissioner_league):
    lid = commissioner_league["id"]
    _seed_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "FA Bid",
                "position": "WR",
                "cap_hit": 12.0,
                "roster_status": "active",
                "acquisition_type": "waiver",
                "contract_phase": "waiver_rental",
            }
        ],
    )
    audit = audit_contract_history(lid, season_year=2024)
    assert "post_draft_fa_as_waiver" in {i["code"] for i in audit["issues"]}


def test_apply_audit_patches(commissioner_league):
    lid = commissioner_league["id"]
    row = storage.insert_league_contract_row(
        lid,
        2024,
        {
            "owner_label": "Aaron D",
            "player_name": "Fix Me",
            "position": "QB",
            "cap_hit": 5.0,
            "roster_status": "active",
        },
    )
    result = apply_audit_patches(
        lid,
        [{"row_id": row["id"], "patch": {"cap_hit": 10.0, "base_salary": 10.0}}],
        edited_by_sub="audit-user",
    )
    assert result["applied"] == 1
    updated = storage.get_league_contract_row(row["id"])
    assert updated["cap_hit"] == 10.0


def test_player_journey(commissioner_league):
    lid = commissioner_league["id"]
    _seed_season(
        lid,
        2023,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "Journey Player",
                "position": "QB",
                "cap_hit": 10.0,
                "roster_status": "active",
            }
        ],
    )
    _seed_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "Journey Player",
                "position": "QB",
                "cap_hit": 5.0,
                "roster_status": "cut",
            }
        ],
    )
    journey = build_player_contract_journey(lid, "Journey Player")
    assert len(journey["seasons"]) == 2
    assert journey["seasons"][0]["season_year"] == 2023


def test_audit_api(commissioner_league):
    lid = commissioner_league["id"]
    _seed_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "API Test",
                "position": "QB",
                "cap_hit": 5.0,
                "roster_status": "active",
                "acquisition_type": "waiver",
            }
        ],
    )
    client = _client_for("audit-user")
    try:
        res = client.get(f"/api/hub/league/{lid}/contract-history/audit?season=2024")
        assert res.status_code == 200
        body = res.json()
        assert "issues" in body
        assert body["season_year"] == 2024
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_process_league_history_waiver_vs_fa():
    df = pd.DataFrame(
        [
            {"season_year": 2024, "cap_hit": 1, "acquisition_type": "unknown", "player_name": "W"},
            {"season_year": 2024, "cap_hit": 15, "acquisition_type": "unknown", "player_name": "F"},
        ]
    )
    waiver_mask = df["cap_hit"] == 1
    df.loc[waiver_mask, "acquisition_type"] = "waiver"
    fa_mask = (~waiver_mask) & (df["cap_hit"] > 1) & (df["acquisition_type"] == "unknown")
    df.loc[fa_mask, "acquisition_type"] = "post_draft_fa"
    assert df.loc[0, "acquisition_type"] == "waiver"
    assert df.loc[1, "acquisition_type"] == "post_draft_fa"
