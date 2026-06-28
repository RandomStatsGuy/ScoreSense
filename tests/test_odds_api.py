"""Tests for Odds API prop line parsing."""

from src.integrations.odds_api import parse_event_odds_payload


SAMPLE_EVENT_ODDS = {
    "id": "evt-1",
    "bookmakers": [
        {
            "key": "draftkings",
            "markets": [
                {
                    "key": "player_pass_yds",
                    "outcomes": [
                        {"name": "Over", "description": "Patrick Mahomes", "point": 275.5},
                        {"name": "Under", "description": "Patrick Mahomes", "point": 275.5},
                    ],
                },
                {
                    "key": "player_anytime_td",
                    "outcomes": [
                        {"name": "Over", "description": "Travis Kelce", "point": 0.5},
                    ],
                },
            ],
        }
    ],
}


def test_parse_event_odds_payload():
    df = parse_event_odds_payload(SAMPLE_EVENT_ODDS)
    assert len(df) == 2
    pass_yards = df[df["prop_type"] == "pass_yards"].iloc[0]
    assert pass_yards["market_line"] == 275.5
    assert pass_yards["name_key"]
