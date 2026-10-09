"""Exact cache-only name crosswalks never guess between canonical players."""
import pytest

from src.draft_hub import player_identity


def test_unique_name_deduplicates_aliases_and_matches_normalized_full_name(trusted_native_catalog, monkeypatch):
    trusted_native_catalog("4046", name="Patrick Mahomes", team="KC", position="QB", gsis_id="00-0033873")
    def forbidden(*args, **kwargs):
        raise AssertionError("An identity helper must not request provider data")
    monkeypatch.setattr("requests.get", forbidden)
    known = player_identity.cached_unique_name_identity(" PATRICK   MAHOMES ", "qb", season=2026)
    assert known["player_id"] == "00-0033873"
    assert {"4046", "sleeper-4046", "00-0033873"} <= set(known["aliases"])
    known["team"] = "BUF"
    assert player_identity.cached_unique_name_identity("Patrick Mahomes", "QB", season=2026)["team"] == "KC"


def test_exact_name_normalization_preserves_full_name_requirement(trusted_native_catalog):
    trusted_native_catalog("name-1", name="Odell Beckham Jr.", team="FA", position="WR")
    assert player_identity.cached_unique_name_identity("Odell Beckham, Jr", "WR", season=2026)["player_id"] == "name-1"
    assert player_identity.cached_unique_name_identity("O. Beckham Jr.", "WR", season=2026) is None
    assert player_identity.cached_unique_name_identity("Odell Beckham", "WR", season=2026) is None


def test_same_name_position_collision_refuses_team_based_guess(trusted_native_catalog):
    trusted_native_catalog("first-player", name="Same Player", team="PHI", position="WR")
    trusted_native_catalog("second-player", name="Same Player", team="BUF", position="WR")
    assert player_identity.cached_unique_name_identity("Same Player", "WR", season=2026) is None


def test_supported_position_disambiguates_same_full_name(trusted_native_catalog):
    trusted_native_catalog("quarterback", name="Same Player", team="BUF", position="QB")
    trusted_native_catalog("receiver", name="Same Player", team="FA", position="WR")
    assert player_identity.cached_unique_name_identity("Same Player", "QB", season=2026)["player_id"] == "quarterback"
    assert player_identity.cached_unique_name_identity("Same Player", "WR", season=2026)["player_id"] == "receiver"


@pytest.mark.parametrize("name,position", [("", "QB"), (None, "QB"), ("Unknown Player", "QB"),
                                           ("Patrick Mahomes", "WR"), ("Patrick Mahomes", "UNKNOWN")])
def test_unavailable_name_or_position_returns_none(trusted_native_catalog, name, position):
    trusted_native_catalog("4046", name="Patrick Mahomes", team="KC", position="QB", gsis_id="00-0033873")
    assert player_identity.cached_unique_name_identity(name, position, season=2026) is None
