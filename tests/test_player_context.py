"""SCORE-23 cached player-context read model — unit + API tests."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from src.integrations.injury_snapshot import build_injury_snapshot
from src.projections.player_context import (
    build_player_context_rows,
    get_player_context,
    invalidate_player_context_cache,
    list_player_context,
    parse_opportunity_drivers,
    save_player_context_artifact,
    slugify_player_name,
)


def _pool(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


INJ_WR = _pool(
    [
        {
            "Player": "Tee Higgins",
            "Projected Points": 16.8,
            "Low (P10)": 5.0,
            "High (P90)": 30.0,
            "Team": "CIN",
            "Opponent": "BAL",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-higgins",
            "Position": "WR",
            "Injury Boost": 0.15,
            "Injury Note": "Ja'Marr Chase (Questionable)",
            "Injury Status": "",
        },
        {
            "Player": "Quiet WR",
            "Projected Points": 8.0,
            "Low (P10)": 4.0,
            "High (P90)": 12.0,
            "Team": "KC",
            "Opponent": "DEN",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-quiet",
            "Position": "WR",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "Questionable",
        },
    ]
)

BASE_WR = _pool(
    [
        {
            "Player": "Tee Higgins",
            "Projected Points": 14.7,
            "Low (P10)": 4.0,
            "High (P90)": 28.0,
            "Team": "CIN",
            "Opponent": "BAL",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-higgins",
            "Position": "WR",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "",
        },
        {
            "Player": "Quiet WR",
            "Projected Points": 8.0,
            "Low (P10)": 4.0,
            "High (P90)": 12.0,
            "Team": "KC",
            "Opponent": "DEN",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-quiet",
            "Position": "WR",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "",
        },
    ]
)

EMPTY = pd.DataFrame()


def _fake_weekly_load(
    position,
    season=None,
    week=None,
    apply_injury_adjustments=True,
    allow_compute=True,
):
    assert allow_compute is False, "player-context build must not live-predict"
    pos = str(position).lower()
    if pos != "wr":
        return EMPTY.copy()
    return INJ_WR.copy() if apply_injury_adjustments else BASE_WR.copy()


@pytest.fixture
def client():
    return TestClient(app)


def test_slugify_and_parse_drivers():
    assert slugify_player_name("Justin Jefferson") == "justin-jefferson"
    drivers = parse_opportunity_drivers(
        "Ja'Marr Chase (Questionable); Other Guy (Out)",
        name_index={"ja'marr chase": "00-0036322"},
    )
    assert drivers[0] == "00-0036322"
    assert drivers[1] == "other-guy"


def test_build_injury_snapshot_from_players_dict():
    players = {
        "111": {
            "full_name": "Ja'Marr Chase",
            "gsis_id": "00-0036322",
            "team": "CIN",
            "position": "WR",
            "injury_status": "Questionable",
            "practice_participation": "Limited",
            "news_updated": 1_700_000_000_000,
        },
        "222": {
            "full_name": "Healthy Player",
            "gsis_id": "00-0000001",
            "team": "KC",
            "position": "RB",
        },
    }
    snap = build_injury_snapshot(season=2026, week=1, players=players)
    assert snap["injury_snapshot_id"].startswith("inj_2026w1_")
    assert snap["player_count"] == 1
    assert snap["players"][0]["status"] == "Questionable"
    assert snap["players"][0]["practice"] == "Limited"
    assert snap["players"][0]["updated_at"] is not None


@patch("src.projections.player_context._cached_digest_summary", return_value=(None, None))
@patch("src.projections.player_context._load_sentiment_index", return_value={})
@patch("src.projections.player_context.save_injury_snapshot")
@patch("src.projections.player_context.load_weekly_prediction", side_effect=_fake_weekly_load)
def test_build_player_context_schema(_load, _save_snap, _sent, _digest, tmp_path, monkeypatch):
    monkeypatch.setattr(
        "src.projections.player_context.PLAYER_CONTEXT_DIR",
        Path(tmp_path),
    )
    invalidate_player_context_cache()

    snapshot = {
        "injury_snapshot_id": "inj_2026w1_test",
        "built_at": "2026-08-14T00:00:00+00:00",
        "players": [
            {
                "sleeper_id": "s1",
                "gsis_id": "wr-quiet",
                "full_name": "Quiet WR",
                "status": "Questionable",
                "practice": "DNP",
                "updated_at": "2026-08-13T12:00:00+00:00",
            },
            {
                "sleeper_id": "s2",
                "gsis_id": "00-0036322",
                "full_name": "Ja'Marr Chase",
                "status": "Questionable",
                "practice": "Limited",
                "updated_at": "2026-08-13T12:00:00+00:00",
            },
        ],
    }
    rows, meta = build_player_context_rows(
        2026, 1, injury_snapshot=snapshot
    )
    assert meta["injury_snapshot_id"] == "inj_2026w1_test"
    assert meta["rows"] == 2
    by_id = {r["player_id"]: r for r in rows}

    higgins = by_id["wr-higgins"]
    assert higgins["projection"]["base"] == 14.7
    assert higgins["projection"]["final"] == 16.8
    assert higgins["projection"]["injury_delta"] == 2.1
    assert higgins["projection"]["injury_snapshot_id"] == "inj_2026w1_test"
    assert higgins["opportunity_adjustment"]["included"] is True
    assert higgins["opportunity_adjustment"]["points"] == 2.1
    assert "00-0036322" in higgins["opportunity_adjustment"]["drivers"]
    assert higgins["media_context"]["affects_projection"] is False
    assert higgins["media_context"]["state"] == "none"

    quiet = by_id["wr-quiet"]
    assert quiet["availability"]["status"] == "Questionable"
    assert quiet["availability"]["practice"] == "DNP"
    assert quiet["opportunity_adjustment"]["included"] is False

    path = save_player_context_artifact(2026, 1, rows=rows, meta=meta)
    assert path.exists()

    payload = get_player_context("wr-higgins", season=2026, week=1)
    assert payload["projection"]["final"] == 16.8
    assert payload["meta"]["injury_snapshot_id"] == "inj_2026w1_test"

    listed = list_player_context(season=2026, week=1, player_ids=["wr-quiet"])
    assert listed["count"] == 1
    assert listed["players"][0]["player_id"] == "wr-quiet"


@patch("app.api.get_player_context")
def test_player_context_api_shape(mock_get, client):
    mock_get.return_value = {
        "player_id": "wr-higgins",
        "player_name": "Tee Higgins",
        "position": "WR",
        "team": "CIN",
        "projection": {
            "base": 14.7,
            "final": 16.8,
            "injury_delta": 2.1,
            "injury_snapshot_id": "inj_2026w1_abc",
        },
        "availability": {"status": None, "practice": None, "updated_at": None},
        "opportunity_adjustment": {
            "points": 2.1,
            "drivers": ["justin-jefferson"],
            "included": True,
        },
        "media_context": {
            "state": "current",
            "signal": "role_up",
            "source_count": 3,
            "summary": "Role trending up.",
            "updated_at": "2026-08-14T00:00:00+00:00",
            "affects_projection": False,
        },
        "meta": {"season": 2026, "week": 1, "stale": False},
    }

    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {"sub": "test"}
    try:
        res = client.get("/api/player/wr-higgins/context?season=2026&week=1")
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    data = res.json()
    assert data["projection"]["injury_snapshot_id"] == "inj_2026w1_abc"
    assert data["opportunity_adjustment"]["included"] is True
    assert data["media_context"]["affects_projection"] is False
    mock_get.assert_called_once()


def test_player_context_routes_registered():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/player/{player_id}/context" in paths
    assert "/api/players/context" in paths


def test_player_context_requires_auth(client):
    from fastapi import HTTPException

    from app.auth import require_patron

    def _deny():
        raise HTTPException(status_code=401, detail="auth required")

    app.dependency_overrides[require_patron] = _deny
    try:
        res = client.get("/api/player/x/context")
        assert res.status_code == 401
    finally:
        app.dependency_overrides.pop(require_patron, None)


@patch("app.api.get_player_context")
def test_player_context_api_503_when_cold(mock_get, client):
    mock_get.side_effect = FileNotFoundError("artifact missing")
    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {"sub": "test"}
    try:
        res = client.get("/api/player/wr-higgins/context?season=2026&week=1")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 503


@patch("app.api.list_player_context")
def test_players_context_list_api(mock_list, client):
    mock_list.return_value = {
        "count": 1,
        "players": [{"player_id": "wr-higgins", "projection": {"base": 14.7}}],
        "meta": {"season": 2026, "week": 1},
    }
    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {"sub": "test"}
    try:
        res = client.get("/api/players/context?season=2026&week=1&ids=wr-higgins")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    assert res.json()["count"] == 1
    mock_list.assert_called_once()
    kwargs = mock_list.call_args.kwargs
    assert kwargs["player_ids"] == ["wr-higgins"]


def test_serve_path_does_not_call_sleeper_or_predict(tmp_path, monkeypatch):
    """Page-view load must not touch Sleeper, LLM, or live predict."""
    monkeypatch.setattr(
        "src.projections.player_context.PLAYER_CONTEXT_DIR",
        Path(tmp_path),
    )
    invalidate_player_context_cache()

    payload = {
        "player_id": "p1",
        "player_name": "Test",
        "position": "WR",
        "team": "CIN",
        "projection": {
            "base": 10.0,
            "final": 10.0,
            "injury_delta": 0.0,
            "injury_snapshot_id": "inj_2026w1_x",
        },
        "availability": {"status": None, "practice": None, "updated_at": None},
        "opportunity_adjustment": {"points": 0.0, "drivers": [], "included": False},
        "media_context": {
            "state": "none",
            "signal": None,
            "source_count": 0,
            "summary": None,
            "updated_at": None,
            "affects_projection": False,
        },
        "meta": {"season": 2026, "week": 1},
    }
    meta = {
        "season": 2026,
        "week": 1,
        "injury_snapshot_id": "inj_2026w1_x",
        "fingerprint": "deadbeefdeadbeef",
        "built_at": "2026-08-14T00:00:00+00:00",
        "rows": 1,
        "schema_version": "player_context_v1",
    }
    parquet = Path(tmp_path) / "2026_w1.parquet"
    meta_path = Path(tmp_path) / "2026_w1.meta.json"
    pd.DataFrame(
        {
            "player_id": ["p1"],
            "player_name": ["Test"],
            "position": ["WR"],
            "team": ["CIN"],
            "payload_json": [json.dumps(payload)],
        }
    ).to_parquet(parquet, index=False)
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    with (
        patch("src.integrations.sleeper.load_sleeper_players") as sleeper,
        patch("src.projections.predict.predict_upcoming_week") as predict,
        patch(
            "src.projections.player_context.player_context_fingerprint",
            return_value="deadbeefdeadbeef",
        ),
        patch(
            "src.projections.player_context.season_week_context",
            return_value=(2026, 1),
        ),
    ):
        out = get_player_context("p1", season=2026, week=1)
        assert out["player_id"] == "p1"
        sleeper.assert_not_called()
        predict.assert_not_called()
