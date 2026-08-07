"""Tests for unified contract row merge layer."""

from __future__ import annotations

from src.draft_hub import storage
from src.draft_hub.contract_rows_merged import (
    active_merged_contract_rows,
    build_merged_contract_rows,
    merge_owner_roster,
)
from src.draft_hub.schemas import LeagueRules


def test_merge_manual_salary_over_file(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {
            2025: [
                {
                    "owner_label": "Caleb K",
                    "player_name": "Player A",
                    "position": "QB",
                    "cap_hit": 10.0,
                    "base_salary": 10.0,
                    "roster_status": "active",
                    "season_year": 2025,
                }
            ]
        },
    )
    league = storage.create_league("merge-test", "Merge", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Caleb K",
                "player_name": "Player A",
                "position": "QB",
                "cap_hit": 10.0,
                "roster_status": "active",
                "source_kind": "import",
            }
        ],
    )
    row_id = storage.list_league_contract_rows(lid, season_year=2025)[0]["id"]
    storage.update_league_contract_row(
        int(row_id),
        {"cap_hit": 15.0, "base_salary": 15.0},
        edited_by_sub="test",
    )

    rows = build_merged_contract_rows(lid, season_year=2025, sheet_format=True)["rows_by_season"][2025]
    caleb = [r for r in rows if r.get("owner_label") == "Caleb K"]
    assert len(caleb) == 1
    assert float(caleb[0]["cap_hit"]) == 15.0


def test_db_cut_overlays_file(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {
            2025: [
                {
                    "owner_label": "Caleb K",
                    "player_name": "Player A",
                    "position": "QB",
                    "cap_hit": 10.0,
                    "roster_status": "active",
                    "season_year": 2025,
                }
            ]
        },
    )
    league = storage.create_league("cut-test", "Cut", 2025, LeagueRules())
    lid = league["id"]
    storage.insert_league_contract_row(
        lid,
        2025,
        {
            "owner_label": "Caleb K",
            "player_name": "Player A",
            "position": "QB",
            "cap_hit": 5.0,
            "roster_status": "cut",
            "source_kind": "manual",
        },
    )

    merged = merge_owner_roster(
        lid,
        season_year=2025,
        owner_label="Caleb K",
        file_rows=[
            {
                "owner_label": "Caleb K",
                "player_name": "Player A",
                "position": "QB",
                "cap_hit": 10.0,
                "roster_status": "active",
            }
        ],
        db_rows=storage.list_league_contract_rows(lid, season_year=2025),
        alias_map={},
        sheet_format=True,
    )
    assert merged[0]["roster_status"] == "cut"


def test_active_merged_from_database(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    league = storage.create_league("db-merge", "DB", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Owner",
                "player_name": "Star QB",
                "position": "QB",
                "cap_hit": 20.0,
                "roster_status": "active",
            }
        ],
    )
    active = active_merged_contract_rows(lid, 2025)
    assert len(active) == 1
    assert active[0]["player_name"] == "Star QB"
