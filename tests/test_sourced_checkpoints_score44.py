"""SCORE-44: sourced checkpoints + quarantine for 2021–2025 imports."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.config import OLD_LEAGUE_FILES_DIR
from src.draft_hub import storage
from src.draft_hub.contract_sync import default_snapshot_phases, sync_commissioner_sheets
from src.draft_hub.legacy_contract_history import (
    _overlayable_contract_row,
    build_contract_history_payload,
)
from src.draft_hub.legacy_contract_import import (
    parse_modern_owner_sheet,
    process_league_history,
)
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.sourced_checkpoints import (
    CHECKPOINT_SPECS,
    apply_row_identity_and_quarantine,
    collect_workbook_quarantines,
    detect_2025_league_blocks,
    franchise_id_for_owner,
    is_cap_obligation_row,
    is_na_year_status,
    is_trusted_ownership_row,
    obligation_kind_for_row,
    strip_embedded_salary_share_name,
)


def _client_for(sub: str) -> TestClient:
    def _user():
        return {"sub": sub, "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    return TestClient(app)


def test_checkpoint_catalog_covers_2021_2025():
    assert set(CHECKPOINT_SPECS) == {2021, 2022, 2023, 2024, 2025}
    assert CHECKPOINT_SPECS[2022]["salary_cap"] == 250.0
    assert CHECKPOINT_SPECS[2022]["ruleset_version"] == "dynasty_cap_250"
    assert CHECKPOINT_SPECS[2025]["phase"] == "pre_draft"
    phases = default_snapshot_phases()
    assert phases[2021] == "post_draft"
    assert phases[2022] == "midseason"


def test_franchise_ids_stable():
    assert franchise_id_for_owner("Caleb K") == "franchise_03_caleb"
    assert franchise_id_for_owner("Unknown") is None


def test_na_year_status_quarantine():
    assert is_na_year_status("NA 2025")
    assert is_na_year_status("na 2026")
    assert not is_na_year_status("CUT")
    row = apply_row_identity_and_quarantine(
        {
            "season_year": 2025,
            "owner_label": "Aaron D",
            "player_name": "T. Hill",
            "position": "WR",
            "cap_hit": 39,
            "roster_status": "active",
            "status_note": "NA 2026",
        }
    )
    assert row["needs_review"] is True
    assert row["confidence"] == "quarantined"
    assert row["review_reason"] == "na_year_status"
    assert row["obligation_kind"] == "quarantined"
    assert row["franchise_id"] == "franchise_01_aaron"
    assert str(row["player_id"]).startswith("sp_")
    assert not is_trusted_ownership_row(row)
    assert not _overlayable_contract_row({**row, "source_kind": "import"})


def test_salary_share_note_quarantine():
    cleaned, share = strip_embedded_salary_share_name(
        "A Jones ($12 being paid by Dawson to be added next year)"
    )
    assert cleaned == "A Jones"
    assert share and "paid by Dawson" in share
    row = apply_row_identity_and_quarantine(
        {
            "season_year": 2024,
            "owner_label": "Caleb K",
            "player_name": "A Jones ($12 being paid by Dawson to be added next year)",
            "position": "RB",
            "cap_hit": 10,
            "roster_status": "active",
        }
    )
    assert row["player_name"] == "A Jones"
    assert row["roster_status"] == "quarantined"
    assert row["review_reason"] == "ambiguous_salary_share"
    assert row["obligation_kind"] == "salary_share"


def test_cut_is_cap_obligation_not_ownership():
    assert obligation_kind_for_row(roster_status="cut") == "cut_dead_cap"
    row = apply_row_identity_and_quarantine(
        {
            "season_year": 2025,
            "owner_label": "Caleb K",
            "player_name": "A. Richardson",
            "position": "QB",
            "cap_hit": 4,
            "roster_status": "cut",
            "status_note": "CUT",
        }
    )
    assert row["obligation_kind"] == "cut_dead_cap"
    assert is_cap_obligation_row(row)
    assert not is_trusted_ownership_row(row)


def test_detect_2025_league_lower_block_quarantined():
    path = OLD_LEAGUE_FILES_DIR / "2025 Dynasty League Free Agency Decisions.xlsx"
    if not path.exists():
        pytest.skip("2025 workbook missing")
    blocks = detect_2025_league_blocks(path)
    assert blocks["available"] is True
    assert blocks["upper_block"]["owner_count"] == 10
    assert blocks["lower_block"]["owner_count"] == 5
    assert blocks["quarantine"]
    assert blocks["quarantine"][0]["reason_code"] == "unlabeled_2025_league_lower_block"


def test_workbook_quarantine_inventory_includes_trade_and_master():
    if not OLD_LEAGUE_FILES_DIR.exists():
        pytest.skip("old_league_files missing")
    hits = collect_workbook_quarantines(OLD_LEAGUE_FILES_DIR)
    codes = {h["reason_code"] for h in hits}
    assert "unlabeled_2025_league_lower_block" in codes
    assert "trade_in_progress_sheet" in codes
    assert "master_not_final_roster" in codes


def test_process_league_history_quarantines_na_rows():
    if not OLD_LEAGUE_FILES_DIR.exists():
        pytest.skip("old_league_files missing")
    df = process_league_history(OLD_LEAGUE_FILES_DIR)
    assert not df.empty
    assert "franchise_id" in df.columns
    assert "obligation_kind" in df.columns
    assert "ruleset_version" in df.columns
    na = df[df["review_reason"] == "na_year_status"]
    assert len(na) >= 50
    assert (na["confidence"] == "quarantined").all()
    # 2022 historical cap provenance stamped on rows
    y2022 = df[df["season_year"] == 2022]
    assert not y2022.empty
    assert (y2022["ruleset_version"] == "dynasty_cap_250").all()
    cuts = df[df["roster_status"] == "cut"]
    assert not cuts.empty
    assert (cuts["obligation_kind"] == "cut_dead_cap").all()


def test_modern_sheet_na_status_quarantined(tmp_path: Path):
    # Minimal synthetic sheet mimicking NA 2026 status.
    df = pd.DataFrame(
        [
            [None, None, None, None, None, None],
            [None, "Pos", "Player", "2024 Salary", "Status", "2025 Salary"],
            [None, "QB", "J. Allen", 23, "NA 2026", 23],
            [None, "RB", "J. Gibbs", 35, "2025-01-01", 35],
            [None, "RB", "Z. White", 10, "CUT", 5],
        ]
    )
    rows = parse_modern_owner_sheet(df, "Stephen P", 2025, {"Stephen P": "Team S"})
    allen = next(r for r in rows if r["player_name"] == "J. Allen")
    assert allen["needs_review"] is True
    assert allen["review_reason"] == "na_year_status"
    gibbs = next(r for r in rows if r["player_name"] == "J. Gibbs")
    assert gibbs["needs_review"] is False
    assert gibbs["obligation_kind"] == "ownership"
    white = next(r for r in rows if "White" in r["player_name"])
    assert white["roster_status"] == "cut"
    assert white["obligation_kind"] == "cut_dead_cap"


def test_sync_persists_checkpoint_metadata_and_quarantine(hub_db, monkeypatch):
    league = storage.create_league("cp-44", "Checkpoints", 2025, LeagueRules())
    lid = league["id"]

    def _fake_import(league_id, **kw):
        storage.replace_league_contract_season(
            league_id,
            2025,
            [
                apply_row_identity_and_quarantine(
                    {
                        "season_year": 2025,
                        "owner_label": "Aaron D",
                        "player_name": "T. Hill",
                        "position": "WR",
                        "cap_hit": 39,
                        "roster_status": "active",
                        "status_note": "NA 2026",
                        "source_kind": "import",
                    }
                ),
                apply_row_identity_and_quarantine(
                    {
                        "season_year": 2025,
                        "owner_label": "Aaron D",
                        "player_name": "B. Hall",
                        "position": "RB",
                        "cap_hit": 32,
                        "roster_status": "active",
                        "source_kind": "import",
                    }
                ),
            ],
        )
        storage.record_legacy_import(
            league_id,
            2025,
            source_kind="xlsx_pdf",
            source_path="/tmp",
            imported_by_sub="test",
            row_count=2,
        )
        return {"imported": 2, "seasons": [2025], "movements_inferred": 0}

    monkeypatch.setattr(
        "src.draft_hub.contract_sync.import_legacy_files",
        _fake_import,
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_sync.infer_all_season_movements",
        lambda _lid: 0,
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_sync.parsed_content_fingerprint",
        lambda _dir=None: "fp44",
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_sync.collect_workbook_quarantines",
        lambda _dir: [
            {
                "reason_code": "unlabeled_2025_league_lower_block",
                "message": "lower block",
                "season_year": 2025,
                "source_ref": "League",
                "detail": {},
            }
        ],
    )

    result = sync_commissioner_sheets(lid, imported_by_sub="test", reconcile_sleeper=False)
    assert result["quarantine"]["count"] >= 2
    imports = storage.list_legacy_imports(lid)
    assert imports
    imp = imports[0]
    assert imp["snapshot_phase"] == "pre_draft"
    assert imp["as_of"] == "2025-offseason"
    assert imp["ruleset_version"] == "dynasty_cap_200"
    assert float(imp["salary_cap"]) == 200.0
    caps = storage.list_season_salary_caps(lid)
    assert caps.get(2025) == 200.0

    q = storage.list_league_import_quarantine(lid)
    codes = {item["reason_code"] for item in q}
    assert "unlabeled_2025_league_lower_block" in codes
    assert "na_year_status" in codes

    payload = build_contract_history_payload(lid, season_year=2025)
    assert payload["quarantined_count"] >= 1
    assert payload["checkpoints"]
    ck = next(c for c in payload["checkpoints"] if c["season_year"] == 2025)
    assert ck["ruleset_version"] == "dynasty_cap_200"
    assert ck["phase"] == "pre_draft"


def test_quarantine_endpoint_payload(hub_db):
    league = storage.create_league("q-api", "Quarantine API", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_import_quarantine(
        lid,
        [
            {
                "reason_code": "na_year_status",
                "message": "NA 2026",
                "season_year": 2025,
                "owner_label": "Aaron D",
                "player_name": "T. Hill",
                "source_ref": None,
                "detail": {},
            }
        ],
    )
    client = _client_for("q-api")
    try:
        res = client.get(f"/api/hub/league/{lid}/contract-history/quarantine")
        assert res.status_code == 200
        body = res.json()
        assert body["count"] == 1
        assert body["by_reason"]["na_year_status"] == 1
        assert body["items"][0]["player_name"] == "T. Hill"
        assert any(c["season_year"] == 2022 for c in body["checkpoints"])
        assert body["checkpoints"][0]["salary_cap"] in (200.0, 250.0)
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
