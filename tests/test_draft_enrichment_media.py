"""Draft-room media lookup and media_only enrichment."""

import pandas as pd

from src.draft_hub import draft_enrichment as de


def test_media_only_skips_sentiment(monkeypatch):
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


def _fake_sleeper_tables(row):
    nkey = "puka nacua"
    return (
        pd.DataFrame(),
        {},
        {str(row["sleeper_id"]): row},
        {(nkey, "LAR"): row},
        {nkey: [row]},
    )


def test_name_lookup_aliases_la_to_lar(monkeypatch):
    puka = pd.Series(
        {
            "sleeper_id": "9493",
            "espn_id": "4362628",
            "full_name": "Puka Nacua",
            "team": "LAR",
            "gsis_id": "",
        }
    )
    monkeypatch.setattr(de, "_sleeper_lookup_tables", lambda: _fake_sleeper_tables(puka))
    monkeypatch.setattr(de, "_gsis_identity_map", lambda: {})
    media = de.build_player_media_batch(
        [{"player_id": "00-0039075", "player_name": "Puka Nacua", "team": "LA"}]
    )
    assert "9493" in (media["00-0039075"]["headshot_url"] or "")
    assert media["00-0039075"]["espn_headshot_url"]


def test_gsis_only_uses_pool_identity_when_sleeper_gsis_missing(monkeypatch):
    puka = pd.Series(
        {
            "sleeper_id": "9493",
            "espn_id": "4362628",
            "full_name": "Puka Nacua",
            "team": "LAR",
            "gsis_id": "",
        }
    )
    monkeypatch.setattr(de, "_sleeper_lookup_tables", lambda: _fake_sleeper_tables(puka))
    monkeypatch.setattr(de, "_gsis_identity_map", lambda: {"00-0039075": ("Puka Nacua", "LA")})
    media = de.build_player_media_batch([{"player_id": "00-0039075"}])
    assert "9493" in (media["00-0039075"]["headshot_url"] or "")


def test_live_pool_stars_resolve_from_gsis_only():
    media = de.build_player_media_batch(
        [
            {"player_id": "00-0036900"},  # Ja'Marr Chase
            {"player_id": "00-0039075"},  # Puka Nacua
            {"player_id": "00-0026498"},  # Matthew Stafford
        ]
    )
    assert "7564" in (media["00-0036900"]["headshot_url"] or "")
    assert "9493" in (media["00-0039075"]["headshot_url"] or "")
    assert "421" in (media["00-0026498"]["headshot_url"] or "")

