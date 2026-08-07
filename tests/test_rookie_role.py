"""Rookie role multiplier tests."""

import pandas as pd

from src.projections.rookie_role import (
    compute_rookie_role,
    draft_capital_factor,
    lookup_rookie_override,
    resolve_rookie_skill_position,
    rookie_role_multiplier,
    sentiment_role_boost,
)


def test_mendoza_higher_than_clark():
    mendoza = pd.Series({"depth_chart_order": 1, "search_rank": 39, "position": "QB"})
    clark = pd.Series({"depth_chart_order": None, "search_rank": 9999999, "position": "QB"})
    m_mult, m_label = rookie_role_multiplier("qb", mendoza)
    c_mult, c_label = rookie_role_multiplier("qb", clark)
    assert m_mult > c_mult * 3
    assert m_label == "starter-likely"
    assert c_label == "development"


def test_depth_chart_qb2_backup():
    row = pd.Series({"depth_chart_order": 2, "search_rank": 9999999, "position": "QB"})
    mult, label = rookie_role_multiplier("qb", row)
    assert mult < 1.0
    assert "backup" in label


def test_wr1_rookie_gets_boost():
    row = pd.Series({"depth_chart_order": 1, "search_rank": 9999999, "position": "WR"})
    mult, label = rookie_role_multiplier("wr", row)
    assert mult > 1.4
    assert label.startswith("wr1-path")


def test_te1_uses_te_tiers_not_wr():
    row = pd.Series({"depth_chart_order": 1, "search_rank": 109, "position": "TE"})
    # Overlay often passes position="wr" for the combined WR/TE pool.
    mult, label = rookie_role_multiplier("wr", row)
    assert label.startswith("te1-path")
    assert 1.3 < mult < 1.8


def test_elite_capital_boosts_rb1():
    base = pd.Series({"depth_chart_order": 1, "search_rank": 9999999, "position": "RB"})
    elite = pd.Series({"depth_chart_order": 1, "search_rank": 15, "position": "RB"})
    base_mult, _ = rookie_role_multiplier("rb", base)
    elite_mult, elite_label = rookie_role_multiplier("rb", elite)
    assert elite_mult > base_mult
    assert "elite-capital" in elite_label


def test_draft_capital_factor_tiers():
    assert draft_capital_factor(10)[0] > draft_capital_factor(80)[0] > draft_capital_factor(400)[0]
    assert draft_capital_factor(None) == (1.0, "")


def test_resolve_skill_position_prefers_sleeper():
    row = pd.Series({"position": "TE"})
    assert resolve_rookie_skill_position("wr", row) == "te"
    assert resolve_rookie_skill_position("rb", pd.Series({"position": "FB"})) == "rb"


def test_camp_override_replaces_sleeper_tier():
    row = pd.Series(
        {
            "full_name": "Fernando Mendoza",
            "team": "LV",
            "position": "QB",
            "depth_chart_order": 1,
            "search_rank": 39,
        }
    )
    mult, label = compute_rookie_role("qb", row, season=2026)
    assert mult == 2.75
    assert label == "starter-camp"


def test_love_and_sadiq_overrides():
    love = pd.Series(
        {
            "full_name": "Jeremiyah Love",
            "team": "ARI",
            "position": "RB",
            "depth_chart_order": 1,
            "search_rank": 15,
        }
    )
    mult, label = compute_rookie_role("rb", love, season=2026)
    assert mult == 2.15
    assert label == "workhorse"

    sadiq = pd.Series(
        {
            "full_name": "Kenyon Sadiq",
            "team": "NYJ",
            "position": "TE",
            "depth_chart_order": 1,
            "search_rank": 109,
        }
    )
    # Combined WR pool still resolves TE override.
    mult, label = compute_rookie_role("wr", sadiq, season=2026)
    assert mult == 1.55
    assert label == "te1-path"


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
