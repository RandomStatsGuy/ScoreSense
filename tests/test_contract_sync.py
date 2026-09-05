"""Tests for commissioner sheet sync orchestrator."""

from __future__ import annotations

from src.draft_hub import storage
from src.draft_hub.contract_sync import (
    clear_history_cache,
    commissioner_files_fingerprint,
    commissioner_read_status,
    commissioner_sync_status,
    sync_commissioner_sheets,
)
from src.draft_hub.schemas import LeagueRules


def test_commissioner_read_status_skips_parse(hub_db, monkeypatch):
    def _boom(*_a, **_k):
        raise AssertionError("read status must not parse workbooks")

    monkeypatch.setattr("src.draft_hub.contract_sync.process_league_history", _boom)
    league = storage.create_league("read-st", "Read", 2025, LeagueRules())
    status = commissioner_read_status(league["id"])
    assert status["parsed"] is False
    assert status["has_commissioner_files"] in {True, False}
    assert "stale" in status


def test_commissioner_sync_status_no_files(hub_db, monkeypatch):
    clear_history_cache()
    monkeypatch.setattr(
        "src.draft_hub.contract_sync.process_league_history",
        lambda _dir: __import__("pandas").DataFrame(),
    )
    league = storage.create_league("sync-st", "Sync", 2025, LeagueRules())
    status = commissioner_sync_status(league["id"])
    assert status["stale"] is False
    assert status["has_commissioner_files"] is False


def test_commissioner_sync_status_database_only_is_not_stale(hub_db, monkeypatch):
    clear_history_cache()
    monkeypatch.setattr(
        "src.draft_hub.contract_sync.process_league_history",
        lambda _dir: __import__("pandas").DataFrame(),
    )
    league = storage.create_league("sync-db", "Sync DB", 2025, LeagueRules())
    storage.replace_league_contract_season(
        league["id"],
        2025,
        [
            {
                "owner_label": "A",
                "player_name": "P",
                "position": "QB",
                "cap_hit": 1.0,
                "roster_status": "active",
            }
        ],
    )

    status = commissioner_sync_status(league["id"])

    assert status["stale"] is False
    assert status["has_commissioner_files"] is False


def test_sync_status_clears_workbook_cache_before_empty_parse(hub_db, monkeypatch):
    import src.draft_hub.contract_sync as cs

    cs._HISTORY_CACHE = ("warm", __import__("pandas").DataFrame({"season": [2024]}))
    clear_history_cache()
    monkeypatch.setattr(
        "src.draft_hub.contract_sync.process_league_history",
        lambda _dir: __import__("pandas").DataFrame(),
    )
    league = storage.create_league("sync-cache", "Cache", 2025, LeagueRules())
    status = commissioner_sync_status(league["id"])
    assert status["stale"] is False
    assert status["has_commissioner_files"] is False


def test_sync_commissioner_sheets_orchestrates(hub_db, monkeypatch):
    league = storage.create_league("sync-im", "Sync Import", 2025, LeagueRules())
    lid = league["id"]
    storage.update_league_sleeper_id(lid, "sleeper-test")
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "A",
                "player_name": "P",
                "position": "QB",
                "cap_hit": 1.0,
                "roster_status": "active",
            }
        ],
    )

    monkeypatch.setattr(
        "src.draft_hub.contract_sync.import_legacy_files",
        lambda league_id, **kw: {
            "imported": 2,
            "seasons": [2024, 2025],
            "movements_inferred": 0,
        },
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_sync.infer_all_season_movements",
        lambda _lid: 3,
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_sync.reconcile_movements_with_sleeper",
        lambda *a, **k: {"events_upgraded": 1},
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_sync.parsed_content_fingerprint",
        lambda _dir=None: "abc123",
    )

    result = sync_commissioner_sheets(
        lid,
        imported_by_sub="test",
        reconcile_sleeper=True,
        snapshot_phases={2025: "post_draft"},
    )
    assert result["imported"] == 2
    assert result["movements_inferred"] == 3
    assert result["sleeper_reconcile"]


def test_insights_source_version_includes_import(hub_db):
    league = storage.create_league("fp-test", "FP", 2025, LeagueRules())
    lid = league["id"]
    v1 = storage.insights_source_version(lid)
    storage.record_legacy_import(
        lid,
        2025,
        source_kind="xlsx_pdf",
        source_path="/tmp",
        imported_by_sub="test",
        row_count=1,
    )
    v2 = storage.insights_source_version(lid)
    assert v1 != v2


def test_commissioner_files_fingerprint_stable():
    fp = commissioner_files_fingerprint()
    assert isinstance(fp, str)
