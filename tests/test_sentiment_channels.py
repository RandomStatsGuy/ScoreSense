"""Tests for channel registry loader."""

from src.sentiment.channels import ChannelEntry, load_channels
from src.sentiment.networks import load_networks


def test_load_networks():
    networks = load_networks()
    assert "locked_on" in networks
    assert networks["locked_on"].weight_multiplier == 1.0
    assert networks["sb_nation"].weight_multiplier == 0.55


def test_channel_effective_weight():
    entry = ChannelEntry(
        channel_id="UC_TEST",
        team="KC",
        tier="reporting",
        weight=1.0,
        label="Locked On Chiefs",
        network="locked_on",
    )
    assert entry.effective_weight == 1.0

    sb = ChannelEntry(
        channel_id="UC_TEST2",
        team="KC",
        tier="fan_analysis",
        weight=0.55,
        label="Arrowhead Pride",
        network="sb_nation",
    )
    assert abs(sb.effective_weight - 0.3025) < 0.001


def test_load_channels_from_yaml():
    channels = load_channels(include_fan=False)
    locked_on = [c for c in channels if c.network == "locked_on"]
    assert len(locked_on) == 32
    teams = {c.team for c in locked_on}
    assert "LV" in teams
    assert "NO" in teams
    assert all(not c.needs_resolution() for c in locked_on)
    assert all(c.tier == "reporting" for c in locked_on)


def test_fan_analysis_tier_weight():
    from src.sentiment.channels import DEFAULT_TIER_WEIGHTS

    assert DEFAULT_TIER_WEIGHTS["fan_analysis"] == 0.55
