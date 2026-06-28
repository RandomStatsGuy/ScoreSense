"""Sleeper mapping and expanded draft pool tests."""

from src.draft_hub.storage import is_scoresense_player_id
from src.integrations.sleeper_league import sleeper_player_to_scoresense


def test_sleeper_fallback_player_id():
    mapped = sleeper_player_to_scoresense("13286")  # Jadarian Price
    assert mapped is not None
    assert mapped["player_name"] == "Jadarian Price"
    assert mapped["player_id"] == "sleeper-13286"
    assert mapped["match_tier"] == "sleeper_fallback"


def test_is_scoresense_player_id_accepts_sleeper_prefix():
    assert is_scoresense_player_id("00-0039150")
    assert is_scoresense_player_id("sleeper-13286")
    assert not is_scoresense_player_id("11560")
