"""Tests for in-season Sleeper contract projection."""

from __future__ import annotations

from datetime import datetime, timezone

from src.draft_hub import storage
from src.draft_hub.in_season_contract_projection import (
    diff_effective_vs_db,
    project_effective_season,
)
from src.draft_hub.schemas import LeagueRules


def test_project_effective_skips_non_planning_season(hub_db):
    league = storage.create_league("proj-skip", "Proj", 2025, LeagueRules())
    lid = league["id"]
    snapshot = [
        {
            "owner_label": "A",
            "player_name": "Player X",
            "cap_hit": 5.0,
            "roster_status": "active",
        }
    ]
    out = project_effective_season(lid, 2024, snapshot)
    assert out == snapshot


def test_diff_effective_empty_without_sleeper(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    league = storage.create_league("diff-empty", "Diff", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Owner",
                "player_name": "Player Z",
                "position": "RB",
                "cap_hit": 8.0,
                "roster_status": "active",
            }
        ],
    )
    diff = diff_effective_vs_db(lid, 2025)
    assert diff["add_count"] == 0
    assert diff["remove_count"] == 0


def test_project_effective_adds_sleeper_acquisition(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    league = storage.create_league("proj-add", "Proj Add", 2025, LeagueRules())
    lid = league["id"]
    storage.update_league_sleeper_id(lid, "sleeper123")
    with storage.get_conn() as conn:
        conn.execute(
            "UPDATE league SET draft_completed = 1 WHERE id = ?",
            (lid,),
        )

    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Owner A",
                "player_name": "Held Player",
                "position": "QB",
                "cap_hit": 10.0,
                "roster_status": "active",
            }
        ],
    )

    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.parse_sleeper_acquisitions",
        lambda *a, **k: [
            {
                "player_name": "New Pickup",
                "player_key": "newpickup",
                "to_owner": "Owner B",
                "event_type": "waiver",
                "sleeper_transaction_id": "tx1",
            }
        ],
    )
    monkeypatch.setattr(
        "src.draft_hub.in_season_contract_projection._roster_salary_by_player",
        lambda _lid: {"newpickup": 1.0},
    )

    snapshot = [
        {
            "owner_label": "Owner A",
            "player_name": "Held Player",
            "position": "QB",
            "cap_hit": 10.0,
            "roster_status": "active",
        }
    ]
    out = project_effective_season(lid, 2025, snapshot)
    names = {r.get("player_name") for r in out}
    assert "New Pickup" in names


def test_project_effective_skips_pre_week1_moves(hub_db, monkeypatch):
    league = storage.create_league("proj-prew1", "PreW1", 2025, LeagueRules())
    lid = league["id"]
    storage.update_league_sleeper_id(lid, "sleeper123")
    with storage.get_conn() as conn:
        conn.execute("UPDATE league SET draft_completed = 1 WHERE id = ?", (lid,))

    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.parse_sleeper_acquisitions",
        lambda *a, **k: [
            {
                "player_name": "Early Trade",
                "player_key": "earlytrade",
                "to_owner": "Owner B",
                "from_owner": "Owner A",
                "event_type": "trade",
                "event_at": "2025-08-01T12:00:00+00:00",
                "sleeper_transaction_id": "pre",
            }
        ],
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot._week1_kickoff_utc",
        lambda _yr: datetime(2025, 9, 5, 17, 0, tzinfo=timezone.utc),
    )
    snapshot = [
        {
            "owner_label": "Owner A",
            "player_name": "Early Trade",
            "position": "WR",
            "cap_hit": 12.0,
            "roster_status": "active",
        }
    ]
    out = project_effective_season(lid, 2025, snapshot)
    assert len(out) == 1
    assert out[0]["owner_label"] == "Owner A"
    assert out[0].get("roster_status") == "active"
