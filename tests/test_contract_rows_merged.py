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


def test_manual_active_overrides_file_cut(hub_db):
    """Post-draft sheet edits: Active + Auction should beat an imported CUT line."""
    merged = merge_owner_roster(
        "league",
        season_year=2025,
        owner_label="Caleb K",
        file_rows=[
            {
                "owner_label": "Caleb K",
                "player_name": "K. Pitts",
                "position": "TE",
                "cap_hit": 15.0,
                "roster_status": "cut",
                "status_note": "CUT",
            }
        ],
        db_rows=[
            {
                "id": 99,
                "owner_label": "Caleb K",
                "player_name": "K. Pitts",
                "position": "TE",
                "cap_hit": 8.0,
                "base_salary": 8.0,
                "prior_salary": 15.0,
                "roster_status": "active",
                "source_kind": "manual",
                "acquisition_type": "draft",
                "status_note": "",
            }
        ],
        alias_map={},
        sheet_format=True,
    )
    assert len(merged) == 1
    assert merged[0]["roster_status"] == "active"
    assert float(merged[0]["cap_hit"]) == 8.0
    assert merged[0]["acquisition_type"] == "draft"


def test_active_manual_preferred_over_cut_manual():
    """When both cut and active overlays exist, prefer active (re-draft over drop line)."""
    from src.draft_hub.contract_rows_merged import _match_db_row

    file_row = {
        "owner_label": "Caleb K",
        "player_name": "K. Pitts",
        "roster_status": "cut",
    }
    chosen = _match_db_row(
        [
            {
                "id": 1,
                "owner_label": "Caleb K",
                "player_name": "K. Pitts",
                "roster_status": "cut",
                "source_kind": "manual",
                "cap_hit": 7.5,
            },
            {
                "id": 2,
                "owner_label": "Caleb K",
                "player_name": "K. Pitts",
                "roster_status": "active",
                "source_kind": "manual",
                "cap_hit": 8.0,
                "acquisition_type": "draft",
            },
        ],
        file_row,
        {},
    )
    assert chosen is not None
    assert chosen["id"] == 2
    assert chosen["roster_status"] == "active"


def test_db_only_active_and_cut_collapse_to_one():
    """Leftover cut + re-add for a player not on the file must not both hit the cap."""
    merged = merge_owner_roster(
        "league",
        season_year=2025,
        owner_label="Aaron D",
        file_rows=[],
        db_rows=[
            {
                "id": 1,
                "owner_label": "Aaron D",
                "player_name": "K. Herbert",
                "position": "RB",
                "cap_hit": 4.5,
                "prior_salary": 9.0,
                "roster_status": "cut",
                "source_kind": "manual",
            },
            {
                "id": 2,
                "owner_label": "Aaron D",
                "player_name": "K. Herbert",
                "position": "RB",
                "cap_hit": 9.0,
                "prior_salary": 9.0,
                "roster_status": "active",
                "source_kind": "manual",
            },
        ],
        alias_map={},
        sheet_format=True,
    )
    assert len(merged) == 1
    assert merged[0]["roster_status"] == "active"
    assert float(merged[0]["cap_hit"]) == 9.0


def test_abbreviated_name_same_salary_not_double_counted():
    """Bijan on file + manual 'B. Robinson' at same $ must not stack."""
    merged = merge_owner_roster(
        "league",
        season_year=2025,
        owner_label="Andrew M",
        file_rows=[
            {
                "owner_label": "Andrew M",
                "player_name": "Bijan Robinson",
                "position": "RB",
                "cap_hit": 37.0,
                "roster_status": "active",
            }
        ],
        db_rows=[
            {
                "id": 99,
                "owner_label": "Andrew M",
                "player_name": "B. Robinson",
                "position": "RB",
                "cap_hit": 37.0,
                "roster_status": "active",
                "source_kind": "manual",
            }
        ],
        alias_map={},
        sheet_format=True,
    )
    assert len(merged) == 1
    assert "Bijan" in str(merged[0].get("player_name") or "")
    assert float(merged[0]["cap_hit"]) == 37.0


def test_duplicate_db_only_actives_collapse():
    merged = merge_owner_roster(
        "league",
        season_year=2025,
        owner_label="Aaron D",
        file_rows=[],
        db_rows=[
            {
                "id": 1,
                "owner_label": "Aaron D",
                "player_name": "J. Mason",
                "position": "RB",
                "cap_hit": 5.0,
                "roster_status": "active",
                "source_kind": "manual",
            },
            {
                "id": 2,
                "owner_label": "Aaron D",
                "player_name": "J. Mason",
                "position": "RB",
                "cap_hit": 5.0,
                "roster_status": "active",
                "source_kind": "manual",
            },
        ],
        alias_map={},
        sheet_format=True,
    )
    assert len(merged) == 1
    assert float(merged[0]["cap_hit"]) == 5.0


def test_penix_week1_and_manual_collapse_by_sleeper_id():
    """Week-1 'M. Penix' + manual 'Penix Jr' alias must become one sheet line."""
    merged = merge_owner_roster(
        "league",
        season_year=2025,
        owner_label="Caleb K",
        file_rows=[
            {
                "owner_label": "Caleb K",
                "player_name": "M. Penix",
                "player_id": "11559",
                "position": "QB",
                "cap_hit": None,
                "roster_status": "active",
                "source_kind": "week1_sleeper",
            }
        ],
        db_rows=[
            {
                "id": 9,
                "owner_label": "Caleb K",
                "player_name": "Penix Jr",
                "position": "QB",
                "cap_hit": 4.0,
                "base_salary": 4.0,
                "roster_status": "active",
                "source_kind": "manual",
                "acquisition_type": "draft",
            }
        ],
        alias_map={"penixjr": "Michael Penix"},
        alias_meta={
            "penixjr": {
                "alias_name": "Penix Jr",
                "canonical_name": "Michael Penix",
                "sleeper_player_id": "11559",
                "position": "QB",
            }
        },
        alias_meta_by_sid={
            "11559": {
                "alias_name": "Penix Jr",
                "canonical_name": "Michael Penix",
                "sleeper_player_id": "11559",
                "position": "QB",
            }
        },
        sheet_format=True,
    )
    assert len(merged) == 1
    assert float(merged[0]["cap_hit"]) == 4.0
    assert merged[0]["sleeper_player_id"] == "11559"
    assert merged[0].get("name_mapped") is True


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
