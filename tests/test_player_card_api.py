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
        "injury": None,
        "meta": {"season": 2025, "week": 10, "scope": "weekly"},
    }

    def _patron():
        return {"sub": "test"}

    app.dependency_overrides.clear()
    from app.auth import require_patron

    app.dependency_overrides[require_patron] = _patron
    try:
        res = client.get("/api/player/12345/card?season=2025&week=10")
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
