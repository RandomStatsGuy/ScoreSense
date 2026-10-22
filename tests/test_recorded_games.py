"""Raw recorded facts must survive ETL without training semantics/defaults."""
import json

import pandas as pd
import pyarrow.parquet as pq
import pytest

from src.etl import recorded_games as recorded


@pytest.fixture
def source():
    # Recorded Pickens 2026 W1 facts reconciled with the locally cached raw
    # provider snapshot: 3 catches, 28 yards, no TD = 5.8 standard PPR points.
    rows = [{"player_id": "00-0037247", "position": "WR", "team": "DAL", "season": 2026, "week": 1,
             "fantasy_points_ppr": 5.8, **{col: 0 for col in recorded.GAME_STATS}, "receptions": 3, "receiving_yards": 28},
            {"player_id": "00-0037247", "position": "WR", "team": "PIT", "season": 2026, "week": 2,
             "fantasy_points_ppr": 12.0, **{col: 0 for col in recorded.GAME_STATS}, "rushing_tds": 2}]
    games = [{"season": 2026, "week": 1, "game_type": "REG", "home_team": "NYG", "away_team": "DAL", "game_id": "2026_01_DAL_NYG", "gameday": "2026-09-13"},
             {"season": 2026, "week": 2, "game_type": "REG", "home_team": "PIT", "away_team": "CLE", "game_id": "2026_02_CLE_PIT", "gameday": "2026-09-20"}]
    return pd.DataFrame(rows), pd.DataFrame(games)


def test_faithful_same_game_period_team_and_full_stats(source):
    result = recorded.build_recorded_games(*source)
    assert result["week"].tolist() == [1, 2]
    assert result["team"].tolist() == ["DAL", "PIT"]
    assert result["opponent"].tolist() == ["NYG", "CLE"]
    assert result["points"].tolist() == [5.8, 12]
    assert result["rushing_tds"].tolist() == [0, 2]
    assert result["game_id"].tolist() == ["2026_01_DAL_NYG", "2026_02_CLE_PIT"]
    assert result["is_home"].tolist() == [False, True]


def test_missing_provider_points_and_counters_are_not_defaulted(source):
    weekly, schedules = source
    weekly.loc[0, "fantasy_points_ppr"] = None
    weekly.loc[1, "receptions"] = None
    result = recorded.build_recorded_games(weekly, schedules)
    assert pd.isna(result.loc[0, "points"])
    assert pd.isna(result.loc[1, "receptions"])
    assert result.loc[0, "rushing_yards"] == 0


def test_missing_provider_total_is_not_recomputed_with_abbreviated_model_weights(source):
    weekly, schedules = source
    weekly = weekly.drop(columns="fantasy_points_ppr")
    assert recorded.build_recorded_games(weekly, schedules)["points"].isna().all()


def test_explicit_participation_is_preserved_and_absence_stays_unknown(source):
    weekly, schedules = source
    assert recorded.build_recorded_games(weekly, schedules)["participated"].isna().all()
    weekly["gp"] = [1, 0]
    weekly.loc[1, ["fantasy_points_ppr", *recorded.GAME_STATS]] = 0
    assert recorded.build_recorded_games(weekly, schedules)["participated"].tolist() == [True, False]


@pytest.mark.parametrize("field", ["fantasy_points_ppr", "rushing_tds", "receptions"])
def test_contradictory_no_participation_is_rejected_before_publication(source, field):
    weekly, schedules = source
    weekly["gp"] = [1, 0]
    weekly.loc[1, ["fantasy_points_ppr", *recorded.GAME_STATS]] = 0
    weekly.loc[1, field] = 1
    with pytest.raises(ValueError, match="no-participation.*nonzero"):
        recorded.build_recorded_games(weekly, schedules)


