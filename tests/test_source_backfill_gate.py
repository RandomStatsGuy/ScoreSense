"""A completed source backfill covers every finalized prior-week team game."""
import pandas as pd
import pytest

from src.projections import data_integrity as integrity
from src.etl.recorded_games import RECORDED_GAMES_FILENAME, publish_recorded_games


@pytest.fixture
def backfill(tmp_path, monkeypatch):
    monkeypatch.setattr(integrity, "PROCESSED_DATA_DIR", tmp_path)
    schedule = tmp_path / "schedule.parquet"
    monkeypatch.setattr(integrity, "SCHEDULE_CACHE", schedule)
    pd.DataFrame([
        {"season": 2026, "week": 1, "game_type": "REG", "home_team": "DAL", "away_team": "NYG", "home_score": 20, "away_score": 17},
        {"season": 2026, "week": 2, "game_type": "REG", "home_team": "DAL", "away_team": "PHI", "home_score": 21, "away_score": 14},
        {"season": 2026, "week": 3, "game_type": "REG", "home_team": "DAL", "away_team": "CHI", "home_score": None, "away_score": None},
    ]).to_parquet(schedule)
    rows = pd.DataFrame([
        {"season": 2026, "week": week, "game_type": "REG", "team": team, "points": 0.0}
        for week, teams in ((1, ("DAL", "NYG")), (2, ("DAL", "PHI")))
        for team in teams
    ])
    path = tmp_path / RECORDED_GAMES_FILENAME
    return rows, path


def test_completed_backfill_reports_validated_game_and_source_cutoffs(backfill):
    rows, path = backfill
    publish_recorded_games(rows, path)
    result = integrity.validate_recorded_backfill(season=2026, week=3)
    assert result["status"] == "ready"
    assert result["completed_games"] == 2
    assert result["completed_team_games"] == 4
    assert result["source_through_week"] == 2
    assert result["source_ingested_at"]


def test_partial_latest_week_fails_even_when_maximum_week_looks_current(backfill):
    rows, path = backfill
    publish_recorded_games(rows[rows["team"].ne("PHI")], path)
    with pytest.raises(ValueError, match="missing finalized team games week 2 PHI"):
        integrity.validate_recorded_backfill(season=2026, week=3)


def test_missing_entire_completed_week_is_not_reported_as_finished(backfill):
    rows, path = backfill
    publish_recorded_games(rows[rows["week"].eq(1)], path)
    with pytest.raises(ValueError, match="source_backfill_incomplete"):
        integrity.validate_recorded_backfill(season=2026, week=3)


def test_unattested_source_is_rejected(backfill):
    rows, path = backfill
    rows.to_parquet(path)
    with pytest.raises(ValueError, match="source_backfill_recorded_schema_invalid"):
        integrity.validate_recorded_backfill(season=2026, week=3)
