"""SCORE-34 preseason media modes: outlook, week1_pulse, older."""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from src.sentiment.media_context import (
    MEDIA_MODE_OLDER,
    MEDIA_MODE_OUTLOOK,
    MEDIA_MODE_WEEK1_PULSE,
    MEDIA_STATE_CURRENT,
    MEDIA_STATE_HISTORICAL_AVAILABLE,
    MEDIA_STATE_NONE,
    PRESEASON_OUTLOOK_WEEK,
    classify_publish_bucket,
    normalize_media_mode,
    resolve_publish_week_for_features,
    select_media_context_for_mode,
)


def test_normalize_media_mode_and_include_historical_alias():
    assert normalize_media_mode("outlook") == MEDIA_MODE_OUTLOOK
    assert normalize_media_mode("week1_pulse") == MEDIA_MODE_WEEK1_PULSE
    assert normalize_media_mode("older") == MEDIA_MODE_OLDER
    assert normalize_media_mode(None, include_historical=True) == MEDIA_MODE_OLDER
    assert normalize_media_mode("nope") is None
    assert normalize_media_mode(None) is None


def test_classify_publish_bucket_week1_vs_outlook_vs_older():
    now = datetime(2026, 8, 1, tzinfo=timezone.utc)
    assert (
        classify_publish_bucket(
            "2026-07-20T12:00:00Z",
            2026,
            mapped_week=1,
            now=now,
        )
        == "week1"
    )
    assert (
        classify_publish_bucket(
            "2026-07-20T12:00:00Z",
            2026,
            mapped_week=None,
            now=now,
        )
        == "outlook"
    )
    assert (
        classify_publish_bucket(
            "2026-05-01T12:00:00Z",
            2026,
            mapped_week=None,
            now=now,
        )
        == "older"
    )
    assert resolve_publish_week_for_features(
        "2026-07-20T12:00:00Z",
        2026,
        mapped_week=None,
        now=now,
    ) == PRESEASON_OUTLOOK_WEEK
    assert (
        resolve_publish_week_for_features(
            "2026-07-20T12:00:00Z",
            2026,
            mapped_week=1,
            now=now,
        )
        == 1
    )


def test_select_media_context_modes_do_not_auto_show_older():
    modes = {
        MEDIA_MODE_OUTLOOK: {
            "state": MEDIA_STATE_CURRENT,
            "signal": "mentioned",
            "source_count": 2,
            "summary": "Camp buzz outlook",
            "excerpt": "Strong camp reports",
            "sources": [{"label": "Show A"}],
            "updated_at": "2026-08-01T00:00:00+00:00",
            "historical": None,
            "affects_projection": False,
        },
        MEDIA_MODE_WEEK1_PULSE: {
            "state": MEDIA_STATE_CURRENT,
            "signal": "role_up",
            "source_count": 3,
            "summary": "Week 1 pulse",
            "excerpt": "Startable Week 1",
            "sources": [{"label": "Show B"}],
            "updated_at": "2026-08-10T00:00:00+00:00",
            "historical": None,
            "affects_projection": False,
        },
        MEDIA_MODE_OLDER: {
            "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
            "signal": None,
            "source_count": 0,
            "summary": None,
            "excerpt": None,
            "sources": [],
            "updated_at": None,
            "historical": {
                "season": 2025,
                "week": 18,
                "signal": "mentioned",
                "source_count": 4,
                "summary": "Last year wrap",
                "excerpt": "Older excerpt",
                "sources": [{"label": "Old Show"}],
                "updated_at": "2025-01-01T00:00:00+00:00",
            },
            "affects_projection": False,
        },
    }
    default_media = {
        "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
        "signal": None,
        "source_count": 0,
        "summary": None,
        "excerpt": None,
        "sources": [],
        "updated_at": None,
        "historical": {"season": 2025, "week": 18},
        "affects_projection": False,
    }

    default = select_media_context_for_mode(
        media_context=default_media,
        media_modes=modes,
        media_mode=None,
    )
    assert default["state"] == MEDIA_STATE_HISTORICAL_AVAILABLE
    assert default["summary"] is None
    assert default["mode"] is None
    assert default["modes_available"][MEDIA_MODE_OUTLOOK] is True
    assert default["modes_available"][MEDIA_MODE_WEEK1_PULSE] is True
    assert default["modes_available"][MEDIA_MODE_OLDER] is True

    outlook = select_media_context_for_mode(
        media_context=default_media,
        media_modes=modes,
        media_mode=MEDIA_MODE_OUTLOOK,
    )
    assert outlook["mode"] == MEDIA_MODE_OUTLOOK
    assert outlook["state"] == MEDIA_STATE_CURRENT
    assert outlook["summary"] == "Camp buzz outlook"
    assert outlook["excerpt"] == "Strong camp reports"

    pulse = select_media_context_for_mode(
        media_context=default_media,
        media_modes=modes,
        media_mode=MEDIA_MODE_WEEK1_PULSE,
    )
    assert pulse["mode"] == MEDIA_MODE_WEEK1_PULSE
    assert pulse["summary"] == "Week 1 pulse"

    older = select_media_context_for_mode(
        media_context=default_media,
        media_modes=modes,
        media_mode=MEDIA_MODE_OLDER,
    )
    assert older["mode"] == MEDIA_MODE_OLDER
    assert older["state"] == MEDIA_STATE_HISTORICAL_AVAILABLE
    assert older["summary"] == "Last year wrap"
    assert older["excerpt"] == "Older excerpt"


