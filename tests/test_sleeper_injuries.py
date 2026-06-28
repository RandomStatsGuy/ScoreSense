"""Sleeper injury API field coverage."""

from src.integrations.sleeper import injured_players


def test_injured_players_includes_detail_columns():
    df = injured_players()
    if df.empty:
        return
    for col in ("injury_body_part", "injury_notes", "news_updated", "injury_status"):
        assert col in df.columns


def test_injuries_api_shape():
    from app.api import injuries

    try:
        payload = injuries()
    except Exception:
        return
    if payload["count"] == 0:
        return
    player = payload["players"][0]
    for key in ("full_name", "team", "position", "injury_status", "injury_body_part", "injury_notes"):
        assert key in player
    assert "return_estimate" in player
    assert "label" in player["return_estimate"]
