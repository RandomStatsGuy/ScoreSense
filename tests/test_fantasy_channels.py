"""Tests for league-wide fantasy channel support."""

from datetime import datetime, timezone

import pandas as pd

from src.core.schedule_utils import map_publish_time_to_league_week
from src.sentiment.fantasy_aggregate import build_fantasy_channel_features
from src.sentiment.fantasy_channels import LEAGUE_TEAM_CODE, load_fantasy_channels
from src.sentiment.player_link import link_mention_league


def test_load_fantasy_channels():
    channels = load_fantasy_channels()
    assert len(channels) == 10
    assert {c.network for c in channels} == {
        "draft_sharks",
        "fantasy_footballers",
        "fantasypros_yt",
        "playerprofiler",
        "late_round",
        "establish_the_run",
        "fantasy_points",
        "qb_list",
        "underdog_fantasy",
        "reception_perception",
    }


def test_link_mention_league_unique():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0031234",
                "team": "LV",
                "position": "QB",
                "name_key": "aidan oconnell",
                "display_name": "Aidan O'Connell",
            },
            {
                "player_id": "00-0039999",
                "team": "KC",
                "position": "QB",
                "name_key": "patrick mahomes",
                "display_name": "Patrick Mahomes",
            },
        ]
    )
    assert link_mention_league("Patrick Mahomes", roster)["player_id"] == "00-0039999"
    assert link_mention_league("Aidan O'Connell", roster)["player_id"] == "00-0031234"


def test_build_fantasy_channel_features():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0039999",
                "team": "KC",
                "position": "QB",
                "name_key": "patrick mahomes",
                "display_name": "Patrick Mahomes",
            }
        ]
    )
    videos = pd.DataFrame(
        [
            {
                "content_id": "fantasy1",
                "channel_id": "UC_FANTASY_TEST",
                "team": LEAGUE_TEAM_CODE,
                "network": "draft_sharks",
                "channel_weight": 1.0,
                "channel_label": "Draft Sharks",
                "published_at": pd.Timestamp("2024-09-11T18:00:00Z"),
                "title": "Week 2 starts",
                "description": "Patrick Mahomes is a smash play this week.",
            }
        ]
    )
    features = build_fantasy_channel_features(2024, "UC_FANTASY_TEST", videos=videos, roster=roster)
    assert not features.empty
    assert features.iloc[0]["player_id"] == "00-0039999"
    assert features.iloc[0]["yt_mention_count"] >= 1.0


def test_map_publish_time_to_league_week_smoke():
    ts = pd.Timestamp("2024-09-11T18:00:00Z")
    week = map_publish_time_to_league_week(ts, 2024)
    assert week is None or (1 <= week <= 18)
