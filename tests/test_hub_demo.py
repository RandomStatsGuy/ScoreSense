"""Tests for hub demo helpers."""

from src.draft_hub.hub_demo import demo_config, demo_league_id


def test_demo_config_unconfigured():
    assert demo_league_id() in (None, "")
    assert demo_config().get("available") is False
