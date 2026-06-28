"""Rookie role multiplier tests."""

import pandas as pd

from src.projections.rookie_role import (
    compute_rookie_role,
    lookup_rookie_override,
    rookie_role_multiplier,
    sentiment_role_boost,
)


def test_mendoza_higher_than_clark():
    mendoza = pd.Series({"depth_chart_order": 1, "search_rank": 39})
    clark = pd.Series({"depth_chart_order": None, "search_rank": 9999999})
    m_mult, m_label = rookie_role_multiplier("qb", mendoza)
    c_mult, c_label = rookie_role_multiplier("qb", clark)
    assert m_mult > c_mult * 3
    assert m_label == "starter-likely"
    assert c_label == "development"


def test_depth_chart_qb2_backup():
    row = pd.Series({"depth_chart_order": 2, "search_rank": 9999999})
    mult, label = rookie_role_multiplier("qb", row)
    assert mult < 1.0
    assert label == "backup"


def test_wr1_rookie_gets_boost():
    row = pd.Series({"depth_chart_order": 1, "search_rank": 9999999})
    mult, label = rookie_role_multiplier("wr", row)
    assert mult > 1.4
    assert label == "wr1-path"


def test_camp_override_replaces_sleeper_tier():
    row = pd.Series(
        {
            "full_name": "Fernando Mendoza",
            "team": "LV",
            "depth_chart_order": 1,
            "search_rank": 39,
        }
    )
    mult, label = compute_rookie_role("qb", row, season=2026)
    assert mult == 2.75
    assert label == "starter-camp"


def test_override_lookup():
    hit = lookup_rookie_override(
        player_name="Jacob Clark",
        team="LV",
        position="QB",
        season=2026,
    )
    assert hit is not None
    assert float(hit["role_mult"]) == 0.26


def test_sentiment_role_hype_boost(monkeypatch):
    features = pd.DataFrame(
        [
            {
                "player_id": "p-hype",
                "season": 2026,
                "week": 1,
                "team": "LV",
                "position": "QB",
                "yt_role_hype_flag": 1.0,
                "yt_mention_count": 2.0,
                "yt_sentiment_score": 0.3,
                "yt_injury_flag": 0.0,
            }
        ]
    )

    def fake_load():
        return features

    monkeypatch.setattr("src.sentiment.aggregate.load_sentiment_features", fake_load)

    boost, tag = sentiment_role_boost(
        player_name="Anyone",
        team="LV",
        player_id="p-hype",
        position="QB",
        season=2026,
    )
    assert boost > 1.05
    assert tag == "role-hype"
