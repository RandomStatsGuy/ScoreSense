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


def test_media_includes_jersey_number_when_known(monkeypatch):
    puka = pd.Series(
        {
            "sleeper_id": "9493",
            "espn_id": "4362628",
            "full_name": "Puka Nacua",
            "team": "LAR",
            "gsis_id": "",
            "number": 17.0,
        }
    )
    monkeypatch.setattr(de, "_sleeper_lookup_tables", lambda: _fake_sleeper_tables(puka))
    monkeypatch.setattr(de, "_gsis_identity_map", lambda: {})
    media = de.build_player_media_batch(
        [{"player_id": "00-0039075", "player_name": "Puka Nacua", "team": "LAR"}]
    )
    # 17.0 (pandas float) normalizes to "17" for locker-room jerseys.
    assert media["00-0039075"]["jersey_number"] == "17"
    # Unmatched players still return the field, as None.
    missing = de.build_player_media_batch(
        [{"player_id": "sleeper-000000", "player_name": "Nobody Real", "team": "ZZZ"}]
    )
    assert missing["sleeper-000000"]["jersey_number"] is None


def test_media_includes_profile_facts(monkeypatch):
    puka = pd.Series(
        {
            "sleeper_id": "9493",
            "espn_id": "4362628",
            "full_name": "Puka Nacua",
            "team": "LAR",
            "gsis_id": "",
            "college": "BYU",
            "high_school": "Orem (UT)",
            "age": 25,
            "years_exp": 3,
            "height": 74,
            "weight": 212,
        }
    )
    monkeypatch.setattr(de, "_sleeper_lookup_tables", lambda: _fake_sleeper_tables(puka))
    monkeypatch.setattr(de, "_gsis_identity_map", lambda: {})
    media = de.build_player_media_batch(
        [{"player_id": "00-0039075", "player_name": "Puka Nacua", "team": "LAR"}]
    )
    row = media["00-0039075"]
    assert row["college"] == "BYU"
    assert row["high_school"] == "Orem (UT)"
    assert row["age"] == 25
    assert row["years_exp"] == 3
    assert row["height"] == "74"
    assert row["weight"] == "212"


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

