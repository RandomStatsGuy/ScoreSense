"""media_only enrichment skips sentiment work."""


def test_media_only_skips_sentiment(monkeypatch):
    from src.draft_hub import draft_enrichment as de

    monkeypatch.setattr(
        de,
        "_media_for_players",
        lambda hints: {"x": {"headshot_url": "https://img/x.png", "team": "KC"}},
    )

    def boom(*_args, **_kwargs):
        raise AssertionError("sentiment should not run for media_only")

    monkeypatch.setattr(de, "build_fantasy_index", boom)
    out = de.build_draft_room_enrichment(
        season=2026,
        players=[{"player_id": "x", "player_name": "Xavier"}],
        media_only=True,
    )
    assert out["media_by_player_id"]["x"]["headshot_url"] == "https://img/x.png"
    assert out["sentiment_by_player_id"] == {}
    assert out["llm_available"] is False
