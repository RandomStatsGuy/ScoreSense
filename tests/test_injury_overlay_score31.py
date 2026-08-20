"""SCORE-31: incremental injury overlays + team-scoped recompute."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from src.integrations.injury_snapshot import (
    build_injury_snapshot,
    diff_injury_snapshots,
    normalize_injury_note,
)
from src.projections.injury_overlay import (
    build_overlays_for_teams,
    invalidate_injury_overlay_cache,
    list_injury_overlays,
    recompute_injury_overlays,
    save_injury_overlay_artifact,
)


def _snap_player(**kwargs):
    base = {
        "sleeper_id": "s1",
        "gsis_id": "00-1",
        "full_name": "Ja'Marr Chase",
        "team": "CIN",
        "position": "WR",
        "status": "Questionable",
        "practice": "Limited",
        "injury_body_part": "Ankle",
        "injury_notes": "Ankle sprain",
        "updated_at": "2026-08-13T12:00:00+00:00",
    }
    base.update(kwargs)
    return base


def test_normalize_injury_note_strips_punctuation():
    assert normalize_injury_note("Ankle sprain!") == normalize_injury_note("Ankle sprain")
    assert normalize_injury_note("  Hip — contusion. ") == normalize_injury_note("Hip contusion")


def test_diff_ignores_punctuation_only_note_and_updated_at():
    prev = {
        "injury_snapshot_id": "inj_a",
        "players": [_snap_player(injury_notes="Ankle sprain", updated_at="2026-08-13T12:00:00+00:00")],
    }
    curr = {
        "injury_snapshot_id": "inj_b",
        "players": [
            _snap_player(
                injury_notes="Ankle sprain!!!",
                updated_at="2026-08-13T18:00:00+00:00",
            )
        ],
    }
    diff = diff_injury_snapshots(prev, curr)
    assert diff["material_change"] is False
    assert diff["changed_teams"] == []


def test_diff_detects_status_change_team_scoped():
    prev = {
        "injury_snapshot_id": "inj_a",
        "players": [
            _snap_player(team="CIN", status="Questionable"),
            _snap_player(
                sleeper_id="s2",
                gsis_id="00-2",
                full_name="Other",
                team="KC",
                status="Out",
            ),
        ],
    }
    curr = {
        "injury_snapshot_id": "inj_b",
        "players": [
            _snap_player(team="CIN", status="Out"),  # CIN changed
            _snap_player(
                sleeper_id="s2",
                gsis_id="00-2",
                full_name="Other",
                team="KC",
                status="Out",
            ),
        ],
    }
    diff = diff_injury_snapshots(prev, curr)
    assert diff["changed_teams"] == ["CIN"]
    assert "KC" in diff["unchanged_teams"]


def test_snapshot_fingerprint_stable_for_note_punctuation(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "src.integrations.injury_snapshot.INJURY_SNAPSHOTS_DIR",
        Path(tmp_path),
    )
    players_a = {
        "111": {
            "full_name": "Ja'Marr Chase",
            "gsis_id": "00-0036322",
            "team": "CIN",
            "position": "WR",
            "injury_status": "Questionable",
            "practice_participation": "Limited",
            "injury_notes": "Ankle sprain",
            "news_updated": 1_700_000_000_000,
        }
    }
    players_b = {
        "111": {
            **players_a["111"],
            "injury_notes": "Ankle sprain!!!",
            "news_updated": 1_700_000_100_000,
        }
    }
    a = build_injury_snapshot(season=2026, week=1, players=players_a)
    b = build_injury_snapshot(season=2026, week=1, players=players_b)
    assert a["injury_snapshot_id"] == b["injury_snapshot_id"]


BASELINE = pd.DataFrame(
    [
        {
            "Player": "Tee Higgins",
            "Projected Points": 14.7,
            "Team": "CIN",
            "team": "CIN",
            "player_id": "wr-higgins",
            "Position": "WR",
        },
        {
            "Player": "Quiet WR",
            "Projected Points": 8.0,
            "Team": "KC",
            "team": "KC",
            "player_id": "wr-quiet",
            "Position": "WR",
        },
    ]
)

ROSTER = pd.DataFrame(
    [
        {
            "player_display_name": "Tee Higgins",
            "player_id": "wr-higgins",
            "team": "CIN",
            "position": "WR",
            "target_share_avg": 0.22,
        },
        {
            "player_display_name": "Ja'Marr Chase",
            "player_id": "00-0036322",
            "team": "CIN",
            "position": "WR",
            "target_share_avg": 0.28,
        },
        {
            "player_display_name": "Quiet WR",
            "player_id": "wr-quiet",
            "team": "KC",
            "position": "WR",
            "target_share_avg": 0.15,
        },
    ]
)


def _cin_snapshot(status: str = "Questionable", note: str = "Ankle sprain"):
    return {
        "injury_snapshot_id": f"inj_2026w1_{status.lower()}",
        "built_at": "2026-08-14T00:00:00+00:00",
        "season": 2026,
        "week": 1,
        "players": [
            _snap_player(
                gsis_id="00-0036322",
                status=status,
                injury_notes=note,
            )
        ],
    }


def test_build_overlays_separates_baseline_availability_opportunity():
    rows = build_overlays_for_teams(
        2026,
        1,
        {"CIN"},
        injury_snapshot=_cin_snapshot(),
        baseline_df=BASELINE,
        roster_df=ROSTER,
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["player_id"] == "wr-higgins"
    assert row["baseline"] == 14.7
    assert row["availability_adjustment"] == 0.0
    assert row["opportunity_adjustment"] > 0
    assert row["final_delta"] == pytest.approx(row["opportunity_adjustment"])
    assert row["final"] == pytest.approx(row["baseline"] + row["final_delta"])
    assert row["injury_snapshot_id"] == "inj_2026w1_questionable"
    assert "00-0036322" in row["driver_player_ids"]
    assert row["multiplier"] > 1.0


def test_build_overlays_ignore_defensive_teammate_injuries():
    """Questionable CB/DT on the same team must not overlay-boost an RB."""
    baseline = pd.DataFrame(
        [
            {
                "Player": "Dylan Sampson",
                "Projected Points": 7.6,
                "Team": "CLE",
                "team": "CLE",
                "player_id": "rb-sampson",
                "Position": "RB",
            }
        ]
    )
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Dylan Sampson",
                "player_id": "rb-sampson",
                "team": "CLE",
                "position": "RB",
                "target_share_avg": 0.08,
                "carry_share_avg": 0.42,
            },
            {
                "player_display_name": "Denzel Ward",
                "player_id": "cb-ward",
                "team": "CLE",
                "position": "CB",
                "target_share_avg": 0.40,
                "carry_share_avg": 0.40,
            },
        ]
    )
    snapshot = {
        "injury_snapshot_id": "inj_2026w1_cle_def",
        "built_at": "2026-08-20T00:00:00+00:00",
        "season": 2026,
        "week": 1,
        "players": [
            _snap_player(
                sleeper_id="ward",
                gsis_id="cb-ward",
                full_name="Denzel Ward",
                team="CLE",
                position="CB",
                status="Questionable",
            ),
            _snap_player(
                sleeper_id="graham",
                gsis_id="dt-graham",
                full_name="Mason Graham",
                team="CLE",
                position="DT",
                status="Questionable",
            ),
        ],
    }
    rows = build_overlays_for_teams(
        2026,
        1,
        {"CLE"},
        injury_snapshot=snapshot,
        baseline_df=baseline,
        roster_df=roster,
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["player_id"] == "rb-sampson"
    assert row["opportunity_adjustment"] == 0
    assert row["multiplier"] == 1.0
    assert row["injury_note"] in (None, "")
    assert row["driver_player_ids"] == []


def test_recompute_only_changed_teams(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "src.projections.injury_overlay.INJURY_OVERLAYS_DIR",
        Path(tmp_path) / "overlays",
    )
    monkeypatch.setattr(
        "src.integrations.injury_snapshot.INJURY_SNAPSHOTS_DIR",
        Path(tmp_path) / "snaps",
    )
    invalidate_injury_overlay_cache()

    players_q = {
        "111": {
            "full_name": "Ja'Marr Chase",
            "gsis_id": "00-0036322",
            "team": "CIN",
            "position": "WR",
            "injury_status": "Questionable",
            "practice_participation": "Limited",
            "injury_notes": "Ankle sprain",
            "news_updated": 1_700_000_000_000,
        },
        "222": {
            "full_name": "Isiah Pacheco",
            "gsis_id": "00-kc",
            "team": "KC",
            "position": "RB",
            "injury_status": "Out",
            "practice_participation": "DNP",
            "injury_notes": "Leg",
            "news_updated": 1_700_000_000_000,
        },
    }
    players_out = {
        **players_q,
        "111": {**players_q["111"], "injury_status": "Out"},
    }

    first = recompute_injury_overlays(
        2026,
        1,
        force=True,
        players=players_q,
        baseline_df=BASELINE,
        roster_df=ROSTER,
        previous_snapshot=None,
    )
    assert first["status"] == "ok"
    assert set(first["changed_teams"]) >= {"CIN", "KC"}

    listed = list_injury_overlays(2026, 1)
    assert listed["count"] == 2
    assert listed["injury_snapshot_id"] == first["injury_snapshot_id"]

    # Punctuation-only note change → skip.
    players_punct = {
        **players_q,
        "111": {**players_q["111"], "injury_notes": "Ankle sprain!!!"},
    }
    prev = build_injury_snapshot(season=2026, week=1, players=players_q)
    skipped = recompute_injury_overlays(
        2026,
        1,
        force=True,
        players=players_punct,
        baseline_df=BASELINE,
        roster_df=ROSTER,
        previous_snapshot=prev,
    )
    assert skipped["status"] == "skipped"
    assert skipped["reason"] == "no_material_change"

    # Status change on CIN only → team-scoped recompute.
    prev2 = build_injury_snapshot(season=2026, week=1, players=players_q)
    second = recompute_injury_overlays(
        2026,
        1,
        force=True,
        players=players_out,
        baseline_df=BASELINE,
        roster_df=ROSTER,
        previous_snapshot=prev2,
    )
    assert second["status"] == "ok"
    assert second["changed_teams"] == ["CIN"]
    assert second["recomputed_players"] == 1


def test_debounce_skips_rapid_recompute(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "src.projections.injury_overlay.INJURY_OVERLAYS_DIR",
        Path(tmp_path) / "overlays",
    )
    monkeypatch.setattr(
        "src.integrations.injury_snapshot.INJURY_SNAPSHOTS_DIR",
        Path(tmp_path) / "snaps",
    )
    monkeypatch.setattr("src.projections.injury_overlay.INJURY_OVERLAY_DEBOUNCE_SECONDS", 60)
    invalidate_injury_overlay_cache()

    players_q = {
        "111": {
            "full_name": "Ja'Marr Chase",
            "gsis_id": "00-0036322",
            "team": "CIN",
            "position": "WR",
            "injury_status": "Questionable",
            "practice_participation": "Limited",
            "news_updated": 1_700_000_000_000,
        }
    }
    players_out = {
        "111": {**players_q["111"], "injury_status": "Out"},
    }
    t0 = datetime(2026, 8, 14, 12, 0, 0, tzinfo=timezone.utc)
    first = recompute_injury_overlays(
        2026,
        1,
        force=True,
        players=players_q,
        baseline_df=BASELINE,
        roster_df=ROSTER,
        now=t0,
    )
    assert first["status"] == "ok"

    prev = build_injury_snapshot(season=2026, week=1, players=players_q)
    debounced = recompute_injury_overlays(
        2026,
        1,
        force=False,
        players=players_out,
        baseline_df=BASELINE,
        roster_df=ROSTER,
        previous_snapshot=prev,
        now=t0 + timedelta(seconds=10),
    )
    assert debounced["status"] == "debounced"
    assert debounced["pending_teams"] == ["CIN"]

    forced = recompute_injury_overlays(
        2026,
        1,
        force=True,
        players=players_out,
        baseline_df=BASELINE,
        roster_df=ROSTER,
        previous_snapshot=prev,
        now=t0 + timedelta(seconds=10),
    )
    assert forced["status"] == "ok"
    assert forced["changed_teams"] == ["CIN"]


@pytest.fixture
def client():
    return TestClient(app)


def test_injury_overlay_api_payload(client, tmp_path, monkeypatch):
    monkeypatch.setattr(
        "src.projections.injury_overlay.INJURY_OVERLAYS_DIR",
        Path(tmp_path) / "overlays",
    )
    invalidate_injury_overlay_cache()

    rows = build_overlays_for_teams(
        2026,
        1,
        {"CIN"},
        injury_snapshot=_cin_snapshot(),
        baseline_df=BASELINE,
        roster_df=ROSTER,
    )
    frame = pd.DataFrame(rows)
    meta = {
        "season": 2026,
        "week": 1,
        "injury_snapshot_id": "inj_2026w1_questionable",
        "built_at": "2026-08-14T00:00:00+00:00",
        "last_recompute_at": "2026-08-14T00:00:00+00:00",
        "schema_version": "injury_overlay_v1",
        "changed_teams": ["CIN"],
        "rows": len(rows),
    }
    save_injury_overlay_artifact(2026, 1, frame, meta)

    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {
        "sub": "test",
        "tier": "patron",
    }
    try:
        with patch(
            "src.projections.player_context.season_week_context",
            return_value=(2026, 1),
        ):
            resp = client.get("/api/injury-overlays?season=2026&week=1")
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert body["count"] == 1
            assert body["injury_snapshot_id"] == "inj_2026w1_questionable"
            player = body["players"][0]
            assert player["baseline"] == 14.7
            assert "availability_adjustment" in player
            assert "opportunity_adjustment" in player
            assert "final_delta" in player
            assert player["injury_snapshot_id"] == "inj_2026w1_questionable"

            one = client.get("/api/injury-overlays/wr-higgins?season=2026&week=1")
            assert one.status_code == 200
            assert one.json()["player_id"] == "wr-higgins"

            missing = client.get("/api/injury-overlays/nope?season=2026&week=1")
            assert missing.status_code == 404
    finally:
        app.dependency_overrides.pop(require_patron, None)


def test_health_lists_injury_overlays_feature(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["features"]["injury_overlays"] is True


def test_get_injury_overlay_raises_when_cold(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "src.projections.injury_overlay.INJURY_OVERLAYS_DIR",
        Path(tmp_path) / "empty",
    )
    invalidate_injury_overlay_cache()
    with pytest.raises(FileNotFoundError):
        list_injury_overlays(2026, 1)
