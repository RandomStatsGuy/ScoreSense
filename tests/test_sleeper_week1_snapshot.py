"""Week-1 Sleeper snapshot → Historic year sheet."""

from __future__ import annotations

from datetime import datetime, timezone

from src.draft_hub import storage
from src.draft_hub.contract_rows_merged import build_merged_contract_rows, merge_owner_roster
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.sleeper_week1_snapshot import (
    PRE_DRAFT_SOURCE_KIND,
    SOURCE_KIND,
    _seed_salary_for_player,
    build_pre_draft_contract_rows,
    build_week1_contract_rows,
    partition_pre_week1_transactions,
    persist_pre_draft_contract_rows,
    persist_week1_contract_rows,
)


def test_partition_pre_week1_by_kickoff(monkeypatch):
    kick = datetime(2025, 9, 5, 17, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot._week1_kickoff_utc",
        lambda _yr: kick,
    )
    pre_ms = int((kick.timestamp() - 86400) * 1000)
    post_ms = int((kick.timestamp() + 86400) * 1000)
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot.fetch_sleeper_transactions",
        lambda *_a, **_k: [
            {"status": "complete", "type": "trade", "created": pre_ms, "transaction_id": "pre"},
            {"status": "complete", "type": "waiver", "created": post_ms, "transaction_id": "post"},
        ],
    )
    parts = partition_pre_week1_transactions("lid", season_year=2025)
    assert len(parts["pre_week1"]) == 1
    assert parts["pre_week1"][0]["transaction_id"] == "pre"
    assert len(parts["from_week1"]) == 1
    assert parts["from_week1"][0]["transaction_id"] == "post"


def test_salary_seed_same_owner_then_prior_then_needs():
    rules = LeagueRules()
    meta = {"player_name": "J. Chase", "sheet_name": "J. Chase", "position": "WR"}
    y_rows = [
        {
            "owner_label": "Aaron D",
            "player_name": "J. Chase",
            "position": "WR",
            "cap_hit": 40.0,
            "roster_status": "active",
            "acquisition_type": "draft",
        }
    ]
    seeded, src = _seed_salary_for_player(
        owner="Aaron D",
        meta=meta,
        y_rows=y_rows,
        y1_rows=[],
        rules=rules,
        season_year=2025,
    )
    assert src == "same_owner_y"
    assert seeded["cap_hit"] == 40.0

    seeded2, src2 = _seed_salary_for_player(
        owner="Caleb K",
        meta=meta,
        y_rows=y_rows,
        y1_rows=[],
        rules=rules,
        season_year=2025,
    )
    assert src2 == "other_owner_y"
    assert seeded2["acquisition_type"] == "trade"
    assert seeded2["needs_review"] is True

    seeded3, src3 = _seed_salary_for_player(
        owner="Aaron D",
        meta={"player_name": "A. Rookie", "sheet_name": "A. Rookie", "position": "RB"},
        y_rows=[],
        y1_rows=[
            {
                "owner_label": "Aaron D",
                "player_name": "A. Rookie",
                "position": "RB",
                "cap_hit": 10.0,
                "roster_status": "active",
                "contract_phase": "initial",
                "original_draft_year": 2024,
            }
        ],
        rules=rules,
        season_year=2025,
    )
    assert src3 == "prior_year_renewal"
    # Still in rookie window → flat prior
    assert seeded3["cap_hit"] == 10.0

    seeded4, src4 = _seed_salary_for_player(
        owner="Aaron D",
        meta={"player_name": "Mystery", "sheet_name": "Mystery", "position": "QB"},
        y_rows=[],
        y1_rows=[],
        rules=rules,
        season_year=2025,
    )
    assert src4 == "needs_salary"
    assert seeded4["cap_hit"] is None
    assert seeded4["needs_review"] is True


