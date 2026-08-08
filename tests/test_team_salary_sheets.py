"""Tests for team salary sheet payload."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.team_salary_sheets import build_team_salary_sheets_payload, _team_totals


@pytest.fixture
def salary_league(hub_db):
    league = storage.create_league("test-sub", "Salary Sheets Test", 2025, LeagueRules())
    league_id = league["id"]
    rows_2024 = [
        {
            "owner_label": "Caleb K",
            "player_name": "Player A",
            "position": "QB",
            "prior_salary": 3,
            "cap_hit": 8,
            "base_salary": 8,
            "roster_status": "active",
            "contract_phase": "extension",
        },
        {
            "owner_label": "Chris G",
            "player_name": "Player B",
            "position": "RB",
            "prior_salary": 5,
            "cap_hit": 5,
            "base_salary": 5,
            "roster_status": "active",
        },
    ]
    rows_2025 = [
        {
            "owner_label": "Caleb K",
            "player_name": "Player A",
            "position": "QB",
            "prior_salary": 8,
            "cap_hit": 13,
            "base_salary": 13,
            "roster_status": "active",
        },
        {
            "owner_label": "Chris G",
            "player_name": "Player C",
            "position": "WR",
            "prior_salary": None,
            "cap_hit": 12,
            "base_salary": 12,
            "roster_status": "active",
            "acquisition_type": "draft",
        },
    ]
    storage.replace_league_contract_season(league_id, 2024, rows_2024)
    storage.replace_league_contract_season(league_id, 2025, rows_2025)
    return league_id


def test_team_totals_skips_summary_rows():
    rows = [
        {"player_name": "Player A", "position": "QB", "cap_hit": 10, "roster_status": "active"},
        {"player_name": "TOTAL SALARY", "position": "NAN", "cap_hit": 214, "roster_status": "active"},
        {"player_name": "Salary Available", "position": "NAN", "cap_hit": 36, "roster_status": "active"},
    ]
    totals = _team_totals(rows, salary_cap=200)
    assert totals["committed"] == 10
    assert totals["unspent"] == 190


def test_team_salary_sheets_from_database(salary_league, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    payload = build_team_salary_sheets_payload(salary_league, season_year=2025)
    assert payload["available"] is True
    assert payload["data_source"] == "database"
    assert payload["season_year"] == 2025
    assert payload["prior_season"] == 2024
    assert len(payload["summary_matrix"]) == 2
    assert len(payload["team_sheets"]) == 2

    caleb = next(s for s in payload["team_sheets"] if s["owner_label"] == "Caleb K")
    assert caleb["rows"][0]["player_name"] == "Player A"
    assert caleb["rows"][0]["prior_salary"] == 8
    assert caleb["rows"][0]["cap_hit"] == 13
    assert caleb["totals"]["committed"] == 13


def test_season_salary_cap_overrides_unspent(salary_league, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    storage.upsert_season_salary_cap(salary_league, 2025, 100)
    payload = build_team_salary_sheets_payload(salary_league, season_year=2025)
    caleb = next(s for s in payload["team_sheets"] if s["owner_label"] == "Caleb K")
    assert payload["salary_cap"] == 100
    assert payload["salary_caps_by_season"]["2025"] == 100
    assert caleb["totals"]["unspent"] == 87
    assert payload["summary_matrix"][0]["seasons"]["2025"]["unspent"] == pytest.approx(
        100 - payload["summary_matrix"][0]["seasons"]["2025"]["against_cap"]
    )


def test_team_totals_spent_includes_dead_cap():
    rows = [
        {"player_name": "Active", "cap_hit": 100, "roster_status": "active"},
        {"player_name": "Cut", "cap_hit": 25, "roster_status": "cut"},
    ]
    totals = _team_totals(rows, salary_cap=200)
    assert totals["committed"] == 100
    assert totals["dead_cap"] == 25
    assert totals["against_cap"] == 125
    assert totals["unspent"] == 75


def test_season_salary_caps_independent_by_year(salary_league, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    storage.upsert_season_salary_cap(salary_league, 2024, 150)
    storage.upsert_season_salary_cap(salary_league, 2025, 250)
    payload = build_team_salary_sheets_payload(salary_league, season_year=2025)
    assert payload["salary_caps_by_season"]["2024"] == 150
    assert payload["salary_caps_by_season"]["2025"] == 250
    caleb = next(s for s in payload["team_sheets"] if s["owner_label"] == "Caleb K")
    assert caleb["totals"]["unspent"] == 250 - 13


def test_team_salary_sheets_empty_league(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    league = storage.create_league("test-sub", "Empty", 2025, LeagueRules())
    payload = build_team_salary_sheets_payload(league["id"])
    assert payload["available"] is False


def test_team_salary_sheets_commissioner_files(salary_league):
    payload = build_team_salary_sheets_payload(salary_league, season_year=2025)
    assert payload["available"] is True
    assert payload["data_source"] == "commissioner_files"
    assert payload["team_sheets"]
