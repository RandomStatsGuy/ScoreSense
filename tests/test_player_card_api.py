"""Tests for GET /api/player/{player_id}/card."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api import app


@pytest.fixture
def client():
    return TestClient(app)


def test_player_card_requires_auth(client):
    from fastapi import HTTPException

    from app.auth import require_patron

    def _deny():
        raise HTTPException(status_code=401, detail="auth required")

    app.dependency_overrides[require_patron] = _deny
    try:
        res = client.get("/api/player/12345/card")
        assert res.status_code == 401
    finally:
        app.dependency_overrides.pop(require_patron, None)


def test_player_card_route_registered():
    from app.api import app

    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/player/{player_id}/card" in paths


@patch("src.projections.player_card.build_player_card")
def test_player_card_shape(mock_build, client):
    mock_build.return_value = {
        "player_id": "12345",
        "player_name": "Test Player",
        "position": "wr",
        "team": "KC",
        "media": {"headshot_url": None, "team": "KC"},
        "weekly_projection": {"Player": "Test Player", "Projected Points": 12.5},
        "season_projection": None,
        "narrative": None,
        "narrative_meta": {"context_fallback": False},
        "injury": None,
        "meta": {
            "season": 2025,
            "week": 10,
            "scope": "weekly",
            "apply_injury_adjustments": False,
        },
    }

    def _patron():
        return {"sub": "test"}

    app.dependency_overrides.clear()
    from app.auth import require_patron

    app.dependency_overrides[require_patron] = _patron
    try:
        res = client.get(
            "/api/player/12345/card?season=2025&week=10&apply_injury_adjustments=false"
        )
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    data = res.json()
    assert data["player_id"] == "12345"
    assert data["player_name"] == "Test Player"
    assert data["weekly_projection"]["Projected Points"] == 12.5
    assert data["narrative"] is None
    assert data["meta"]["scope"] == "weekly"
    mock_build.assert_called_once()
    kwargs = mock_build.call_args.kwargs
    assert kwargs["season"] == 2025
    assert kwargs["week"] == 10
    assert kwargs["apply_injury_adjustments"] is False


def test_build_player_card_honors_injury_flag(monkeypatch):
    """Card weekly numbers must use the same injury flag as the table/compare."""
    import pandas as pd

    import src.projections.player_card as pc

    calls = []

    def fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True):
        calls.append((position, season, week, apply_injury_adjustments))
        return pd.DataFrame(
            [
                {
                    "player_id": "00-0033873",
                    "Player": "Lamar Jackson",
                    "Team": "BAL",
                    "Position": "QB",
                    "Projected Points": 23.1 if not apply_injury_adjustments else 29.8,
                    "Low (P10)": 18.0,
                    "High (P90)": 35.0,
                }
            ]
        )

    monkeypatch.setattr(pc, "load_weekly_prediction", fake_load)
    monkeypatch.setattr(
        pc,
        "load_ros_prediction",
        lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError("no ros")),
    )
    monkeypatch.setattr(pc, "_resolve_context", lambda s, w: (2026, 2))
    monkeypatch.setattr(pc, "_guess_position", lambda _pid: "qb")
    monkeypatch.setattr(pc, "build_player_media_batch", lambda _rows: {})
    monkeypatch.setattr(pc, "_narrative_for_player", lambda *a, **k: (None, {"context_fallback": False}))
    monkeypatch.setattr(pc, "_injury_for_player", lambda _pid: None)

    card = pc.build_player_card(
        "00-0033873",
        season=2026,
        week=2,
        position="qb",
        apply_injury_adjustments=False,
    )
    assert card["weekly_projection"]["Projected Points"] == 23.1
    assert card["meta"]["apply_injury_adjustments"] is False
    assert calls
    assert all(flag is False for _pos, _season, _week, flag in calls)


def test_narrative_for_player_weekly_no_silent_historical(monkeypatch):
    """Weekly card narrative stays on requested week unless include_historical."""
    import src.projections.player_card as pc

    calls = []

    def fake_weekly(pos, season, week, include_historical=False):
        calls.append((pos, season, week, include_historical))
        return {
            "season": season,
            "week": week,
            "requested_season": season,
            "requested_week": week,
            "context_fallback": False,
            "media_context": {
                "state": "historical_available",
                "historical": {"season": 2025, "week": 18},
                "summary": None,
                "signal": None,
                "source_count": 0,
                "updated_at": None,
                "affects_projection": False,
            },
            "players": [],
        }

    monkeypatch.setattr(pc, "build_fantasy_weekly_response", fake_weekly)

    row, meta = pc._narrative_for_player("qb1", "qb", 2026, 1, "weekly")
    assert calls == [("qb", 2026, 1, False)]
    assert row is None
    assert meta["season"] == 2026
    assert meta["week"] == 1
    assert meta["context_fallback"] is False
    assert meta["media_context"]["state"] == "historical_available"


def test_narrative_for_player_weekly_include_historical(monkeypatch):
    import src.projections.player_card as pc

    def fake_weekly(pos, season, week, include_historical=False):
        assert include_historical is True
        return {
            "season": 2025,
            "week": 18,
            "requested_season": season,
            "requested_week": week,
            "context_fallback": True,
            "media_context": {
                "state": "historical_available",
                "historical": {"season": 2025, "week": 18},
            },
            "players": [{"player_id": "qb1", "player": "Test QB"}],
        }

    monkeypatch.setattr(pc, "build_fantasy_weekly_response", fake_weekly)

    row, meta = pc._narrative_for_player(
        "qb1", "qb", 2026, 1, "weekly", include_historical=True
    )
    assert row["player_id"] == "qb1"
    assert meta["season"] == 2025
    assert meta["week"] == 18
    assert meta["context_fallback"] is True
    assert meta["requested_season"] == 2026
    assert meta["requested_week"] == 1


def test_player_card_json_serializable():
    import json

    import numpy as np
    import pandas as pd

    from src.projections.player_card import _row_dict, _sanitize

    row = pd.Series({"Player": "Test", "Season": np.int64(2026), "Week": np.int64(1), "Projected Points": 12.5})
    payload = _sanitize({"weekly_projection": _row_dict(row), "meta": {"season": 2026, "week": 1}})
    json.dumps(payload)
    assert payload["weekly_projection"]["Season"] == 2026
    assert isinstance(payload["weekly_projection"]["Season"], int)
