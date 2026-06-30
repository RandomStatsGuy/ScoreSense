"""Fantasy narrative readout tests."""

from __future__ import annotations

import pandas as pd
import pytest

from src.sentiment.fantasy_readout import (
    build_fantasy_season_response,
    build_fantasy_weekly_response,
    fantasy_mention_count,
)


def _sample_features() -> pd.DataFrame:
  return pd.DataFrame(
      [
          {
              "player_id": "p1",
              "season": 2026,
              "week": 1,
              "team": "KC",
              "position": "QB",
              "yt_mention_count": 5.0,
              "yt_sentiment_score": 0.3,
              "yt_injury_flag": 0.0,
              "yt_role_hype_flag": 1.0,
              "yt_top_snippet": "Mahomes outlook strong",
              "yt_top_sentence": "Mahomes outlook strong",
              "yt_chapter_notes": "",
              "yt_locked_on_mentions": 4.0,
              "yt_sb_nation_mentions": 1.0,
              "yt_fantasy_footballers_mentions": 2.0,
              "yt_late_round_mentions": 0.0,
              "yt_fantasypros_mentions": 0.0,
              "yt_playerprofiler_mentions": 0.0,
              "yt_establish_the_run_mentions": 0.0,
              "yt_fantasy_points_mentions": 0.0,
              "yt_qb_list_mentions": 0.0,
              "yt_underdog_fantasy_mentions": 0.0,
              "yt_reception_perception_mentions": 0.0,
              "yt_draft_sharks_mentions": 0.0,
              "narrative_source_count": 3.0,
              "yt_data_coverage": 0.5,
          },
          {
              "player_id": "p1",
              "season": 2026,
              "week": 2,
              "team": "KC",
              "position": "QB",
              "yt_mention_count": 3.0,
              "yt_sentiment_score": 0.1,
              "yt_injury_flag": 0.0,
              "yt_role_hype_flag": 0.0,
              "yt_top_snippet": "Week 2 chatter",
              "yt_top_sentence": "Week 2 chatter",
              "yt_chapter_notes": "",
              "yt_locked_on_mentions": 3.0,
              "yt_sb_nation_mentions": 0.0,
              "yt_fantasy_footballers_mentions": 1.0,
              "yt_late_round_mentions": 0.0,
              "yt_fantasypros_mentions": 0.0,
              "yt_playerprofiler_mentions": 0.0,
              "yt_establish_the_run_mentions": 0.0,
              "yt_fantasy_points_mentions": 0.0,
              "yt_qb_list_mentions": 0.0,
              "yt_underdog_fantasy_mentions": 0.0,
              "yt_reception_perception_mentions": 0.0,
              "yt_draft_sharks_mentions": 0.0,
              "narrative_source_count": 2.0,
              "yt_data_coverage": 0.5,
          },
          {
              "player_id": "p2",
              "season": 2026,
              "week": 1,
              "team": "BUF",
              "position": "QB",
              "yt_mention_count": 2.0,
              "yt_sentiment_score": -0.2,
              "yt_injury_flag": 0.0,
              "yt_role_hype_flag": 0.0,
              "yt_top_snippet": "Beat only",
              "yt_top_sentence": "Beat only",
              "yt_chapter_notes": "",
              "yt_locked_on_mentions": 2.0,
              "yt_sb_nation_mentions": 0.0,
              "yt_fantasy_footballers_mentions": 0.0,
              "yt_late_round_mentions": 0.0,
              "yt_fantasypros_mentions": 0.0,
              "yt_playerprofiler_mentions": 0.0,
              "yt_establish_the_run_mentions": 0.0,
              "yt_fantasy_points_mentions": 0.0,
              "yt_qb_list_mentions": 0.0,
              "yt_underdog_fantasy_mentions": 0.0,
              "yt_reception_perception_mentions": 0.0,
              "yt_draft_sharks_mentions": 0.0,
              "narrative_source_count": 1.0,
              "yt_data_coverage": 0.5,
          },
      ]
  )


def test_fantasy_mention_count_sums_network_columns():
    row = _sample_features().iloc[0]
    assert fantasy_mention_count(row) == pytest.approx(2.0)


def test_build_fantasy_weekly_excludes_beat_only_players(monkeypatch):
    from src.sentiment import fantasy_readout as mod

    monkeypatch.setattr(mod, "load_sentiment_features", lambda path=None: _sample_features())
    monkeypatch.setattr(mod, "invalidate_fantasy_response_cache", lambda: None)
    mod.invalidate_fantasy_response_cache()
    mod._FANTASY_RESPONSE_CACHE.clear()

    response = build_fantasy_weekly_response("qb", season=2026, week=1)
    assert response["scope"] == "weekly"
    assert response["count"] == 1
    player = response["players"][0]
    assert player["player_id"] == "p1"
    assert "beat_writer" not in player
    assert player["mention_count"] == pytest.approx(2.0)
    networks = {s["network"] for s in player["sources"]}
    assert "locked_on" not in networks
    assert "fantasy_footballers" in networks


def test_build_fantasy_season_aggregates_weeks(monkeypatch):
    from src.sentiment import fantasy_readout as mod

    monkeypatch.setattr(mod, "load_sentiment_features", lambda path=None: _sample_features())
    mod._FANTASY_RESPONSE_CACHE.clear()

    response = build_fantasy_season_response("qb", season=2026, week=2)
    assert response["scope"] == "season"
    assert response["count"] == 1
    player = response["players"][0]
    assert player["mention_count"] == pytest.approx(3.0)
    assert player["weeks_with_mentions"] == 2
    assert player.get("fantasy_digest")
    assert "beat_writer" not in player
