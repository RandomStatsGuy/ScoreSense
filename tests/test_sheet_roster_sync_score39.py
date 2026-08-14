"""SCORE-39: manual Historic overlays survive Sleeper sheet sync."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.contract_rows_merged import build_merged_contract_rows, load_week1_rows_by_season
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.sheet_roster_sync import (
    classify_deletion,
    merge_sleeper_with_manual_overlays,
    reconcile_deletions,
    sync_sleeper_year_sheet,
)
from src.draft_hub.sleeper_week1_snapshot import SOURCE_KIND


def _client_for(sub: str) -> TestClient:
    def _user():
        return {"sub": sub, "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    return TestClient(app)


def test_merge_never_prefers_sleeper_alone():
    """Anti-pattern ``sleeper_rows or rows`` must not drop manuals."""
    sleeper = [
        {
            "owner_label": "Aaron D",
            "player_name": "J. Chase",
            "position": "WR",
            "cap_hit": 40.0,
            "roster_status": "active",
            "source_kind": SOURCE_KIND,
        },
        {
            "owner_label": "Aaron D",
            "player_name": "J. Burrow",
            "position": "QB",
            "cap_hit": 50.0,
            "roster_status": "active",
            "source_kind": SOURCE_KIND,
        },
    ]
    manuals = [
        {
            "id": 9,
            "owner_label": "Aaron D",
            "player_name": "J. Chase",
            "position": "WR",
            "cap_hit": 55.0,
            "roster_status": "active",
            "source_kind": "manual",
        }
    ]
    historic = [
        {
            "owner_label": "Aaron D",
            "player_name": "Only Excel",
            "position": "RB",
            "cap_hit": 3.0,
            "roster_status": "active",
            "source_kind": "import",
        }
    ]
    # Wrong pattern would return sleeper only and drop the $55 correction + Excel gap.
    wrong = sleeper or historic
    assert all(float(r.get("cap_hit") or 0) != 55.0 for r in wrong)

    merged = merge_sleeper_with_manual_overlays(sleeper, manuals, historic_rows=historic)
    by_name = {r["player_name"]: r for r in merged}
    assert float(by_name["J. Chase"]["cap_hit"]) == 55.0
    assert by_name["J. Chase"].get("manual_overlay") is True
    assert float(by_name["J. Burrow"]["cap_hit"]) == 50.0
    assert float(by_name["Only Excel"]["cap_hit"]) == 3.0


def test_deletion_reconciliation_kinds():
    assert (
        classify_deletion(
            on_sleeper=False,
            prior_row={"roster_status": "active", "source_kind": SOURCE_KIND},
            manual_row={"roster_status": "cut", "source_kind": "manual"},
        )
        == "commissioner_cut"
    )
    assert (
        classify_deletion(
            on_sleeper=False,
            prior_row={"roster_status": "cut", "source_kind": SOURCE_KIND},
            manual_row=None,
        )
        == "leftover_cut"
    )
    assert (
        classify_deletion(
            on_sleeper=False,
            prior_row={"roster_status": "active", "source_kind": SOURCE_KIND},
            manual_row=None,
        )
        == "sleeper_drop"
    )
    assert (
        classify_deletion(
            on_sleeper=True,
            prior_row={"roster_status": "active"},
            manual_row=None,
        )
        is None
    )

    report = reconcile_deletions(
        prior_rows=[
            {
                "owner_label": "Aaron D",
                "player_name": "Dropped",
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
            },
            {
                "owner_label": "Aaron D",
                "player_name": "Cut Manual",
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
            },
            {
                "owner_label": "Aaron D",
                "player_name": "Old Cut",
                "roster_status": "cut",
                "source_kind": "import",
            },
        ],
        sleeper_rows=[],
        manual_rows=[
            {
                "owner_label": "Aaron D",
                "player_name": "Cut Manual",
                "roster_status": "cut",
                "source_kind": "manual",
            }
        ],
    )
    assert report["sleeper_drop_count"] == 1
    assert report["commissioner_cut_count"] == 1
    assert report["leftover_cut_count"] == 1


def test_edit_sleeper_row_preserves_membership_base(hub_db):
    league = storage.create_league("s39-edit", "S39", 2025, LeagueRules())
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
                "base_salary": 40.0,
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
            },
            {
                "owner_label": "Aaron D",
                "player_name": "J. Burrow",
                "position": "QB",
                "cap_hit": 50.0,
                "base_salary": 50.0,
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
            },
        ],
        source_kind=SOURCE_KIND,
    )
    chase = next(
        r for r in storage.list_league_contract_rows(lid, season_year=2025) if "Chase" in r["player_name"]
    )
    updated = storage.update_league_contract_row(
        int(chase["id"]),
        {"cap_hit": 55.0, "base_salary": 55.0},
        edited_by_sub="commish",
    )
    assert updated["source_kind"] == "manual"
    assert float(updated["cap_hit"]) == 55.0

    week1 = load_week1_rows_by_season(lid).get(2025) or []
    week1_names = {r["player_name"] for r in week1}
    assert "J. Chase" in week1_names
    assert "J. Burrow" in week1_names

    merged = build_merged_contract_rows(lid, season_year=2025, sheet_format=True)["rows_by_season"][2025]
    chase_m = next(r for r in merged if "Chase" in str(r.get("player_name")))
    assert float(chase_m["cap_hit"]) == 55.0
    assert chase_m.get("db_overlay") is True


def test_manual_survives_sleeper_sync_and_2026_unchanged(hub_db, monkeypatch):
    league = storage.create_league("s39-sync", "S39 Sync", 2025, LeagueRules())
    lid = league["id"]
    storage.update_league_sleeper_id(lid, "sleeper-test")

    storage.replace_league_contract_season_source(
        lid,
        2025,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "J. Chase",
                "position": "WR",
                "cap_hit": 40.0,
                "base_salary": 40.0,
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
                "player_id": "1",
            },
            {
                "owner_label": "Caleb K",
                "player_name": "J. Burrow",
                "position": "QB",
                "cap_hit": 50.0,
                "base_salary": 50.0,
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
                "player_id": "2",
            },
        ],
        source_kind=SOURCE_KIND,
    )
    storage.replace_league_contract_season_source(
        lid,
        2026,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "J. Chase",
                "position": "WR",
                "cap_hit": 40.0,
                "base_salary": 40.0,
                "roster_status": "active",
                "source_kind": "pre_draft_sleeper",
                "player_id": "1",
            }
        ],
        source_kind="pre_draft_sleeper",
    )

    chase = next(
        r for r in storage.list_league_contract_rows(lid, season_year=2025) if "Chase" in r["player_name"]
    )
    storage.update_league_contract_row(
        int(chase["id"]),
        {"cap_hit": 55.0, "base_salary": 55.0},
        edited_by_sub="commish",
    )
    manual_id = int(chase["id"])

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
        "src.draft_hub.sleeper_week1_snapshot.partition_pre_week1_transactions",
        lambda *_a, **_k: {"pre_week1": [], "from_week1": [], "kickoff_utc": None},
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )

    report = sync_sleeper_year_sheet(lid, season_year=2025, mode="week1", imported_by_sub="commish")
    assert report["manual_overlays_after"] >= 1
    assert manual_id in report["manual_overlay_ids_preserved"]
    assert report["manual_overlay_ids_missing"] == []
    assert report["forward_rebuild"] is False

    rows_2025 = storage.list_league_contract_rows(lid, season_year=2025)
    manuals = [r for r in rows_2025 if str(r.get("source_kind")) == "manual"]
    assert any(int(r["id"]) == manual_id and float(r["cap_hit"]) == 55.0 for r in manuals)

    merged = build_merged_contract_rows(lid, season_year=2025, sheet_format=True)["rows_by_season"][2025]
    chase_m = next(r for r in merged if "Chase" in str(r.get("player_name")))
    assert float(chase_m["cap_hit"]) == 55.0

    # Editing / syncing 2025 must leave 2026 unchanged (no auto forward rebuild).
    rows_2026 = storage.list_league_contract_rows(lid, season_year=2026)
    assert len(rows_2026) == 1
    assert float(rows_2026[0]["cap_hit"]) == 40.0
    assert rows_2026[0]["source_kind"] == "pre_draft_sleeper"


def test_forward_rebuild_requires_approval(hub_db):
    league = storage.create_league("s39-fwd", "S39 Fwd", 2025, LeagueRules())
    with pytest.raises(ValueError, match="explicit approval"):
        sync_sleeper_year_sheet(
            league["id"],
            season_year=2025,
            mode="week1",
            forward_rebuild=True,
            forward_rebuild_approved=False,
        )


def test_build_week1_endpoint_preserves_manual(hub_db, monkeypatch):
    league = storage.create_league("s39-api", "S39 API", 2025, LeagueRules())
    lid = league["id"]
    storage.update_league_sleeper_id(lid, "sleeper-test")
    storage.replace_league_contract_season_source(
        lid,
        2025,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "J. Chase",
                "position": "WR",
                "cap_hit": 40.0,
                "base_salary": 40.0,
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
                "player_id": "1",
            }
        ],
        source_kind=SOURCE_KIND,
    )
    row = storage.list_league_contract_rows(lid, season_year=2025)[0]
    storage.update_league_contract_row(
        int(row["id"]),
        {"cap_hit": 61.0, "base_salary": 61.0},
        edited_by_sub="s39-api",
    )

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
            ]
        },
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_week1_snapshot.partition_pre_week1_transactions",
        lambda *_a, **_k: {"pre_week1": [], "from_week1": [], "kickoff_utc": None},
    )
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )

    client = _client_for("s39-api")
    try:
        res = client.post(f"/api/hub/league/{lid}/contract-history/build-week1?season=2025")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["manual_overlays_preserved"] >= 1
        assert body["manual_overlay_ids_missing"] == []
        assert "deletion_reconciliation" in body

        merged = client.get(f"/api/hub/league/{lid}/team-salary-sheets?season=2025")
        assert merged.status_code == 200
        sheets = merged.json()
        rows = []
        for team in sheets.get("team_sheets") or []:
            rows.extend(team.get("rows") or [])
        chase = next(r for r in rows if "Chase" in str(r.get("player_name")))
        assert float(chase["cap_hit"]) == 61.0
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
