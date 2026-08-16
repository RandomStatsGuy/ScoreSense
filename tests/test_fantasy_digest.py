"""Fantasy digest tests."""

from src.sentiment.fantasy_digest import (
    _daily_cache_key,
    extractive_fantasy_digest,
    fantasy_digest_for_player,
)


def test_extractive_fantasy_digest_weekly():
    text = extractive_fantasy_digest(
        "Patrick Mahomes",
        scope="weekly",
        top_sentence="Analysts expect heavier passing volume this week.",
        sentiment_label="hype",
        role_hype_flag=1.0,
    )
    assert "Mahomes" in text or "passing" in text.lower()
    assert "beat coverage" not in text.lower()


def test_extractive_fantasy_digest_season_trend():
    text = extractive_fantasy_digest(
        "Ja'Marr Chase",
        scope="season",
        top_sentence="Chase remains a focal point in dynasty talk.",
        sentiment_label="bullish",
        mention_trend=0.5,
        weeks_with_mentions=4,
    )
    assert "warming" in text.lower() or "season" in text.lower()


def test_fantasy_digest_cache_keys_differ_by_scope():
    weekly = _daily_cache_key(
        scope="weekly",
        player_id="p1",
        player_name="Test",
        season=2026,
        week=1,
    )
    season = _daily_cache_key(
        scope="season",
        player_id="p1",
        player_name="Test",
        season=2026,
        week=1,
    )
    assert weekly != season


def test_fantasy_digest_for_player_returns_meta(monkeypatch, tmp_path):
    from src.sentiment import fantasy_digest as mod

    monkeypatch.setattr(mod, "_WEEKLY_CACHE_DIR", tmp_path / "weekly")
    monkeypatch.setattr(mod, "_SEASON_CACHE_DIR", tmp_path / "season")
    monkeypatch.setattr(mod, "_llm_fantasy_digest", lambda *a, **k: None)

    sent = {
        "top_sentence": "Player had a strong week with increased target share.",
        "sentiment_label": "hype",
        "injury_flag": 0,
        "role_hype_flag": 1,
    }
    result = fantasy_digest_for_player(
        "Test Player",
        sent,
        scope="weekly",
        player_id="p1",
        season=2026,
        week=1,
        prefer_llm=False,
        return_meta=True,
    )
    assert result["fantasy_media_digest"]
    assert result["fantasy_media_digest_source"] == "extractive"
    assert "beat_digest" not in result
    assert "fantasy_digest" not in result
