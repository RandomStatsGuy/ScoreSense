"""API sentiment route registration and empty parquet handling."""

from src.sentiment.fantasy_readout import build_fantasy_season_response, build_fantasy_weekly_response
from src.sentiment.readout import build_sentiment_response


def test_sentiment_route_registered():
    from app.api import app

    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/sentiment/{position}" in paths
    assert "/api/fantasy-narrative/{position}/weekly" in paths
    assert "/api/fantasy-narrative/{position}/season" in paths


def test_build_fantasy_weekly_response_empty():
    response = build_fantasy_weekly_response("qb", season=2099, week=1)
    assert response["count"] == 0
    assert response["players"] == []
    assert response["scope"] == "weekly"
    assert "beat_writers_by_team" not in response["meta"]


def test_build_fantasy_season_response_empty():
    response = build_fantasy_season_response("qb", season=2099, week=1)
    assert response["count"] == 0
    assert response["scope"] == "season"
    assert "beat_writers_by_team" not in response["meta"]


def test_build_sentiment_response_empty():
    response = build_sentiment_response("qb", season=2099, week=1)
    assert response["count"] == 0
    assert response["players"] == []
    assert response["context_fallback"] is False
    assert response["requested_season"] == 2099
    assert "note" in response["meta"]
    assert "sources" in response["meta"]
    assert "beat_writers_by_team" in response["meta"]
    assert len(response["meta"]["beat_writers_by_team"]) == 32


def test_build_sentiment_response_2026_week1():
    response = build_sentiment_response("qb", season=2026, week=1)
    if response["count"] > 0:
        assert response["context_fallback"] is False
        assert response["requested_season"] == 2026
        assert response["requested_week"] == 1
        assert response["season"] == 2026
        assert response["week"] == 1
        assert all(not str(p["player"]).startswith("00-") for p in response["players"])
        assert response["players"][0].get("beat_digest_source") in (
            "extractive",
            "template",
            "llm",
            "cache",
            None,
        )
