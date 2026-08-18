"""SCORE-7 / SCORE-48 projection movement / What Changed — unit + API tests."""

from __future__ import annotations

import math
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from src.projections.projection_movement import (
    SCHEMA_VERSION,
    build_projection_movement_payload,
    build_projection_movement_rows,
    invalidate_projection_movement_cache,
    load_projection_movement,
    movement_index_by_player_id,
    save_projection_movement_artifact,
)
from src.projections.weekly_cache import invalidate_weekly_cache, save_weekly_artifact


def _pool(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


PREV_RB = _pool(
    [
        {
            "Player": "Riser RB",
            "Projected Points": 10.0,
            "Low (P10)": 4.0,
            "High (P90)": 16.0,
            "Team": "CHI",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-riser",
            "Position": "RB",
        },
        {
            "Player": "Faller RB",
            "Projected Points": 18.0,
            "Low (P10)": 8.0,
            "High (P90)": 28.0,
            "Team": "SF",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-faller",
            "Position": "RB",
        },
        {
            "Player": "Stable RB",
            "Projected Points": 12.0,
            "Low (P10)": 6.0,
            "High (P90)": 18.0,
            "Team": "KC",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-stable",
            "Position": "RB",
        },
    ]
)

CURR_RB = _pool(
    [
        {
            "Player": "Riser RB",
            "Projected Points": 16.5,  # +6.5, rank 3 → 1
            "Low (P10)": 7.0,
            "High (P90)": 26.0,
            "Team": "CHI",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-riser",
            "Position": "RB",
        },
        {
            "Player": "Faller RB",
            "Projected Points": 11.0,  # -7.0, rank 1 → 3
            "Low (P10)": 5.0,
            "High (P90)": 18.0,
            "Team": "SF",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-faller",
            "Position": "RB",
        },
        {
            "Player": "Stable RB",
            "Projected Points": 12.2,  # +0.2 — not material by p50 alone
            "Low (P10)": 6.0,
            "High (P90)": 18.0,
            "Team": "KC",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-stable",
            "Position": "RB",
        },
    ]
)


@pytest.fixture(autouse=True)
def _clear_caches(tmp_path, monkeypatch):
    weekly_dir = tmp_path / "weekly_predictions"
    changes_dir = tmp_path / "weekly_projection_changes"
    weekly_dir.mkdir()
    changes_dir.mkdir()
    monkeypatch.setattr("src.config.WEEKLY_PREDICTIONS_DIR", weekly_dir)
    monkeypatch.setattr("src.config.WEEKLY_PROJECTION_CHANGES_DIR", changes_dir)
    monkeypatch.setattr(
        "src.projections.weekly_cache.WEEKLY_PREDICTIONS_DIR", weekly_dir
    )
    monkeypatch.setattr(
        "src.projections.projection_movement.WEEKLY_PREDICTIONS_DIR", weekly_dir
    )
    monkeypatch.setattr(
        "src.projections.projection_movement.WEEKLY_PROJECTION_CHANGES_DIR", changes_dir
    )
    invalidate_weekly_cache()
    invalidate_projection_movement_cache()
    yield
    invalidate_weekly_cache()
    invalidate_projection_movement_cache()


def test_build_rows_rank_and_p50_deltas():
    rows = build_projection_movement_rows(
        PREV_RB, CURR_RB, season=2026, week=1, position="rb"
    )
    by_id = {r["player_id"]: r for r in rows.to_dict(orient="records")}

    riser = by_id["rb-riser"]
    assert riser["previous_rank"] == 3
    assert riser["current_rank"] == 1
    assert riser["rank_delta"] == 2  # rose 2 spots (not material by rank alone)
    assert riser["p50_delta"] == pytest.approx(6.5)
    assert riser["material"] is True  # |p50| >= 1.5
    assert riser["slate_status"] == "stayed"

    faller = by_id["rb-faller"]
    assert faller["previous_rank"] == 1
    assert faller["current_rank"] == 3
    assert faller["rank_delta"] == -2
    assert faller["p50_delta"] == pytest.approx(-7.0)
    assert faller["material"] is True
    assert faller["slate_status"] == "stayed"

    stable = by_id["rb-stable"]
    assert stable["previous_rank"] == 2
    assert stable["current_rank"] == 2
    assert stable["rank_delta"] == 0
    assert stable["p50_delta"] == pytest.approx(0.2)
    assert stable["material"] is False
    assert stable["slate_status"] == "stayed"


def test_left_slate_players_are_material_fallers():
    """SCORE-48: players who leave the weekly slate appear as removed fallers."""
    curr_without_faller = CURR_RB[CURR_RB["player_id"] != "rb-faller"].copy()
    rows = build_projection_movement_rows(
        PREV_RB, curr_without_faller, season=2026, week=1, position="rb"
    )
    by_id = {r["player_id"]: r for r in rows.to_dict(orient="records")}
    assert "rb-faller" in by_id
    left = by_id["rb-faller"]
    assert left["slate_status"] == "left"
    assert pd.isna(left["current_rank"]) or left["current_rank"] is None
    assert left["current_p50"] is None or (
        isinstance(left["current_p50"], float) and math.isnan(left["current_p50"])
    )
    assert left["previous_rank"] == 1
    assert left["material"] is True
    assert left["rank_delta"] is not None and left["rank_delta"] < 0
    assert left["p50_delta"] == pytest.approx(-18.0)

    save_projection_movement_artifact(
        "rb",
        2026,
        1,
        True,
        curr_without_faller,
        previous_df=PREV_RB,
        previous_meta={"fingerprint": "prev"},
        current_fingerprint="curr",
    )
    payload = build_projection_movement_payload("rb", 2026, 1, material_only=True)
    assert payload["available"] is True
    assert payload["empty_reason"] is None
    left_change = next(c for c in payload["changes"] if c["player_id"] == "rb-faller")
    assert left_change["slate_status"] == "left"
    # Soft-join index excludes leavers (not on current slate).
    idx = movement_index_by_player_id("rb", 2026, 1)
    assert "rb-faller" not in idx
    assert "rb-riser" in idx


def test_first_artifact_unavailable():
    path = save_projection_movement_artifact(
        "rb",
        2026,
        1,
        True,
        CURR_RB,
        previous_df=None,
        previous_meta=None,
        current_fingerprint="curr-fp",
    )
    assert path.exists()
    df, meta = load_projection_movement("rb", 2026, 1, apply_injury_adjustments=True)
    assert meta["available"] is False
    assert meta["empty_reason"] == "no_prior_snapshot"
    assert meta["schema_version"] == SCHEMA_VERSION
    assert df.empty
    payload = build_projection_movement_payload("rb", 2026, 1)
    assert payload["available"] is False
    assert payload["empty_reason"] == "no_prior_snapshot"
    assert payload["changes"] == []
    assert payload["meta"]["note"]


def test_save_and_load_movement_artifact():
    save_projection_movement_artifact(
        "rb",
        2026,
        1,
        True,
        CURR_RB,
        previous_df=PREV_RB,
        previous_meta={"fingerprint": "prev-fp", "built_at": "2026-01-01T00:00:00+00:00"},
        current_fingerprint="curr-fp",
        current_built_at="2026-01-02T00:00:00+00:00",
    )
    payload = build_projection_movement_payload("rb", 2026, 1, material_only=True)
    assert payload["available"] is True
    assert payload["empty_reason"] is None
    assert payload["count"] >= 2
    ids = {c["player_id"] for c in payload["changes"]}
    assert "rb-riser" in ids
    assert "rb-faller" in ids
    assert "rb-stable" not in ids  # filtered by material_only

    idx = movement_index_by_player_id("rb", 2026, 1)
    assert idx["rb-riser"]["rank_delta"] == 2
    assert idx["rb-riser"]["p50_delta"] == pytest.approx(6.5)
    assert idx["rb-riser"]["slate_status"] == "stayed"


def test_save_weekly_artifact_writes_movement(tmp_path):
    with patch("src.projections.weekly_cache.weekly_fingerprint", return_value="fp-v1"):
        save_weekly_artifact("rb", 2026, 1, True, PREV_RB)
    # First write → unavailable baseline
    payload = build_projection_movement_payload("rb", 2026, 1)
    assert payload["available"] is False
    assert payload["empty_reason"] == "no_prior_snapshot"

    with patch("src.projections.weekly_cache.weekly_fingerprint", return_value="fp-v2"):
        save_weekly_artifact("rb", 2026, 1, True, CURR_RB)
    invalidate_projection_movement_cache()
    payload = build_projection_movement_payload("rb", 2026, 1)
    assert payload["available"] is True
    riser = next(c for c in payload["changes"] if c["player_id"] == "rb-riser")
    assert riser["previous_rank"] == 3
    assert riser["current_rank"] == 1
    assert riser["p50_delta"] == pytest.approx(6.5)


def test_same_weekly_fingerprint_still_rewrites_on_content_change():
    """SCORE-48: force refresh can change projections without bumping weekly fp."""
    with patch("src.projections.weekly_cache.weekly_fingerprint", return_value="fp-same"):
        save_weekly_artifact("rb", 2026, 1, True, PREV_RB)
        payload = build_projection_movement_payload("rb", 2026, 1)
        assert payload["available"] is False

        # Content changes, weekly fingerprint unchanged — must still emit movement.
        save_weekly_artifact("rb", 2026, 1, True, CURR_RB)
    invalidate_projection_movement_cache()
    payload = build_projection_movement_payload("rb", 2026, 1)
    assert payload["available"] is True
    assert payload["empty_reason"] is None
    assert payload["count"] >= 2
    riser = next(c for c in payload["changes"] if c["player_id"] == "rb-riser")
    assert riser["rank_delta"] == 2
    assert riser["p50_delta"] == pytest.approx(6.5)


def test_identical_content_skips_movement_rewrite():
    with patch("src.projections.weekly_cache.weekly_fingerprint", return_value="fp-a"):
        save_weekly_artifact("rb", 2026, 1, True, PREV_RB)
        save_weekly_artifact("rb", 2026, 1, True, CURR_RB)
    invalidate_projection_movement_cache()
    first = build_projection_movement_payload("rb", 2026, 1)
    generated = first["meta"]["generated_at"]

    with patch("src.projections.weekly_cache.weekly_fingerprint", return_value="fp-a"):
        save_weekly_artifact("rb", 2026, 1, True, CURR_RB.copy())
    invalidate_projection_movement_cache()
    second = build_projection_movement_payload("rb", 2026, 1)
    assert second["available"] is True
    assert second["meta"]["generated_at"] == generated


def test_no_material_empty_reason():
    tiny_prev = _pool(
        [
            {
                "Player": "A",
                "Projected Points": 10.0,
                "Low (P10)": 4.0,
                "High (P90)": 16.0,
                "Team": "CHI",
                "Week": 1,
                "Season": 2026,
                "player_id": "a",
                "Position": "RB",
            },
            {
                "Player": "B",
                "Projected Points": 9.0,
                "Low (P10)": 3.0,
                "High (P90)": 15.0,
                "Team": "SF",
                "Week": 1,
                "Season": 2026,
                "player_id": "b",
                "Position": "RB",
            },
        ]
    )
    tiny_curr = _pool(
        [
            {
                "Player": "A",
                "Projected Points": 10.2,  # +0.2 — not material
                "Low (P10)": 4.0,
                "High (P90)": 16.0,
                "Team": "CHI",
                "Week": 1,
                "Season": 2026,
                "player_id": "a",
                "Position": "RB",
            },
            {
                "Player": "B",
                "Projected Points": 8.9,  # -0.1 — not material
                "Low (P10)": 3.0,
                "High (P90)": 15.0,
                "Team": "SF",
                "Week": 1,
                "Season": 2026,
                "player_id": "b",
                "Position": "RB",
            },
        ]
    )
    save_projection_movement_artifact(
        "rb",
        2026,
        1,
        True,
        tiny_curr,
        previous_df=tiny_prev,
        previous_meta={"fingerprint": "prev"},
        current_fingerprint="curr",
    )
    full = build_projection_movement_payload("rb", 2026, 1)
    assert full["available"] is True
    assert full["count"] == 2
    material = build_projection_movement_payload("rb", 2026, 1, material_only=True)
    assert material["available"] is True
    assert material["count"] == 0
    assert material["empty_reason"] == "no_material_moves"


def test_missing_movement_never_breaks_predict(client_overrides):
    """Predict endpoint stays healthy when movement artifact is absent."""
    with patch("app.api.load_weekly_prediction", return_value=CURR_RB.copy()), patch(
        "app.api._warm_weekly_artifact"
    ):
        client = TestClient(app)
        res = client.get("/api/predict/rb?season=2026&week=1")
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 3
    assert body["meta"].get("projection_movement", {}).get("available") is False
    assert body["meta"]["projection_movement"].get("empty_reason") == "artifact_missing"


@pytest.fixture
def client_overrides(monkeypatch):
    """Disable auth for API tests."""
    from app import auth as auth_mod

    def _allow():
        return {"user_id": "test", "email": "t@example.com"}

    app.dependency_overrides[auth_mod.require_patron] = _allow
    yield
    app.dependency_overrides.pop(auth_mod.require_patron, None)


def test_changes_endpoint_payload(client_overrides):
    save_projection_movement_artifact(
        "rb",
        2026,
        1,
        True,
        CURR_RB,
        previous_df=PREV_RB,
        previous_meta={"fingerprint": "prev", "built_at": "t0"},
        current_fingerprint="curr",
    )
    client = TestClient(app)
    with patch(
        "src.core.projection_context.resolve_projection_context",
        return_value=(2026, 1),
    ):
        res = client.get(
            "/api/predict/rb/changes?season=2026&week=1&material_only=true"
        )
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body["position"] == "rb"
    assert body["count"] >= 2
    assert all(c["material"] for c in body["changes"])
    assert "fingerprint" in body["meta"]
    assert body["meta"]["schema_version"] == SCHEMA_VERSION


def test_health_feature_flag(client_overrides):
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["features"]["projection_movement"] is True


def test_predict_soft_joins_movement_fields(client_overrides):
    save_projection_movement_artifact(
        "rb",
        2026,
        1,
        True,
        CURR_RB,
        previous_df=PREV_RB,
        previous_meta={"fingerprint": "prev"},
        current_fingerprint="curr",
    )
    with patch("app.api.load_weekly_prediction", return_value=CURR_RB.copy()), patch(
        "app.api._warm_weekly_artifact"
    ):
        client = TestClient(app)
        res = client.get("/api/predict/rb?season=2026&week=1")
    assert res.status_code == 200
    body = res.json()
    assert body["meta"]["projection_movement"]["available"] is True
    assert body["meta"]["projection_movement"].get("empty_reason") is None
    assert body["meta"]["projection_movement"].get("material_rows", 0) >= 2
    by_id = {p["player_id"]: p for p in body["projections"]}
    assert by_id["rb-riser"]["rank_delta"] == 2
    assert by_id["rb-riser"]["p50_delta"] == pytest.approx(6.5)
    assert by_id["rb-riser"]["previous_rank"] == 3
    assert by_id["rb-riser"]["slate_status"] == "stayed"
