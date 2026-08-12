"""SCORE-4 start/sit player comparison — unit + API payload tests."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app, _predict_response
from src.projections.player_compare import (
    build_player_compare,
    build_recommendation,
    filter_projections_by_ids,
    parse_compare_player_ids,
    position_rank_map,
    validate_compare_player_ids,
    volatility,
)


def _pool(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


WR_POOL = _pool(
    [
        {
            "Player": "Tee Higgins",
            "Projected Points": 14.5,
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
            "Player": "Zay Flowers",
            "Projected Points": 12.6,
            "Low (P10)": 5.5,
            "High (P90)": 22.0,
            "Team": "BAL",
            "Opponent": "CIN",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-flowers",
            "Position": "WR",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "",
        },
        {
            "Player": "Other WR",
            "Projected Points": 8.0,
            "Low (P10)": 2.0,
            "High (P90)": 15.0,
            "Team": "KC",
            "Opponent": "DEN",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-other",
            "Position": "WR",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "",
        },
    ]
)

RB_POOL = _pool(
    [
        {
            "Player": "RB One",
            "Projected Points": 16.0,
            "Low (P10)": 6.0,
            "High (P90)": 26.0,
            "Team": "SF",
            "Opponent": "SEA",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-one",
            "Position": "RB",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "",
        }
    ]
)

QB_POOL = _pool(
    [
        {
            "Player": "QB One",
            "Projected Points": 20.0,
            "Low (P10)": 12.0,
            "High (P90)": 30.0,
            "Team": "BUF",
            "Opponent": "MIA",
            "Week": 1,
            "Season": 2026,
            "player_id": "qb-one",
            "Position": "QB",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "",
        }
    ]
)


def _fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True):
    pos = position.lower()
    if pos == "wr":
        return WR_POOL.copy()
    if pos == "rb":
        return RB_POOL.copy()
    if pos == "qb":
        return QB_POOL.copy()
    return pd.DataFrame()


def test_parse_and_validate_ids():
    assert parse_compare_player_ids("a, b, a, ,c") == ["a", "b", "c"]
    with pytest.raises(ValueError):
        validate_compare_player_ids(["only-one"])
    with pytest.raises(ValueError):
        validate_compare_player_ids(["1", "2", "3", "4", "5"])


def test_volatility_and_ranks():
    assert volatility(4.0, 10.0, 20.0) == pytest.approx(0.8)
    ranks = position_rank_map(WR_POOL)
    assert ranks["wr-higgins"] == 1
    assert ranks["wr-flowers"] == 2
    assert ranks["wr-other"] == 3


def test_recommendation_language():
    players = [
        {"player_id": "wr-higgins", "player_name": "Tee Higgins", "p10": 4.0, "p50": 14.5, "p90": 28.0},
        {"player_id": "wr-flowers", "player_name": "Zay Flowers", "p10": 5.5, "p50": 12.6, "p90": 22.0},
    ]
    lines = build_recommendation(players)
    assert lines[0] == "P50 favors Tee Higgins by +1.9 points"
    assert "Higher floor: Zay Flowers" in lines
    assert "Higher ceiling: Tee Higgins" in lines


@patch("src.projections.player_compare.season_week_context", return_value=(2026, 1))
@patch("src.projections.player_compare.load_weekly_prediction", side_effect=_fake_load)
def test_build_player_compare_payload(_load, _ctx):
    payload = build_player_compare(["wr-higgins", "wr-flowers"])
    assert payload["count"] == 2
    assert payload["meta"]["season"] == 2026
    assert payload["meta"]["week"] == 1
    assert payload["missing_player_ids"] == []

    by_id = {p["player_id"]: p for p in payload["players"]}
    assert by_id["wr-higgins"]["p50"] == 14.5
    assert by_id["wr-flowers"]["p10"] == 5.5
    assert by_id["wr-higgins"]["position_rank"] == 1
    assert by_id["wr-flowers"]["opponent"] == "CIN"
    assert by_id["wr-higgins"]["spread"] == 24.0
    assert by_id["wr-higgins"]["volatility"] == pytest.approx((28.0 - 4.0) / (2 * 14.5), rel=1e-3)

    cmp_ = payload["comparison"]
    assert cmp_["highest_median"]["player_id"] == "wr-higgins"
    assert cmp_["highest_floor"]["player_id"] == "wr-flowers"
    assert cmp_["highest_ceiling"]["player_id"] == "wr-higgins"
    assert cmp_["flex_compatible"] is True
    assert cmp_["recommendation"][0].startswith("P50 favors Tee Higgins")
    assert cmp_["deltas"][0]["diff"] == pytest.approx(1.9)


@patch("src.projections.player_compare.season_week_context", return_value=(2026, 1))
@patch("src.projections.player_compare.load_weekly_prediction", side_effect=_fake_load)
def test_flex_compatible_rb_wr(_load, _ctx):
    payload = build_player_compare(["rb-one", "wr-higgins"])
    assert payload["comparison"]["flex_compatible"] is True


@patch("src.projections.player_compare.season_week_context", return_value=(2026, 1))
@patch("src.projections.player_compare.load_weekly_prediction", side_effect=_fake_load)
def test_qb_skill_not_flex_compatible(_load, _ctx):
    payload = build_player_compare(["qb-one", "wr-higgins"])
    assert payload["comparison"]["flex_compatible"] is False


def test_filter_projections_preserves_order():
    rows = [{"player_id": "a"}, {"player_id": "b"}, {"player_id": "c"}]
    assert filter_projections_by_ids(rows, ["c", "a"]) == [{"player_id": "c"}, {"player_id": "a"}]


def test_compare_route_registered():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/predict/compare" in paths


def test_health_includes_player_compare_feature():
    from app.api import health

    payload = health()
    assert payload["features"]["player_compare"] is True


def test_predict_compare_api():
    def _patron():
        return {"sub": "test-compare"}

    from app.auth import require_patron

    app.dependency_overrides[require_patron] = _patron
    client = TestClient(app)
    try:
        with (
            patch("src.projections.player_compare.season_week_context", return_value=(2026, 1)),
            patch("src.projections.player_compare.load_weekly_prediction", side_effect=_fake_load),
        ):
            res = client.get(
                "/api/predict/compare",
                params={"ids": "wr-higgins,wr-flowers", "season": 2026, "week": 1},
            )
    finally:
        app.dependency_overrides.pop(require_patron, None)

    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 2
    assert data["comparison"]["highest_median"]["player_id"] == "wr-higgins"
    assert len(data["comparison"]["recommendation"]) >= 3


def test_predict_compare_rejects_single_id():
    def _patron():
        return {"sub": "test-compare"}

    from app.auth import require_patron

    app.dependency_overrides[require_patron] = _patron
    client = TestClient(app)
    try:
        res = client.get("/api/predict/compare", params={"ids": "wr-higgins"})
    finally:
        app.dependency_overrides.pop(require_patron, None)
    assert res.status_code == 400


@patch("app.api.load_weekly_prediction", side_effect=_fake_load)
def test_predict_response_filters_by_player_ids(_load):
    response = _predict_response(
        "wr",
        season=2026,
        week=1,
        apply_injury_adjustments=True,
        player_ids=["wr-flowers", "wr-higgins"],
    )
    assert response["count"] == 2
    assert [r["player_id"] for r in response["projections"]] == ["wr-flowers", "wr-higgins"]
    assert response["meta"]["filtered_player_ids"] == ["wr-flowers", "wr-higgins"]
