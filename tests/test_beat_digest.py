"""Beat digest and draft enrichment tests."""

from src.draft_hub.draft_enrichment import _media_for_players, team_logo_url
from src.sentiment.beat_digest import extractive_beat_digest, parse_chapter_titles


def test_parse_chapter_titles():
    raw = (
        "Timestamps 00:00 Bryce Young's Best Game Yet "
        "04:38 Bryce Young: Curry Comparison Insights "
        "15:04 Smart Playmaker Influences Strategy"
    )
    titles = parse_chapter_titles(raw)
    assert "Bryce Young's Best Game Yet" in titles[0]
    assert len(titles) >= 2


def test_extractive_beat_digest_from_chapters():
    snippet = (
        "00:00 Bryce Young's Best Game Yet "
        "04:38 Bryce Young: Curry Comparison Insights"
    )
    text = extractive_beat_digest(
        "Bryce Young",
        snippet=snippet,
        sentiment_label="hype",
        role_hype_flag=1.0,
        source_labels=["Locked On Panthers"],
    )
    assert "00:00" not in text
    assert "Locked On" not in text
    assert "beat coverage" not in text.lower()
    assert "Young" in text
    assert "curry comparison" in text.lower() or "best game" in text.lower()


def test_snippet_to_brief_strips_timestamps():
    from src.sentiment.beat_digest import snippet_to_brief

    brief = snippet_to_brief(
        "00:00 Bryce Young's Best Game Yet 04:38 Bryce Young: Curry Comparison",
        "Bryce Young",
    )
    assert "00:00" not in brief
    assert brief.startswith("- ")


def test_extractive_beat_digest_from_sentence_only():
    text = extractive_beat_digest(
        "Patrick Mahomes",
        top_sentence=(
            "Mahomes looked sharp in practice and the offense expects heavier passing volume this week."
        ),
        sentiment_label="hype",
        role_hype_flag=1.0,
    )
    assert "quiet" not in text.lower()
    assert "Mahomes" in text or "passing" in text.lower()


def test_snippet_to_brief_prefers_chapter_notes():
    from src.sentiment.beat_digest import snippet_to_brief

    brief = snippet_to_brief(
        "00:00 unrelated",
        "Test Player",
        chapter_notes="Injury update | Role in the offense",
    )
    assert "injury update" in brief.lower()
    assert "00:00" not in brief


def test_beat_digest_source_meta(monkeypatch, tmp_path):
    from src.sentiment import beat_digest as mod

    monkeypatch.setattr(mod, "_DIGEST_CACHE_DIR", tmp_path)
    monkeypatch.setattr(mod, "_llm_beat_digest", lambda *a, **k: None)

    sent = {
        "top_sentence": "Player had a strong week with increased target share.",
        "sentiment_label": "hype",
        "sources": [],
        "role_hype_flag": 1.0,
    }
    result = mod.beat_digest_for_player(
        "Test Player",
        sent,
        player_id="p2",
        season=2025,
        week=2,
        prefer_llm=False,
        return_meta=True,
    )
    assert result["beat_digest_source"] == "extractive"
    assert result["beat_digest"]
    assert "quiet" not in result["beat_digest"].lower()


def test_extractive_skips_clickbait_chapters_for_role_hype():
    text = extractive_beat_digest(
        "Lamar Jackson",
        chapter_notes=(
            "kyle Van Noy SAVAGELY RESPONDS to Lamar Jackson hate | "
            "Baltimore Ravens MUST prioritize win-now draft"
        ),
        sentiment_label="hype",
        injury_flag=1.0,
        role_hype_flag=1.0,
    )
    assert "Health is the headline" not in text
    assert "SAVAGELY" not in text
    assert "Jackson" in text


def test_beat_digest_daily_cache(monkeypatch, tmp_path):
    from src.sentiment import beat_digest as mod

    monkeypatch.setattr(mod, "_DIGEST_CACHE_DIR", tmp_path)
    monkeypatch.setattr(mod, "_llm_beat_digest", lambda *a, **k: "LLM summary text.")

    sent = {"snippet": "00:00 Test topic", "sentiment_label": "neutral", "sources": []}
    first = mod.beat_digest_for_player(
        "Test Player",
        sent,
        player_id="p1",
        season=2025,
        week=1,
        prefer_llm=True,
    )
    assert first == "LLM summary text."

    monkeypatch.setattr(mod, "_llm_beat_digest", lambda *a, **k: "Should not call again")
    second = mod.beat_digest_for_player(
        "Test Player",
        sent,
        player_id="p1",
        season=2025,
        week=1,
        prefer_llm=True,
    )
    assert second == "LLM summary text."


def test_media_lookup_by_name_when_gsis_missing():
    players = [
        {
            "player_id": "00-0039150",
            "player_name": "Bryce Young",
            "team": "CAR",
            "position": "QB",
        }
    ]
    media = _media_for_players(players)
    row = media["00-0039150"]
    assert row["headshot_url"] is not None
    assert "9228" in row["headshot_url"]
    assert row["team_logo_url"] == team_logo_url("CAR")


def test_media_lookup_sleeper_prefixed_id_without_name():
    """Roster/media APIs often have sleeper-{id} and abbreviated names — ID must resolve."""
    from src.draft_hub.draft_enrichment import build_player_media_batch

    media = build_player_media_batch([{"player_id": "sleeper-6806"}])
    row = media["sleeper-6806"]
    assert row["headshot_url"] is not None
    assert "6806" in row["headshot_url"]
    assert row["sleeper_id"] == "6806"
