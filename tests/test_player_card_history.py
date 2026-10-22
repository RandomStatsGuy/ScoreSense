"""Recorded scoring stays distinct from forecasts, with no invented baselines."""
import json

import pandas as pd
import pytest

from src.projections import player_card_history as history
from src.etl.recorded_games import RECORDED_GAMES_FILENAME, publish_recorded_games


@pytest.fixture
def card_files(tmp_path, monkeypatch):
    monkeypatch.setattr(history, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(history, "DRAFT_POOL_DIR", tmp_path)
    monkeypatch.setattr(history, "SCHEDULE_CACHE", tmp_path / "schedule.parquet")
    history._player_rows.cache_clear()
    history._cached_schedule.cache_clear()
    write_schedule(tmp_path)
    yield tmp_path
    history._player_rows.cache_clear()


def write_schedule(folder, *, bye=18):
    pd.DataFrame([{"season": 2026, "week": week, "game_type": "REG", "home_team": "BUF", "away_team": "NE",
                   "home_score": 21, "away_score": 17} for week in range(1, 19) if week != bye]).to_parquet(folder / "schedule.parquet", index=False)


def write_history(folder, scores):
    frame = pd.DataFrame([{
        "player_id": "qb1", "position": "QB", "team": "BUF", "season": 2026, "week": week, "points": points,
        "game_type": "REG" if week <= 18 else "POST", "opponent": "NE", "is_home": False, "passing_yards": 240,
        "rushing_yards": 32, "passing_tds": 2, "rushing_tds": 0, "receiving_tds": 0,
    } for week, points in scores])
    publish_recorded_games(frame, folder / RECORDED_GAMES_FILENAME)


def test_recorded_results_exclude_current_week_and_playoffs_and_keep_zero(card_files):
    write_history(card_files, [(1, 20.5), (2, 0.0), (3, -2.5), (4, 80), (19, 90)])
    result = history.recorded_player_history("qb1", "qb", 2026, 4, preseason=False)
    assert result["season_to_date"] == {"season": 2026, "points": 18.0, "ppg": 6.0, "games_played": 3, "through_week": 3, "complete": True}
    assert [row["week"] for row in result["game_log"]] == [3, 2, 1]
    assert result["game_log"][1]["points"] == 0
    assert result["game_log"][0]["passing_yards"] == 240
    assert result["game_log"][0]["touchdowns"] == 2
    assert result["game_log"][0]["team"] == "BUF"
    assert result["history_coverage"]["status"] == "complete"


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


def test_non_null_rows_do_not_prove_expected_game_coverage(card_files):
    write_history(card_files, [(1, 20), (3, 10)])
    result = history.recorded_player_history("qb1", "qb", 2026, 4, preseason=False)
    assert result["season_to_date"]["points"] is None
    assert result["season_to_date"]["complete"] is False
    assert result["history_coverage"]["expected_completed_weeks"] == [1, 2, 3]
    assert result["history_coverage"]["unverified_weeks"] == [2]
    assert result["history_coverage"]["reason"] == "unverified_participation"


def test_bye_does_not_create_a_missing_game(card_files):
    write_schedule(card_files, bye=2)
    write_history(card_files, [(1, 20), (3, 0)])
    result = history.recorded_player_history("qb1", "qb", 2026, 4, preseason=False)
    assert result["season_to_date"]["points"] == 20
    assert result["season_to_date"]["games_played"] == 2
    assert result["history_coverage"]["expected_completed_weeks"] == [1, 3]


def test_missing_or_partial_schedule_does_not_claim_complete(card_files):
    write_history(card_files, [(1, 20)])
    history.SCHEDULE_CACHE.unlink()
    result = history.recorded_player_history("qb1", "qb", 2026, 2, preseason=False)
    assert result["season_to_date"]["complete"] is False
    assert result["game_log"][0]["points"] == 20
    assert result["history_coverage"]["reason"] == "schedule_unavailable"
    pd.DataFrame([{"season": 2026, "week": 1, "game_type": "REG", "home_team": "BUF", "away_team": "NE", "home_score": 20, "away_score": 10}]).to_parquet(history.SCHEDULE_CACHE)
    assert history.recorded_player_history("qb1", "qb", 2026, 2, preseason=False)["season_to_date"]["complete"] is False


def test_schedule_without_final_score_is_not_a_completed_game(card_files):
    write_history(card_files, [(1, 20)])
    schedule = pd.read_parquet(history.SCHEDULE_CACHE)
    schedule.loc[schedule.week.eq(1), "away_score"] = float("nan")
    schedule.to_parquet(history.SCHEDULE_CACHE)
    result = history.recorded_player_history("qb1", "qb", 2026, 2, preseason=False)
    assert result["history_coverage"]["reason"] == "game_completion_unverified"
    assert result["season_to_date"]["points"] is None


def test_duplicate_games_are_not_arbitrarily_selected(card_files):
    write_history(card_files, [(1, 20), (1, 90), (2, 5)])
    result = history.recorded_player_history("qb1", "qb", 2026, 3, preseason=False)
    assert result["history_coverage"]["duplicate_weeks"] == [1]
    assert result["history_coverage"]["reason"] == "duplicate_recorded_games"
    assert [row["week"] for row in result["game_log"]] == [2]
    assert result["season_to_date"]["points"] is None


def test_rookie_missing_prior_participation_is_unknown(card_files):
    write_history(card_files, [(3, 0)])
    result = history.recorded_player_history("qb1", "qb", 2026, 4, preseason=False)
    assert result["game_log"][0]["points"] == 0
    assert result["history_coverage"]["unverified_weeks"] == [1, 2]
    assert result["season_to_date"]["points"] is None


def test_legacy_history_retains_same_game_attribution_and_true_te(card_files):
    pd.DataFrame([{"player_id": "te1", "position": "TE", "season": 2026, "week": 1, "team": "BUF", "opponent": "NE", "Fpts": 8.5,
                   "receiving_yards_lead": 45, "receptions_lead": 4, "receiving_tds_lead": 0}]).to_parquet(card_files / "wr_mlready.parquet")
    result = history.recorded_player_history("te1", "te", 2026, 2, preseason=False)
    assert result["history_coverage"]["source"] == "mlready_compatibility"
    assert result["game_log"][0]["position"] == "TE"
    assert result["game_log"][0]["week"] == 1
    assert result["game_log"][0]["points"] == 8.5
    assert result["game_log"][0]["receiving_yards"] == 45
    assert result["history_coverage"]["reason"] == "legacy_source_provenance"
    assert result["season_to_date"]["complete"] is False
    assert result["season_to_date"]["points"] is None
    assert history.recorded_player_history("te1", "wr", 2026, 2, preseason=False)["game_log"] == []


def test_explicit_no_participation_is_accounted_without_fabricating_a_game(card_files):
    write_history(card_files, [(1, 20), (2, 0)])
    path = card_files / RECORDED_GAMES_FILENAME
    frame = pd.read_parquet(path)
    frame["participated"] = [True, False]
    frame.loc[frame.week.eq(2), ["passing_yards", "rushing_yards", "passing_tds"]] = 0
    publish_recorded_games(frame, path)
    result = history.recorded_player_history("qb1", "qb", 2026, 3, preseason=False)
    assert result["history_coverage"]["no_participation_weeks"] == [2]
    assert result["history_coverage"]["unverified_weeks"] == []
    assert result["season_to_date"]["points"] == 20
    assert result["season_to_date"]["games_played"] == 1
    assert [r["week"] for r in result["game_log"]] == [1]


def test_conflicting_no_participation_cannot_claim_complete_history(card_files):
    write_history(card_files, [(1, 20), (2, 12)])
    path = card_files / RECORDED_GAMES_FILENAME
    frame = pd.read_parquet(path)
    frame["participated"] = [True, False]
    publish_recorded_games(frame, path)
    result = history.recorded_player_history("qb1", "qb", 2026, 3, preseason=False)
    assert result["history_coverage"]["reason"] == "invalid_participation"
    assert result["season_to_date"]["points"] is None
    assert result["season_to_date"]["complete"] is False


def test_no_participation_with_unknown_counters_is_accounted_without_filling_them(card_files):
    write_history(card_files, [(1, 20), (2, None)])
    path = card_files / RECORDED_GAMES_FILENAME
    frame = pd.read_parquet(path)
    frame["participated"] = [True, False]
    frame.loc[frame.week.eq(2), ["passing_yards", "rushing_yards", "passing_tds", "rushing_tds", "receiving_tds"]] = float("nan")
    publish_recorded_games(frame, path)
    result = history.recorded_player_history("qb1", "qb", 2026, 3, preseason=False)
    assert result["season_to_date"]["complete"] is True
    assert result["season_to_date"]["points"] == 20
    assert result["season_to_date"]["games_played"] == 1
    assert [r["week"] for r in result["game_log"]] == [1]
    assert pd.isna(pd.read_parquet(path).loc[1, "passing_yards"])


def test_corrupt_recorded_source_does_not_silently_fall_back(card_files):
    (card_files / RECORDED_GAMES_FILENAME).write_bytes(b"corrupt")
    result = history.recorded_player_history("qb1", "qb", 2026, 2, preseason=False)
    assert result["history_coverage"]["reason"] == "invalid_source"
    assert result["game_log"] == []


def test_unsupported_position_is_explicit(card_files):
    result = history.recorded_player_history("k1", "k", 2026, 4, preseason=False)
    assert result["history_coverage"]["status"] == "unsupported"


def test_legacy_week_18_before_2021_is_postseason(card_files):
    pd.DataFrame([{"player_id": "qb1", "season": 2020, "week": week, "team": "BUF", "Fpts": 10}
                  for week in (17, 18)]).to_parquet(card_files / "qb_mlready.parquet")
    result = history.recorded_player_history("qb1", "qb", 2021, 1, preseason=True)
    assert result["game_log_season"] == 2020
    assert [r["week"] for r in result["game_log"]] == [17]


def test_preseason_shows_prior_game_log_without_carrying_over_totals(card_files):
    write_history(card_files, [(1, 22), (18, 14), (19, 60)])
    result = history.recorded_player_history("qb1", "qb", 2027, 1, preseason=True)
    assert result["game_log_season"] == 2026
    assert [r["week"] for r in result["game_log"]] == [18, 1]
    assert result["season_to_date"]["points"] is None


def test_history_cache_invalidates_when_artifact_is_replaced(card_files):
    write_history(card_files, [(1, 10)])
    first = history.recorded_player_history("qb1", "qb", 2026, 3, preseason=False)
    assert first["game_log"][0]["points"] == 10
    assert first["history_coverage"]["source_through_week"] == 1
    assert first["season_to_date"]["points"] is None
    write_history(card_files, [(1, 10), (2, 25)])
    assert history.recorded_player_history("qb1", "qb", 2026, 3, preseason=False)["season_to_date"]["points"] == 35


@pytest.mark.parametrize("built_at,has_schedule,expected", [("2026-08-01T12:00:00Z", True, True), ("2026-10-01T12:00:00Z", True, False), (None, True, False), ("2026-08-01T12:00:00Z", False, False)])
def test_only_demonstrably_preseason_forecasts_supply_a_comparison(card_files, built_at, has_schedule, expected):
    pd.DataFrame([{"player_id": "qb1", "Season": 2026, "Season P50": 344.0, "Season P10": 283, "Season P90": 403}]).to_parquet(card_files / "pool_2026.parquet")
    (card_files / "pool_2026.meta.json").write_text(json.dumps({"season": 2026, "built_at": built_at, "games_per_season": 17}))
    if has_schedule:
        pd.DataFrame([{"season": 2026, "week": 1, "gameday": "2026-09-10"}]).to_parquet(history.SCHEDULE_CACHE)
    else:
        history.SCHEDULE_CACHE.unlink()
    result = history.saved_preseason_forecast("qb1", 2026)
    assert result["preseason_projection"]["p50"] == 344
    assert (result["preseason_baseline"] is not None) is expected


def test_preseason_baseline_uses_metadata_from_same_parquet_not_stale_sidecar(card_files):
    from src.projections.artifact_store import METADATA_ATTR
    frame = pd.DataFrame([{"player_id": "qb1", "Season": 2026, "Season P50": 344.0}])
    # A live-season replacement must not inherit the old file's preseason date.
    frame.attrs[METADATA_ATTR] = {"season": 2026, "built_at": "2026-10-01T12:00:00Z", "games_per_season": 17}
    frame.to_parquet(card_files / "pool_2026.parquet")
    (card_files / "pool_2026.meta.json").write_text(json.dumps({"season": 2026, "built_at": "2026-08-01T12:00:00Z", "games_per_season": 17}))
    pd.DataFrame([{"season": 2026, "week": 1, "gameday": "2026-09-10"}]).to_parquet(history.SCHEDULE_CACHE)
    result = history.saved_preseason_forecast("qb1", 2026)
    assert result["preseason_projection"]["p50"] == 344
    assert result["preseason_baseline"] is None