def test_player_context_media_mode_serve(tmp_path, monkeypatch):
    from src.projections import player_context as pc

    monkeypatch.setattr(pc, "PLAYER_CONTEXT_DIR", tmp_path)
    monkeypatch.setattr(pc, "season_week_context", lambda s, w: (2026, 1))
    monkeypatch.setattr(
        pc,
        "player_context_fingerprint",
        lambda **kwargs: "fp-test",
    )

    payload = {
        "player_id": "p1",
        "player_name": "Test WR",
        "position": "WR",
        "team": "CIN",
        "projection": {"base": 10.0, "final": 10.0, "injury_delta": 0.0},
        "availability": {"status": None, "practice": None, "updated_at": None},
        "opportunity_adjustment": {"points": 0.0, "drivers": [], "included": False},
        "media_context": {
            "state": MEDIA_STATE_CURRENT,
            "signal": "role_up",
            "source_count": 2,
            "summary": "Default week1",
            "excerpt": "Week1 excerpt",
            "sources": [{"label": "Pulse"}],
            "updated_at": "2026-08-01T00:00:00+00:00",
            "historical": None,
            "affects_projection": False,
        },
        "media_modes": {
            MEDIA_MODE_OUTLOOK: {
                "state": MEDIA_STATE_CURRENT,
                "signal": "mentioned",
                "source_count": 1,
                "summary": "Outlook summary",
                "excerpt": "Outlook excerpt",
                "sources": [{"label": "Camp"}],
                "updated_at": "2026-07-20T00:00:00+00:00",
                "historical": None,
                "affects_projection": False,
            },
            MEDIA_MODE_WEEK1_PULSE: {
                "state": MEDIA_STATE_CURRENT,
                "signal": "role_up",
                "source_count": 2,
                "summary": "Default week1",
                "excerpt": "Week1 excerpt",
                "sources": [{"label": "Pulse"}],
                "updated_at": "2026-08-01T00:00:00+00:00",
                "historical": None,
                "affects_projection": False,
            },
            MEDIA_MODE_OLDER: {
                "state": MEDIA_STATE_HISTORICAL_AVAILABLE,
                "signal": None,
                "source_count": 0,
                "summary": None,
                "excerpt": None,
                "sources": [],
                "updated_at": None,
                "historical": {
                    "season": 2025,
                    "week": 17,
                    "signal": "mentioned",
                    "source_count": 1,
                    "summary": "Older summary",
                    "excerpt": "Older excerpt",
                    "sources": [{"label": "Old"}],
                    "updated_at": "2025-12-01T00:00:00+00:00",
                },
                "affects_projection": False,
            },
        },
        "meta": {"season": 2026, "week": 1, "schema_version": "player_context_v4"},
    }
    import json

    frame = pd.DataFrame(
        [
            {
                "player_id": "p1",
                "player_name": "Test WR",
                "position": "WR",
                "team": "CIN",
                "payload_json": json.dumps(payload),
            }
        ]
    )
    meta = {
        "fingerprint": "fp-test",
        "built_at": "2026-08-01T00:00:00+00:00",
        "injury_snapshot_id": "inj-1",
        "schema_version": "player_context_v4",
        "stale": False,
    }
    parquet_path = tmp_path / "2026_w1.parquet"
    meta_path = tmp_path / "2026_w1.meta.json"
    frame.to_parquet(parquet_path, index=False)
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    outlook = pc.get_player_context("p1", season=2026, week=1, media_mode="outlook")
    assert outlook["media_context"]["mode"] == MEDIA_MODE_OUTLOOK
    assert outlook["media_context"]["summary"] == "Outlook summary"
    assert outlook["meta"]["media_mode"] == MEDIA_MODE_OUTLOOK
    assert "media_modes" not in outlook

    pulse = pc.get_player_context("p1", season=2026, week=1, media_mode="week1_pulse")
    assert pulse["media_context"]["mode"] == MEDIA_MODE_WEEK1_PULSE
    assert pulse["media_context"]["summary"] == "Default week1"

    older = pc.get_player_context("p1", season=2026, week=1, media_mode="older")
    assert older["media_context"]["mode"] == MEDIA_MODE_OLDER
    assert older["media_context"]["summary"] == "Older summary"
    assert older["media_context"]["state"] == MEDIA_STATE_HISTORICAL_AVAILABLE

    # Default must not auto-show older narrative body.
    default = pc.get_player_context("p1", season=2026, week=1)
    assert default["media_context"]["summary"] == "Default week1"
    assert default["media_context"]["mode"] is None


