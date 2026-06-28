"""Tests for Chat Sports channel registry."""

from src.sentiment.chat_sports_channels import (
    CHAT_SPORTS_SHORT,
    confidence_from_score,
    load_chat_sports_channels,
    score_chat_sports_match,
    search_queries_for_team,
)
from src.sentiment.channels import load_channels


def test_chat_sports_seeds_count():
    channels = load_chat_sports_channels()
    assert len(channels) == 31  # NYG inactive (empty Chat Sports channel)
    all_channels = load_chat_sports_channels(active_only=False)
    assert len(all_channels) == 32
    assert CHAT_SPORTS_SHORT["MIN"] == "Vikings"


def test_lv_channel_resolved():
    lv = [c for c in load_chat_sports_channels() if c.team == "LV"]
    assert len(lv) == 1
    assert lv[0].channel_id == "UC2zTXqHLEz56OG0EvS9SiFA"
    assert lv[0].promote_to_features is True


def test_search_queries_for_min():
    queries = search_queries_for_team("MIN")
    assert "Vikings Now Chat Sports" in queries
    assert "Vikings Report Chat Sports" in queries


def test_score_chat_sports_match():
    assert score_chat_sports_match("Vikings Now by Chat Sports", "MIN") >= 12
    assert score_chat_sports_match("Chiefs Report by Chat Sports", "KC") >= 12
    assert score_chat_sports_match("Chat Sports", "KC") < 8


def test_handle_candidates_for_min():
    from src.sentiment.chat_sports_channels import handle_candidates_for_team

    handles = handle_candidates_for_team("MIN")
    assert "VikingsToday" in handles
    assert "VikingsReport" in handles


def test_load_channels_merges_chat_sports():
    cs = [c for c in load_channels(network="chat_sports")]
    assert len(cs) == 31
    assert all(c.network == "chat_sports" for c in cs)