def test_build_week1_membership_and_cuts(hub_db, monkeypatch):
    league = storage.create_league("w1-build", "W1", 2025, LeagueRules())
    lid = league["id"]
    storage.update_league_sleeper_id(lid, "sleeper-test")

    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot.sleeper_league_id_for_season",
        lambda *_a, **_k: "sleeper-2025",
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot.fetch_week1_roster_by_owner",
        lambda *_a, **_k: {
            "Aaron D": [
                {
                    "sleeper_player_id": "1",
                    "player_name": "Ja'Marr Chase",
                    "sheet_name": "J. Chase",
                    "position": "WR",
                }
            ],
            "Caleb K": [
                {
                    "sleeper_player_id": "2",
                    "player_name": "Joe Burrow",
                    "sheet_name": "J. Burrow",
                    "position": "QB",
                }
            ],
        },
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot._salary_seed_sources",
        lambda *_a, **_k: (
            [
                {
                    "owner_label": "Aaron D",
                    "player_name": "J. Chase",
                    "position": "WR",
                    "cap_hit": 40.0,
                    "roster_status": "active",
                },
                {
                    "owner_label": "Aaron D",
                    "player_name": "C. McLaughlin",
                    "position": "K",
                    "cap_hit": 0.0,
                    "prior_salary": 1.0,
                    "roster_status": "cut",
                },
            ],
            [],
        ),
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot.partition_pre_week1_transactions",
        lambda *_a, **_k: {
            "pre_week1": [{"type": "trade", "transaction_id": "t1"}],
            "from_week1": [],
            "kickoff_utc": "2025-09-05T17:00:00+00:00",
        },
    )

    rows, report = build_week1_contract_rows(lid, season_year=2025)
    actives = [r for r in rows if r["roster_status"] == "active"]
    cuts = [r for r in rows if r["roster_status"] == "cut"]
    assert len(actives) == 2
    assert len(cuts) == 1
    assert cuts[0]["player_name"] == "C. McLaughlin"
    assert report["pre_week1_trades"] == 1
    assert report["salary_seeded"] >= 1

    persist_week1_contract_rows(lid, 2025, rows, imported_by_sub="test")
    stored = storage.list_league_contract_rows(lid, season_year=2025)
    assert all(str(r.get("source_kind")) == SOURCE_KIND for r in stored)


def test_build_pre_draft_skips_prior_fa_contracts(hub_db, monkeypatch):
    league = storage.create_league("pd-fac", "PDF", 2026, LeagueRules())
    lid = league["id"]
    storage.update_league_sleeper_id(lid, "sleeper-2026")

    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot.sleeper_league_id_for_season",
        lambda *_a, **_k: "sleeper-2026",
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot.fetch_current_roster_by_owner",
        lambda *_a, **_k: {
            "Aaron D": [
                {
                    "sleeper_player_id": "1",
                    "player_name": "Keeper Star",
                    "sheet_name": "K. Star",
                    "position": "WR",
                },
                {
                    "sleeper_player_id": "2",
                    "player_name": "Dollar FA",
                    "sheet_name": "D. FA",
                    "position": "RB",
                },
            ],
        },
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot._salary_seed_sources",
        lambda *_a, **_k: (
            [],
            [
                {
                    "owner_label": "Aaron D",
                    "player_name": "K. Star",
                    "position": "WR",
                    "cap_hit": 20.0,
                    "roster_status": "active",
                    "acquisition_type": "draft",
                },
                {
                    "owner_label": "Aaron D",
                    "player_name": "D. FA",
                    "position": "RB",
                    "cap_hit": 1.0,
                    "roster_status": "active",
                    "acquisition_type": "fa_contract",
                },
            ],
        ),
    )

    rows, report = build_pre_draft_contract_rows(lid, season_year=2026)
    names = {str(r.get("player_name")) for r in rows}
    assert "D. FA" not in names and "Dollar FA" not in names
    assert report["skipped_fa_contract"] == 1
    assert len(rows) == 1