def test_fantasy_weekly_media_mode_outlook(monkeypatch):
    from src.sentiment import fantasy_readout as fr

    fr.invalidate_fantasy_response_cache()

    features = pd.DataFrame(
        [
            {
                "player_id": "qb1",
                "season": 2026,
                "week": 0,
                "position": "QB",
                "team": "KC",
                "yt_mention_count": 0,
                "yt_sentiment_score": 0.2,
                "yt_injury_flag": 0,
                "yt_role_hype_flag": 0,
                "yt_top_snippet": "Camp outlook for Mahomes",
                "yt_fantasy_footballers_mentions": 2.0,
                "yt_fantasypros_mentions": 0.0,
                "yt_late_round_mentions": 0.0,
                "yt_establish_the_run_mentions": 0.0,
                "yt_fantasy_points_mentions": 0.0,
                "yt_draft_sharks_mentions": 0.0,
                "yt_playerprofiler_mentions": 0.0,
                "yt_qb_list_mentions": 0.0,
                "yt_underdog_fantasy_mentions": 0.0,
                "yt_reception_perception_mentions": 0.0,
            },
            {
                "player_id": "qb1",
                "season": 2026,
                "week": 1,
                "position": "QB",
                "team": "KC",
                "yt_mention_count": 0,
                "yt_sentiment_score": 0.1,
                "yt_injury_flag": 0,
                "yt_role_hype_flag": 1,
                "yt_top_snippet": "Week 1 start",
                "yt_fantasy_footballers_mentions": 0.0,
                "yt_fantasypros_mentions": 3.0,
                "yt_late_round_mentions": 0.0,
                "yt_establish_the_run_mentions": 0.0,
                "yt_fantasy_points_mentions": 0.0,
                "yt_draft_sharks_mentions": 0.0,
                "yt_playerprofiler_mentions": 0.0,
                "yt_qb_list_mentions": 0.0,
                "yt_underdog_fantasy_mentions": 0.0,
                "yt_reception_perception_mentions": 0.0,
            },
        ]
    )
    monkeypatch.setattr(fr, "load_sentiment_features", lambda path=None: features)
    monkeypatch.setattr(fr, "_player_names", lambda *a, **k: {"qb1": "Patrick Mahomes"})
    monkeypatch.setattr(fr, "_fantasy_channel_lookup", lambda: {("NFL", "fantasy_footballers"): "FFB"})
    monkeypatch.setattr(fr, "get_sentiment_refresh_status", lambda: {"completed_at": None})

    outlook = fr.build_fantasy_weekly_response(
        "qb", season=2026, week=1, media_mode="outlook"
    )
    assert outlook["meta"]["media_mode"] == MEDIA_MODE_OUTLOOK
    assert outlook["media_context"]["mode"] == MEDIA_MODE_OUTLOOK
    assert outlook["count"] == 1
    assert outlook["serve_week"] == PRESEASON_OUTLOOK_WEEK
    assert outlook["players"][0]["player_id"] == "qb1"

    pulse = fr.build_fantasy_weekly_response(
        "qb", season=2026, week=1, media_mode="week1_pulse"
    )
    assert pulse["meta"]["media_mode"] == MEDIA_MODE_WEEK1_PULSE
    assert pulse["serve_week"] == 1
    assert pulse["count"] == 1
    assert "Week 1" in pulse["players"][0]["snippet"]
