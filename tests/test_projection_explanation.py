"""SCORE-5 \"Why this projection?\" explanation — unit + API payload tests."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from src.projections.projection_explanation import (
    build_projection_explanation,
    build_projection_signals,
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
            "Opportunity Adjustment": 0.10,
            "Injury Boost": 0.10,
            "Injury Note": "Ja'Marr Chase (Questionable)",
            "Injury Status": "",
            "Opp Def Rank": 24,
            "Opp Def EPA": 0.12,
        },
        {
            "Player": "Quiet WR",
            "Projected Points": 8.0,
            "Low (P10)": 5.0,
            "High (P90)": 11.0,
            "Team": "KC",
            "Opponent": "DEN",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-quiet",
            "Position": "WR",
            "Opportunity Adjustment": 0.0,
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "Questionable",
            "Opp Def Rank": 4,
            "Opp Def EPA": -0.08,
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
            "Opportunity Adjustment": 0.0,
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
            "Opportunity Adjustment": 0.0,
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


def test_build_projection_signals_opportunity_matchup_uncertainty():
    projection = {
        "Opportunity Adjustment": 0.10,
        "Injury Note": "Teammate (Out)",
        "Opponent": "BAL",
        "Opp Def Rank": 24,
        "Opp Def EPA": 0.1,
        "Injury Status": "",
    }
    usage = {
        "share_metric": "target_share_avg",
        "share_value": 0.22,
        "share_percentile": 0.82,
        "feature_season": 2025,
        "feature_week": 18,
    }
    signals = build_projection_signals(
        projection=projection,
        usage=usage,
        p10=4.0,
        p50=14.5,
        p90=28.0,
    )
    by_id = {s["id"]: s for s in signals}
    assert by_id["expected_volume"]["direction"] == "up"
    assert by_id["expected_volume"]["metrics"]["opportunity_adjustment"] == 0.1
    assert "Opportunity adjustment" in by_id["expected_volume"]["detail"]
    assert "Injury Boost" not in by_id["expected_volume"]["detail"]
    assert by_id["recent_usage"]["direction"] == "up"
    assert by_id["game_environment"]["direction"] == "up"
    assert by_id["uncertainty"]["direction"] == "down"
    assert all(s["source"] == "model_context" for s in signals)


def test_build_projection_signals_reads_legacy_injury_boost_alias():
    signals = build_projection_signals(
        projection={"Injury Boost": 0.10, "Injury Note": "", "Opponent": "BAL"},
        usage=None,
        p10=4.0,
        p50=14.5,
        p90=28.0,
    )
    by_id = {s["id"]: s for s in signals}
    assert by_id["expected_volume"]["metrics"]["opportunity_adjustment"] == 0.1
    assert by_id["expected_volume"]["metrics"]["injury_boost"] == 0.1


def test_build_projection_signals_injury_and_tough_matchup():
    projection = {
        "Opportunity Adjustment": 0.0,
        "Opponent": "DEN",
        "Opp Def Rank": 3,
        "Injury Status": "Questionable",
    }
    signals = build_projection_signals(
        projection=projection,
        usage={"share_percentile": 0.2, "share_metric": "target_share_avg", "share_value": 0.08},
        p10=5.0,
        p50=8.0,
        p90=11.0,
    )
    by_id = {s["id"]: s for s in signals}
    assert by_id["injury_status"]["direction"] == "down"
    assert by_id["game_environment"]["direction"] == "down"
    assert by_id["recent_usage"]["direction"] == "down"
    assert "uncertainty" not in by_id  # narrow band


@patch("src.projections.projection_explanation._narrative_from_sentiment")
@patch("src.projections.projection_explanation._load_usage_features", return_value=None)
@patch("src.projections.projection_explanation.season_week_context", return_value=(2026, 1))
@patch("src.projections.projection_explanation.load_weekly_prediction", side_effect=_fake_load)
def test_build_projection_explanation_payload(_load, _ctx, _usage, narrative_fn):
    narrative_fn.return_value = {
        "available": True,
        "label": "Narrative context",
        "disclaimer": "overlay",
        "is_model_input": False,
        "sentiment_label": "hype",
        "sentiment_label_text": "Role hype",
        "sentiment_score": 0.3,
        "sentiment_summary": "Role hype · 12 mentions",
        "role_hype_flag": 1.0,
        "injury_flag": 0.0,
        "mention_count": 12,
        "digest": "Beat reports indicate increased first-team involvement.",
        "digest_source": "extractive",
        "snippet": "first-team",
        "season": 2026,
        "week": 1,
        "context_fallback": False,
    }

    payload = build_projection_explanation("wr-higgins")
    assert payload["player_id"] == "wr-higgins"
    assert payload["player_name"] == "Tee Higgins"
    assert payload["meta"]["season"] == 2026
    assert payload["meta"]["week"] == 1
    assert payload["meta"]["sentiment_is_model_input"] is False
    assert payload["meta"]["projection_movement_available"] is False
    assert payload["projection"]["p50"] == 14.5
    assert payload["projection"]["opportunity_adjustment"] == 0.1
    assert payload["projection"]["injury_boost"] == 0.1  # compat alias
    assert payload["projection"]["opp_def_rank"] == 24
    assert isinstance(payload["projection_signals"], list)
    assert any(s["id"] == "expected_volume" for s in payload["projection_signals"])
    assert payload["narrative_context"]["available"] is True
    assert payload["narrative_context"]["is_model_input"] is False
    assert payload["movement"]["available"] is False


@patch("src.projections.projection_explanation._narrative_from_sentiment")
@patch("src.projections.projection_explanation._load_usage_features", return_value=None)
@patch("src.projections.projection_explanation.season_week_context", return_value=(2026, 1))
@patch("src.projections.projection_explanation.load_weekly_prediction", side_effect=_fake_load)
def test_missing_sentiment_does_not_degrade(_load, _ctx, _usage, narrative_fn):
    narrative_fn.return_value = {
        "available": False,
        "label": "Narrative context",
        "disclaimer": "overlay",
        "is_model_input": False,
        "sentiment_label": None,
        "sentiment_label_text": None,
        "sentiment_score": None,
        "sentiment_summary": None,
        "role_hype_flag": None,
        "injury_flag": None,
        "mention_count": None,
        "digest": None,
        "digest_source": None,
        "snippet": None,
        "season": None,
        "week": None,
        "context_fallback": False,
    }
    payload = build_projection_explanation("wr-quiet")
    assert payload["projection"]["p50"] == 8.0
    assert payload["narrative_context"]["available"] is False
    assert any(s["id"] == "injury_status" for s in payload["projection_signals"])


@patch("src.projections.projection_explanation.season_week_context", return_value=(2026, 1))
@patch("src.projections.projection_explanation.load_weekly_prediction", side_effect=_fake_load)
def test_unknown_player_raises(_load, _ctx):
    with pytest.raises(ValueError, match="No weekly projection"):
        build_projection_explanation("missing-id")


def test_explanation_route_registered():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/player/{player_id}/explanation" in paths


def test_health_includes_projection_explanation_feature():
    from app.api import health

    payload = health()
    assert payload["features"]["projection_explanation"] is True


def test_explanation_api_payload():
    def _patron():
        return {"sub": "test-explanation"}

    from app.auth import require_patron

    app.dependency_overrides[require_patron] = _patron
    client = TestClient(app)
    try:
        with (
            patch(
                "src.projections.projection_explanation.season_week_context",
                return_value=(2026, 1),
            ),
            patch(
                "src.projections.projection_explanation.load_weekly_prediction",
                side_effect=_fake_load,
            ),
            patch(
                "src.projections.projection_explanation._load_usage_features",
                return_value=None,
            ),
            patch(
                "src.projections.projection_explanation._narrative_from_sentiment",
                return_value={
                    "available": False,
                    "label": "Narrative context",
                    "disclaimer": "overlay",
                    "is_model_input": False,
                    "sentiment_label": None,
                    "sentiment_label_text": None,
                    "sentiment_score": None,
                    "sentiment_summary": None,
                    "role_hype_flag": None,
                    "injury_flag": None,
                    "mention_count": None,
                    "digest": None,
                    "digest_source": None,
                    "snippet": None,
                    "season": None,
                    "week": None,
                    "context_fallback": False,
                },
            ),
        ):
            res = client.get(
                "/api/player/wr-higgins/explanation",
                params={"season": 2026, "week": 1, "position": "wr"},
            )
    finally:
        app.dependency_overrides.pop(require_patron, None)

    assert res.status_code == 200
    data = res.json()
    assert data["player_id"] == "wr-higgins"
    assert data["projection"]["p50"] == 14.5
    assert data["projection"]["opportunity_adjustment"] == 0.1
    assert "projection_signals" in data
    assert data["meta"]["sentiment_is_model_input"] is False
    assert data["narrative_context"]["is_model_input"] is False
    assert data["movement"]["available"] is False


def test_explanation_api_rejects_unknown_player():
    def _patron():
        return {"sub": "test-explanation"}

    from app.auth import require_patron

    app.dependency_overrides[require_patron] = _patron
    client = TestClient(app)
    try:
        with (
            patch(
                "src.projections.projection_explanation.season_week_context",
                return_value=(2026, 1),
            ),
            patch(
                "src.projections.projection_explanation.load_weekly_prediction",
                side_effect=_fake_load,
            ),
        ):
            res = client.get("/api/player/does-not-exist/explanation")
    finally:
        app.dependency_overrides.pop(require_patron, None)

    assert res.status_code == 400
