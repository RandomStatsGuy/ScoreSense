"""Recorded scoring stays distinct from forecasts, with no invented baselines."""
import json

import pandas as pd
import pytest

from src.projections import player_card_history as history


@pytest.fixture
def card_files(tmp_path, monkeypatch):
    monkeypatch.setattr(history, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(history, "DRAFT_POOL_DIR", tmp_path)
    monkeypatch.setattr(history, "SCHEDULE_CACHE", tmp_path / "schedule.parquet")
    history._player_rows.cache_clear()
    yield tmp_path
    history._player_rows.cache_clear()


def write_history(folder, scores):
    pd.DataFrame([{
        "player_id": "qb1", "season": 2026, "week": week, "Fpts": points,
        "opponent": "NE", "is_home": 0, "passing_yards_lead": 240,
        "rushing_yards_lead": 32, "passing_tds_lead": 2, "rushing_tds_lead": 0,
    } for week, points in scores]).to_parquet(folder / "qb_mlready.parquet", index=False)


def test_recorded_results_exclude_current_week_and_playoffs_and_keep_zero(card_files):
    write_history(card_files, [(1, 20.5), (2, 0.0), (3, -2.5), (4, 80), (19, 90)])
    result = history.recorded_player_history("qb1", "qb", 2026, 4, preseason=False)
    assert result["season_to_date"] == {"season": 2026, "points": 18.0, "ppg": 6.0, "games_played": 3, "through_week": 3, "complete": True}
    assert [row["week"] for row in result["game_log"]] == [3, 2, 1]
    assert result["game_log"][1]["points"] == 0
    assert result["game_log"][0]["passing_yards"] == 240
    assert result["game_log"][0]["touchdowns"] == 2


def test_missing_scores_do_not_become_zero_or_partial_season_totals(card_files):
    write_history(card_files, [(1, 20), (2, None)])
    result = history.recorded_player_history("qb1", "qb", 2026, 3, preseason=False)
    assert result["season_to_date"]["points"] is None
    assert result["season_to_date"]["ppg"] is None
    assert result["season_to_date"]["complete"] is False
    assert result["game_log"][0]["points"] is None
    missing = history.recorded_player_history("missing", "qb", 2026, 3, preseason=False)
    assert missing["season_to_date"]["games_played"] is None
    assert missing["game_log"] == []


def test_preseason_shows_prior_game_log_without_carrying_over_totals(card_files):
    write_history(card_files, [(1, 22), (18, 14), (19, 60)])
    result = history.recorded_player_history("qb1", "qb", 2027, 1, preseason=True)
    assert result["game_log_season"] == 2026
    assert [r["week"] for r in result["game_log"]] == [18, 1]
    assert result["season_to_date"]["points"] is None


def test_history_cache_invalidates_when_artifact_is_replaced(card_files):
    write_history(card_files, [(1, 10)])
    assert history.recorded_player_history("qb1", "qb", 2026, 3, preseason=False)["season_to_date"]["points"] == 10
    write_history(card_files, [(1, 10), (2, 25)])
    assert history.recorded_player_history("qb1", "qb", 2026, 3, preseason=False)["season_to_date"]["points"] == 35


@pytest.mark.parametrize("built_at,has_schedule,expected", [("2026-08-01T12:00:00Z", True, True), ("2026-10-01T12:00:00Z", True, False), (None, True, False), ("2026-08-01T12:00:00Z", False, False)])
def test_only_demonstrably_preseason_forecasts_supply_a_comparison(card_files, built_at, has_schedule, expected):
    pd.DataFrame([{"player_id": "qb1", "Season": 2026, "Season P50": 344.0, "Season P10": 283, "Season P90": 403}]).to_parquet(card_files / "pool_2026.parquet")
    (card_files / "pool_2026.meta.json").write_text(json.dumps({"season": 2026, "built_at": built_at, "games_per_season": 17}))
    if has_schedule:
        pd.DataFrame([{"season": 2026, "week": 1, "gameday": "2026-09-10"}]).to_parquet(history.SCHEDULE_CACHE)
    result = history.saved_preseason_forecast("qb1", 2026)
    assert result["preseason_projection"]["p50"] == 344
    assert (result["preseason_baseline"] is not None) is expected
