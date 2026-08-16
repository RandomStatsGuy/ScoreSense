"""SCORE-29: fantasy media digests are not aliased as beat_digest."""

from __future__ import annotations

import pandas as pd
import pytest

from src.draft_hub.draft_enrichment import fantasy_media_digest_single
from src.sentiment.fantasy_readout import build_fantasy_weekly_response


def _fantasy_features() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "player_id": "p1",
                "season": 2026,
                "week": 1,
                "team": "KC",
                "position": "QB",
                "yt_mention_count": 4.0,
                "yt_sentiment_score": 0.3,
                "yt_injury_flag": 0.0,
                "yt_role_hype_flag": 1.0,
                "yt_top_snippet": "Mahomes looks locked in for week 1.",
                "yt_top_sentence": "Mahomes looks locked in for week 1.",
                "yt_chapter_notes": "00:12 Role locked; usage up",
                "yt_fantasy_footballers_mentions": 3.0,
                "yt_late_round_mentions": 1.0,
                "yt_fantasypros_mentions": 0.0,
                "yt_playerprofiler_mentions": 0.0,
                "yt_establish_the_run_mentions": 0.0,
                "yt_fantasy_points_mentions": 0.0,
                "yt_qb_list_mentions": 0.0,
                "yt_underdog_fantasy_mentions": 0.0,
                "yt_reception_perception_mentions": 0.0,
                "yt_draft_sharks_mentions": 0.0,
            }
        ]
    )


def test_fantasy_weekly_payload_uses_fantasy_media_digest(monkeypatch):
    from src.sentiment import fantasy_readout as mod

    monkeypatch.setattr(mod, "load_sentiment_features", lambda path=None: _fantasy_features())
    monkeypatch.setattr(
        mod,
        "fantasy_digest_for_player",
        lambda *a, **k: {
            "fantasy_media_digest": "Mahomes locked in for week 1.",
            "fantasy_media_digest_source": "extractive",
        }
        if k.get("return_meta")
        else "Mahomes locked in for week 1.",
    )
    mod._FANTASY_RESPONSE_CACHE.clear()

    response = build_fantasy_weekly_response("qb", season=2026, week=1)
    assert response["count"] == 1
    player = response["players"][0]
    assert player["fantasy_media_digest"] == "Mahomes locked in for week 1."
    assert player["fantasy_media_digest_source"] == "extractive"
    assert "beat_digest" not in player
    assert "beat_digest_source" not in player
    assert "fantasy_digest" not in player
    assert "fantasy_digest_source" not in player


def test_fantasy_media_digest_single_payload(monkeypatch):
    from src.draft_hub import draft_enrichment as mod

    monkeypatch.setattr(
        mod,
        "build_fantasy_index",
        lambda season=None, week=None: {
            "season": 2026,
            "week": 1,
            "requested_season": 2026,
            "requested_week": 1,
            "context_fallback": False,
            "players": {
                "p1": {
                    "player": "Patrick Mahomes",
                    "mention_count": 4,
                    "snippet": "locked in",
                    "chapter_notes": "Role locked",
                    "top_sentence": "locked in",
                    "sentiment_label": "positive",
                    "injury_flag": 0,
                    "role_hype_flag": 1,
                }
            },
        },
    )
    monkeypatch.setattr(
        mod,
        "fantasy_digest_for_player",
        lambda *a, **k: {
            "fantasy_media_digest": "Mahomes role looks secure.",
            "fantasy_media_digest_source": "extractive",
        },
    )

    payload = fantasy_media_digest_single("p1", player_name="Patrick Mahomes", season=2026, week=1)
    assert payload["player_id"] == "p1"
    assert payload["fantasy_media_digest"] == "Mahomes role looks secure."
    assert payload["fantasy_media_digest_source"] == "extractive"
    assert "beat_digest" not in payload
    assert "fantasy_digest" not in payload


def test_hub_fantasy_media_digest_route_registered():
    from app.hub_routes import router as hub_router

    paths = {getattr(route, "path", "") for route in hub_router.routes}
    assert "/api/hub/draft-room/fantasy-media-digest/{player_id}" in paths
    assert "/api/hub/draft-room/beat-digest/{player_id}" not in paths
