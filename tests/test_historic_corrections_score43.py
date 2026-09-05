"""SCORE-43: Historic corrections — reason, history-only vs forward preview, snapshot version."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.historic_corrections import (
    build_live_forward_preview,
    correct_historic_row,
    correction_context,
)
from src.draft_hub.schemas import LeagueRules


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _seed_league_with_historic_and_live(hub_db, *, sub: str = "corr-commish"):
    """2025 historic row + matching 2026 live roster player."""
    league = storage.create_league(sub, "SCORE-43 League", 2026, LeagueRules(), team_count=2)
    lid = league["id"]
    teams = storage.list_league_teams(lid)
    team_a = teams[0]
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws,
        {
            "player_id": "00-0035676",
            "player_name": "J. Chase",
            "team": "CIN",
            "position": "WR",
            "salary": 40.0,
            "contract_years": 2,
            "source": "manual",
            "contract": {
                "contract_type": "veteran",
                "current_salary": 40.0,
                "years_remaining": 2,
                "salary_schedule": [40.0, 45.0],
            },
        },
        team_id=team_a["id"],
    )
    storage.replace_league_contract_season_source(
        lid,
        2025,
        [
            {
                "owner_label": "Team A",
                "hub_team_name": team_a["name"],
                "player_name": "J. Chase",
                "player_id": "00-0035676",
                "position": "WR",
                "cap_hit": 40.0,
                "base_salary": 40.0,
                "roster_status": "active",
                "contract_phase": "week1",
                "source_kind": "week1_sleeper",
            }
        ],
        source_kind="week1_sleeper",
    )
    # A later-season historic row proves history_only does not touch it.
    storage.replace_league_contract_season_source(
        lid,
        2026,
        [
            {
                "owner_label": "Team A",
                "hub_team_name": team_a["name"],
                "player_name": "J. Chase",
                "player_id": "00-0035676",
                "position": "WR",
                "cap_hit": 42.0,
                "base_salary": 42.0,
                "roster_status": "active",
                "source_kind": "pre_draft_sleeper",
            }
        ],
        source_kind="pre_draft_sleeper",
    )
    rows_2025 = storage.list_league_contract_rows(lid, season_year=2025)
    return lid, ws, team_a, rows_2025[0]


def test_correction_context_exposes_source_phase_original(hub_db):
    lid, _, _, row = _seed_league_with_historic_and_live(hub_db)
    ctx = correction_context(lid, int(row["id"]))
    assert ctx["source_kind"] == "week1_sleeper"
    assert ctx["contract_phase"] == "week1"
    assert ctx["original"]["cap_hit"] == 40.0
    assert ctx["original"]["player_name"] == "J. Chase"
    assert "historic_snapshot_revision" in ctx
    assert "history_only" in ctx["modes"]


def test_history_only_leaves_2026_and_live_unchanged(hub_db):
    lid, ws, _, row = _seed_league_with_historic_and_live(hub_db)
    hist0 = storage.league_cache_revisions(lid)["historic_snapshot_revision"]
    live0 = storage.league_cache_revisions(lid)["live_roster_revision"]
    live_before = storage.get_roster_slot(ws, "00-0035676")

    result = correct_historic_row(
        lid,
        int(row["id"]),
        reason="Sheet typo on Chase 2025",
        mode="history_only",
        updates={"cap_hit": 55.0},
        edited_by_sub="corr-commish",
    )
    assert result["applied"] is True
    assert result["live_applied"] is False
    assert result["before"]["cap_hit"] == 40.0
    assert result["after"]["cap_hit"] == 55.0
    assert result["historic_snapshot_revision"] > hist0
    assert result["correction_id"]

    # 2025 published; 2026 historic + live untouched.
    row_2025 = storage.get_league_contract_row(int(row["id"]))
    assert float(row_2025["cap_hit"]) == 55.0
    row_2026 = storage.list_league_contract_rows(lid, season_year=2026)[0]
    assert float(row_2026["cap_hit"]) == 42.0
    live_after = storage.get_roster_slot(ws, "00-0035676")
    assert float(live_after["salary"]) == float(live_before["salary"])
    assert storage.league_cache_revisions(lid)["live_roster_revision"] == live0

    stored = storage.get_historic_correction(int(result["correction_id"]))
    assert stored["reason"] == "Sheet typo on Chase 2025"
    assert stored["mode"] == "history_only"
    assert stored["before"]["cap_hit"] == 40.0
    assert stored["after"]["cap_hit"] == 55.0
    assert stored["historic_snapshot_revision"] == result["historic_snapshot_revision"]


def test_preview_forward_does_not_mutate(hub_db):
    lid, ws, _, row = _seed_league_with_historic_and_live(hub_db)
    hist0 = storage.league_cache_revisions(lid)["historic_snapshot_revision"]
    live0 = storage.league_cache_revisions(lid)["live_roster_revision"]

    result = correct_historic_row(
        lid,
        int(row["id"]),
        reason="Preview forward rebuild",
        mode="preview_forward",
        updates={"cap_hit": 55.0},
        edited_by_sub="corr-commish",
    )
    assert result["applied"] is False
    assert result["live_applied"] is False
    assert result["live_preview"]["matched"] is True
    assert result["live_preview"]["change"]["before"] == 40.0
    assert result["live_preview"]["change"]["after"] == 55.0
    assert result["live_preview"]["change"]["changed"] is True

    assert float(storage.get_league_contract_row(int(row["id"]))["cap_hit"]) == 40.0
    assert float(storage.get_roster_slot(ws, "00-0035676")["salary"]) == 40.0
    revs = storage.league_cache_revisions(lid)
    assert revs["historic_snapshot_revision"] == hist0
    assert revs["live_roster_revision"] == live0


def test_apply_forward_requires_approval_then_updates_live(hub_db):
    lid, ws, _, row = _seed_league_with_historic_and_live(hub_db)

    with pytest.raises(ValueError, match="explicit approval"):
        correct_historic_row(
            lid,
            int(row["id"]),
            reason="Apply forward without flag",
            mode="apply_forward",
            updates={"cap_hit": 55.0},
            edited_by_sub="corr-commish",
            forward_rebuild_approved=False,
        )

    result = correct_historic_row(
        lid,
        int(row["id"]),
        reason="Apply forward after approval",
        mode="apply_forward",
        updates={"cap_hit": 55.0},
        edited_by_sub="corr-commish",
        forward_rebuild_approved=True,
    )
    assert result["applied"] is True
    assert result["live_applied"] is True
    assert result["live_before"]["salary"] == 40.0
    assert result["live_after"]["salary"] == 55.0
    assert float(storage.get_roster_slot(ws, "00-0035676")["salary"]) == 55.0
    # 2026 historic sheet still isolated unless separately rebuilt.
    assert float(storage.list_league_contract_rows(lid, season_year=2026)[0]["cap_hit"]) == 42.0


def test_reason_required(hub_db):
    lid, _, _, row = _seed_league_with_historic_and_live(hub_db)
    with pytest.raises(ValueError, match="reason"):
        correct_historic_row(
            lid,
            int(row["id"]),
            reason="  ",
            mode="history_only",
            updates={"cap_hit": 41.0},
            edited_by_sub="corr-commish",
        )


def test_api_correct_endpoints(hub_db):
    lid, ws, _, row = _seed_league_with_historic_and_live(hub_db)
    client = _client_for("corr-commish")
    try:
        ctx_res = client.get(
            f"/api/hub/league/{lid}/contract-history/{row['id']}/correction-context"
        )
        assert ctx_res.status_code == 200, ctx_res.text
        assert ctx_res.json()["original"]["cap_hit"] == 40.0

        # Salary PATCH without reason rejected.
        bad_patch = client.patch(
            f"/api/hub/league/{lid}/contract-history/{row['id']}",
            json={"cap_hit": 50.0},
        )
        assert bad_patch.status_code == 400

        preview = client.post(
            f"/api/hub/league/{lid}/contract-history/{row['id']}/correct",
            json={
                "reason": "UI preview forward",
                "mode": "preview_forward",
                "cap_hit": 60.0,
            },
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["applied"] is False
        assert float(storage.get_roster_slot(ws, "00-0035676")["salary"]) == 40.0

        hist = client.post(
            f"/api/hub/league/{lid}/contract-history/{row['id']}/correct",
            json={
                "reason": "2025 history only correction",
                "mode": "history_only",
                "updates": {"cap_hit": 58.0},
            },
        )
        assert hist.status_code == 200, hist.text
        body = hist.json()
        assert body["applied"] is True
        assert body["live_applied"] is False
        assert body["after"]["cap_hit"] == 58.0
        assert body["historic_snapshot_revision"] >= 1
        assert float(storage.get_roster_slot(ws, "00-0035676")["salary"]) == 40.0

        listed = client.get(f"/api/hub/league/{lid}/contract-history/corrections?season=2025")
        assert listed.status_code == 200
        assert any(c["id"] == body["correction_id"] for c in listed.json()["corrections"])
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_commissioner_roster_override_requires_reason_and_before_after(hub_db):
    lid, _, _, _ = _seed_league_with_historic_and_live(hub_db)
    storage.set_hub_focus("corr-commish", league_id=lid)
    client = _client_for("corr-commish")
    try:
        missing = client.patch(
            "/api/hub/roster",
            json={"player_id": "00-0035676", "salary": 70.0, "contract_years": 2},
        )
        assert missing.status_code == 400
        assert "reason" in missing.json()["detail"].lower()

        ok = client.patch(
            "/api/hub/roster",
            json={
                "player_id": "00-0035676",
                "salary": 70.0,
                "contract_years": 2,
                "note": "Commissioner mid-season override",
            },
        )
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert body["before"]["salary"] == 40.0
        assert body["after"]["salary"] == 70.0
        assert body["note"] == "Commissioner mid-season override"
        assert body["live_roster_revision"] >= 1
        assert float(body["slot"]["salary"]) == 70.0
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_commissioner_roster_patch_applies_type_and_salary_together(hub_db):
    lid, _, _, _ = _seed_league_with_historic_and_live(hub_db)
    storage.set_hub_focus("corr-commish", league_id=lid)
    client = _client_for("corr-commish")
    try:
        res = client.patch(
            "/api/hub/roster",
            json={
                "player_id": "00-0035676",
                "salary": 18.0,
                "contract_years": 3,
                "contract_type": "rookie",
                "note": "One PATCH for type and cap",
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        slot = body["slot"]
        assert float(slot["salary"]) == 18.0
        assert int(slot["contract_years"]) == 3
        assert (slot.get("contract") or {}).get("contract_type") == "rookie"
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_commissioner_roster_patch_type_only_does_not_need_a_note(hub_db):
    lid, _, _, _ = _seed_league_with_historic_and_live(hub_db)
    storage.set_hub_focus("corr-commish", league_id=lid)
    client = _client_for("corr-commish")
    try:
        res = client.patch(
            "/api/hub/roster",
            json={"player_id": "00-0035676", "contract_type": "extension"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body.get("saved_contract_type") == "extension"
        assert (body["slot"].get("contract") or {}).get("contract_type") == "extension"
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_forward_preview_helper_matches_by_name(hub_db):
    lid, _, _, row = _seed_league_with_historic_and_live(hub_db)
    preview = build_live_forward_preview(
        lid,
        before_row=row,
        after_row={**row, "cap_hit": 99.0, "base_salary": 99.0},
    )
    assert preview["matched"] is True
    assert preview["change"]["after"] == 99.0
