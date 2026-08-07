"""Tests for salary sheet audit (missing players, roster merge)."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.salary_sheet_audit import build_salary_sheet_audit, suggest_add_row


@pytest.fixture
def audit_league(hub_db):
    league = storage.create_league("test-sub", "Salary Audit Test", 2025, LeagueRules())
    league_id = league["id"]
    rows_2024 = [
        {
            "owner_label": "Caleb K",
            "player_name": "Holdover Player",
            "position": "RB",
            "cap_hit": 10,
            "base_salary": 10,
            "roster_status": "active",
        },
        {
            "owner_label": "Chris G",
            "player_name": "Traded Away",
            "position": "WR",
            "cap_hit": 8,
            "base_salary": 8,
            "roster_status": "active",
        },
    ]
    rows_2025 = [
        {
            "owner_label": "Caleb K",
            "player_name": "On Roster",
            "position": "QB",
            "prior_salary": 5,
            "cap_hit": 12,
            "base_salary": 12,
            "roster_status": "active",
        },
        {
            "owner_label": "Chris G",
            "player_name": "Traded Away",
            "position": "WR",
            "prior_salary": 8,
            "cap_hit": 9,
            "base_salary": 9,
            "roster_status": "active",
        },
    ]
    storage.replace_league_contract_season(league_id, 2024, rows_2024)
    storage.replace_league_contract_season(league_id, 2025, rows_2025)
    return league_id


def test_audit_finds_prior_roster_missing(audit_league, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit._load_commissioner_rows_by_season",
        lambda: {},
    )
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit.load_draft_wins_by_season",
        lambda: ({}, None),
    )
    payload = build_salary_sheet_audit(audit_league, season_year=2025, owner_label="Caleb K")
    missing = payload["missing_by_owner"]["Caleb K"]
    names = [m["player_name"] for m in missing]
    assert "Holdover Player" in names
    holdover = next(m for m in missing if m["player_name"] == "Holdover Player")
    assert holdover["reason"] == "prior_roster"
    assert "Holdover Player" not in [r["player_name"] for r in payload["rosters"]["Caleb K"]]


def test_audit_db_overlay_without_position(audit_league, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit._load_commissioner_rows_by_season",
        lambda: {},
    )
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit.load_draft_wins_by_season",
        lambda: (
            {
                2025: [
                    {
                        "season_year": 2025,
                        "player_name": "No Pos Player",
                        "owner_label": "Caleb K",
                        "cap_hit": 4,
                    }
                ]
            },
            None,
        ),
    )
    storage.insert_league_contract_row(
        audit_league,
        2025,
        {
            "owner_label": "Caleb K",
            "player_name": "No Pos Player",
            "cap_hit": 4,
            "base_salary": 4,
            "roster_status": "active",
            "source_kind": "manual",
        },
    )
    payload = build_salary_sheet_audit(audit_league, season_year=2025, owner_label="Caleb K")
    assert not any(
        m["player_name"] == "No Pos Player"
        for m in payload["missing_by_owner"]["Caleb K"]
    )
    assert any(
        r["player_name"] == "No Pos Player"
        for r in payload["rosters"]["Caleb K"]
    )


def test_audit_db_overlay_clears_missing(audit_league, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit._load_commissioner_rows_by_season",
        lambda: {},
    )
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit.load_draft_wins_by_season",
        lambda: ({}, None),
    )
    before = build_salary_sheet_audit(audit_league, season_year=2025, owner_label="Caleb K")
    assert any(m["player_name"] == "Holdover Player" for m in before["missing_by_owner"]["Caleb K"])

    storage.insert_league_contract_row(
        audit_league,
        2025,
        {
            "owner_label": "Caleb K",
            "player_name": "Holdover Player",
            "position": "RB",
            "cap_hit": 10,
            "base_salary": 10,
            "prior_salary": 10,
            "roster_status": "active",
            "source_kind": "manual",
        },
    )
    after = build_salary_sheet_audit(audit_league, season_year=2025, owner_label="Caleb K")
    assert not any(m["player_name"] == "Holdover Player" for m in after["missing_by_owner"]["Caleb K"])
    roster_names = [r["player_name"] for r in after["rosters"]["Caleb K"]]
    assert "Holdover Player" in roster_names


def test_audit_skips_traded_carryover(audit_league, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit._load_commissioner_rows_by_season",
        lambda: {},
    )
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit.load_draft_wins_by_season",
        lambda: ({}, None),
    )
    payload = build_salary_sheet_audit(audit_league, season_year=2025, owner_label="Caleb K")
    missing = payload["missing_by_owner"]["Caleb K"]
    assert not any(m["player_name"] == "Traded Away" for m in missing)


def test_audit_draft_win_missing(audit_league, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit._load_commissioner_rows_by_season",
        lambda: {},
    )
    monkeypatch.setattr(
        "src.draft_hub.salary_sheet_audit.load_draft_wins_by_season",
        lambda: (
            {
                2025: [
                    {
                        "season_year": 2025,
                        "player_name": "Auction Win",
                        "owner_label": "Caleb K",
                        "cap_hit": 15,
                    }
                ]
            },
            None,
        ),
    )
    payload = build_salary_sheet_audit(audit_league, season_year=2025, owner_label="Caleb K")
    missing = payload["missing_by_owner"]["Caleb K"]
    assert any(m["player_name"] == "Auction Win" and m["reason"] == "draft_win" for m in missing)


def test_suggest_add_row(audit_league):
    body = suggest_add_row(
        audit_league,
        season_year=2025,
        owner_label="Caleb K",
        player_name="Holdover Player",
        missing_item={
            "suggested_cap_hit": 10,
            "suggested_prior_salary": 10,
            "position": "RB",
        },
    )
    assert body["season_year"] == 2025
    assert body["owner_label"] == "Caleb K"
    assert body["player_name"] == "Holdover Player"
    assert body["cap_hit"] == 10
    assert body["roster_status"] == "active"