def test_build_pre_draft_from_current_rosters(hub_db, monkeypatch):
    league = storage.create_league("pd-build", "PD", 2026, LeagueRules())
    lid = league["id"]
    storage.update_league_sleeper_id(lid, "sleeper-2026")
    storage.upsert_owner_season_map(lid, 2025, "Aaron D", "Team A", source_kind="test")

    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot.sleeper_league_id_for_season",
        lambda *_a, **_k: "sleeper-2026",
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot.fetch_current_roster_by_owner",
        lambda *_a, **_k: {
            "Aaron D": [
                {
                    "sleeper_player_id": "1",
                    "player_name": "Ja'Marr Chase",
                    "sheet_name": "J. Chase",
                    "position": "WR",
                }
            ],
        },
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot._salary_seed_sources",
        lambda *_a, **_k: (
            [],
            [
                {
                    "owner_label": "Aaron D",
                    "player_name": "J. Chase",
                    "position": "WR",
                    "cap_hit": 40.0,
                    "roster_status": "active",
                },
                {
                    "owner_label": "Aaron D",
                    "player_name": "Dead Cap Guy",
                    "position": "RB",
                    "cap_hit": 2.0,
                    "roster_status": "cut",
                },
            ],
        ),
    )

    rows, report = build_pre_draft_contract_rows(lid, season_year=2026)
    assert report["roster_mode"] == "pre_draft"
    assert report["source_kind"] == PRE_DRAFT_SOURCE_KIND
    assert len(rows) == 1
    assert rows[0]["player_name"] in {"J. Chase", "Ja'Marr Chase"}
    # Veteran renewal applies extension_step_up ($5 default) off prior $40.
    assert float(rows[0]["cap_hit"]) == 45.0
    assert float(rows[0]["prior_salary"]) == 40.0
    assert rows[0]["source_kind"] == PRE_DRAFT_SOURCE_KIND
    # Owner map copied from prior season
    assert storage.resolve_hub_team_name(lid, 2026, "Aaron D") == "Team A"

    persist_pre_draft_contract_rows(lid, 2026, rows, imported_by_sub="test")
    stored = storage.list_league_contract_rows(lid, season_year=2026)
    assert all(str(r.get("source_kind")) == PRE_DRAFT_SOURCE_KIND for r in stored)


def test_week1_preferred_over_pre_draft_base(hub_db, monkeypatch):
    league = storage.create_league("pd-pref", "PDP", 2026, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season_source(
        lid,
        2026,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "J. Chase",
                "position": "WR",
                "cap_hit": 40.0,
                "roster_status": "active",
                "source_kind": PRE_DRAFT_SOURCE_KIND,
            }
        ],
        source_kind=PRE_DRAFT_SOURCE_KIND,
    )
    storage.replace_league_contract_season_source(
        lid,
        2026,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "J. Chase",
                "position": "WR",
                "cap_hit": 42.0,
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
            }
        ],
        source_kind=SOURCE_KIND,
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    payload = build_merged_contract_rows(lid, season_year=2026, sheet_format=True)
    assert "week1_sleeper" in payload["data_source"]
    rows = payload["rows_by_season"][2026]
    assert float(rows[0]["cap_hit"]) == 42.0


def test_week1_base_merge_manual_wins(hub_db, monkeypatch):
    league = storage.create_league("w1-merge", "W1M", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season_source(
        lid,
        2025,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "J. Chase",
                "position": "WR",
                "cap_hit": 40.0,
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
            }
        ],
        source_kind=SOURCE_KIND,
    )
    storage.insert_league_contract_row(
        lid,
        2025,
        {
            "owner_label": "Aaron D",
            "player_name": "J. Chase",
            "position": "WR",
            "cap_hit": 45.0,
            "base_salary": 45.0,
            "roster_status": "active",
            "source_kind": "manual",
        },
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    payload = build_merged_contract_rows(lid, season_year=2025, sheet_format=True)
    assert "week1_sleeper" in payload["data_source"]
    rows = payload["rows_by_season"][2025]
    chase = [r for r in rows if "Chase" in str(r.get("player_name"))]
    assert len(chase) == 1
    assert float(chase[0]["cap_hit"]) == 45.0


def test_merge_manual_preferred_over_week1_file_row():
    merged = merge_owner_roster(
        "league",
        season_year=2025,
        owner_label="Aaron D",
        file_rows=[
            {
                "owner_label": "Aaron D",
                "player_name": "J. Chase",
                "position": "WR",
                "cap_hit": 40.0,
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
            }
        ],
        db_rows=[
            {
                "id": 9,
                "owner_label": "Aaron D",
                "player_name": "J. Chase",
                "position": "WR",
                "cap_hit": 50.0,
                "roster_status": "active",
                "source_kind": "manual",
            }
        ],
        alias_map={},
        sheet_format=True,
    )
    assert len(merged) == 1
    assert float(merged[0]["cap_hit"]) == 50.0