def test_no_participation_preserves_unknown_counters_and_total(source):
    weekly, schedules = source
    weekly["gp"] = [1, 0]
    weekly.loc[1, ["fantasy_points_ppr", *recorded.GAME_STATS]] = None
    result = recorded.build_recorded_games(weekly, schedules)
    assert result.loc[1, "participated"] == False
    assert pd.isna(result.loc[1, "points"])
    assert result.loc[1, list(recorded.GAME_STATS)].isna().all()


def test_postseason_schedule_labels_match_provider_postseason(source):
    weekly, schedules = source
    weekly["season_type"] = "POST"
    schedules["game_type"] = "WC"
    assert recorded.build_recorded_games(weekly, schedules)["game_type"].tolist() == ["POST", "POST"]


@pytest.mark.parametrize("target", ["stats", "schedule"])
def test_duplicate_keys_fail_before_join_can_multiply_results(source, target):
    weekly, schedules = source
    if target == "stats":
        weekly = pd.concat([weekly, weekly.iloc[[0]]], ignore_index=True)
    else:
        schedules = pd.concat([schedules, schedules.iloc[[0]]], ignore_index=True)
    with pytest.raises(ValueError, match="duplicate"):
        recorded.build_recorded_games(weekly, schedules)


def test_game_type_disagreement_is_rejected(source):
    weekly, schedules = source
    weekly["season_type"] = "POST"
    with pytest.raises(ValueError, match="game type"):
        recorded.build_recorded_games(weekly, schedules)


def test_metadata_and_data_are_published_as_one_file(source, tmp_path):
    frame = recorded.build_recorded_games(*source)
    path = tmp_path / recorded.RECORDED_GAMES_FILENAME
    recorded.publish_recorded_games(frame, path)
    metadata = json.loads(pq.read_schema(path).metadata[recorded.METADATA_KEY])
    assert metadata["source_through_week"] == {"2026": 2}
    assert metadata["ingested_at"]
    assert metadata["rows"] == 2
    assert pd.read_parquet(path)["points"].tolist() == [5.8, 12]


def test_publication_failure_retains_last_good_source(source, tmp_path, monkeypatch):
    frame = recorded.build_recorded_games(*source)
    path = tmp_path / recorded.RECORDED_GAMES_FILENAME
    recorded.publish_recorded_games(frame, path)
    original = path.read_bytes()
    monkeypatch.setattr(recorded.os, "replace", lambda *_: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError, match="disk full"):
        recorded.publish_recorded_games(frame, path)
    assert path.read_bytes() == original
    assert list(tmp_path.glob("*.tmp")) == []


def test_existing_etl_publishes_actuals_before_model_defaults(source, tmp_path, monkeypatch):
    from src.etl import nflverse_etl as etl
    weekly, schedules = source
    weekly.loc[0, "fantasy_points_ppr"] = None
    monkeypatch.setattr(etl, "load_weekly_player_stats", lambda _: weekly)
    monkeypatch.setattr(etl, "load_schedules", lambda _: schedules)
    monkeypatch.setattr(etl, "load_play_by_play", lambda _: pd.DataFrame())
    monkeypatch.setattr(etl, "load_team_epa", lambda *_, **__: pd.DataFrame())
    monkeypatch.setattr(etl, "FEATURE_REGISTRY", {"wr": object()})
    monkeypatch.setattr(etl, "merge_target_quality_into_wr_features", None)
    monkeypatch.setattr(etl, "build_position_dataset", lambda *_: pd.DataFrame([{"Fpts": 0, "week": 1}]))
    etl.build_all_datasets(seasons=[2026], output_dir=tmp_path, enrich_analytics=False)
    actuals = pd.read_parquet(tmp_path / recorded.RECORDED_GAMES_FILENAME)
    model = pd.read_parquet(tmp_path / "wr_mlready.parquet")
    assert pd.isna(actuals.loc[0, "points"])
    assert actuals.loc[1, "rushing_tds"] == 2
    assert model.loc[0, "Fpts"] == 0
