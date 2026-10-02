"""Keep historical and current schedule inputs available across refresh jobs."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pandas as pd
import pytest

from src.core import schedule_utils as schedule
from src.core.artifact_revision import file_content_revision


def schedule_rows(season):
    return pd.DataFrame({"season": [season], "week": [4], "home_team": ["BUF"],
                         "away_team": ["NE"], "total_line": [45.5],
                         "market_fetched_at_utc": [f"{season}-09-30T12:00:00+00:00"]})


@pytest.fixture
def schedule_cache(tmp_path, monkeypatch):
    path = tmp_path / "nfl_schedules.parquet"
    monkeypatch.setattr(schedule, "SCHEDULE_CACHE", path)
    schedule._schedule_snapshot.cache_clear()
    schedule_rows(2026).to_parquet(path, index=False)
    return path


def test_missing_historical_season_keeps_current_inputs_and_stops_rewrites(schedule_cache, monkeypatch):
    calls = []
    def fetch(years):
        calls.append(years)
        return schedule_rows(years[0])
    monkeypatch.setattr("src.etl.nflverse_etl.load_schedules", fetch)
    current = pd.read_parquet(schedule_cache)
    assert set(schedule._load_schedules([2025]).season) == {2025}
    merged = pd.read_parquet(schedule_cache)
    assert set(merged.season) == {2025, 2026}
    pd.testing.assert_frame_equal(merged[merged.season.eq(2026)].reset_index(drop=True), current)
    revision = file_content_revision(schedule_cache)
    for year in (2026, 2025, 2026, 2025):
        assert set(schedule._load_schedules([year]).season) == {year}
        assert file_content_revision(schedule_cache) == revision
    assert calls == [[2025]]


def test_multi_season_request_fetches_missing_coverage(schedule_cache, monkeypatch):
    calls = []
    monkeypatch.setattr("src.etl.nflverse_etl.load_schedules",
                        lambda years: calls.append(years) or schedule_rows(2025))
    assert set(schedule._load_schedules([2025, 2026]).season) == {2025, 2026}
    assert calls == [[2025]]


def test_artifact_only_read_returns_available_years_without_writes(schedule_cache, monkeypatch):
    def forbidden(*args):
        raise AssertionError("Network on an artifact-only schedule read")
    monkeypatch.setattr("src.etl.nflverse_etl.load_schedules", forbidden)
    before = schedule_cache.read_bytes()
    assert schedule._load_schedules([2025], allow_fetch=False).empty
    assert set(schedule._load_schedules([2025, 2026], allow_fetch=False).season) == {2026}
    assert schedule_cache.read_bytes() == before


def test_empty_fetch_preserves_cached_schedule(schedule_cache, monkeypatch):
    monkeypatch.setattr("src.etl.nflverse_etl.load_schedules", lambda years: pd.DataFrame())
    before = schedule_cache.read_bytes()
    assert schedule._load_schedules([2025]).empty
    assert schedule_cache.read_bytes() == before
    assert not list(schedule_cache.parent.glob("*.tmp"))


def test_interrupted_schedule_publication_preserves_previous_file(schedule_cache, monkeypatch):
    before = schedule_cache.read_bytes()
    def interrupted(*args, **kwargs):
        raise OSError("Disk unavailable")
    monkeypatch.setattr(pd.DataFrame, "to_parquet", interrupted)
    with pytest.raises(OSError, match="Disk unavailable"):
        schedule.save_schedule_snapshot(schedule_rows(2025), schedule_cache)
    assert schedule_cache.read_bytes() == before
    assert not list(schedule_cache.parent.glob("*.tmp"))


def test_concurrent_missing_season_fetches_preserve_both_results(schedule_cache, monkeypatch):
    barrier = Barrier(2)
    def fetch(years):
        barrier.wait(timeout=5)
        return schedule_rows(years[0])
    monkeypatch.setattr("src.etl.nflverse_etl.load_schedules", fetch)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda year: schedule._load_schedules([year]), [2024, 2025]))
    assert [set(result.season) for result in results] == [{2024}, {2025}]
    assert set(pd.read_parquet(schedule_cache).season) == {2024, 2025, 2026}
    assert not list(schedule_cache.parent.glob("*.tmp"))


def test_real_multiseason_finalization_keeps_all_forecasts_and_valuations_readable(
        schedule_cache, hub_db, tmp_path, monkeypatch):
    import src.config as config
    from src.projections import weekly_cache, ros_cache, input_policy
    from src.draft_hub import draft_pool_cache, storage, value_sheet
    from src.draft_hub.schemas import LeagueRules
    from src.draft_hub.value_snapshot_warmup import warm_fantasy_value_snapshots
    from src.jobs import projection_cache_warmup as warmup

    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(input_policy, "CACHE_DIR", tmp_path)
    monkeypatch.setattr("src.etl.nflverse_etl.load_schedules", lambda years: schedule_rows(years[0]))
    monkeypatch.setattr("src.integrations.roster_identity.apply_roster_identity_with_attrs", lambda f, *a, **k: f.copy())
    monkeypatch.setattr("src.integrations.roster_identity.identity_stamp", lambda year: "local-identity")
    monkeypatch.setattr(value_sheet, "load_k_def_rows", lambda *a, **k: [])
    for module, directory in ((weekly_cache, "WEEKLY_PREDICTIONS_DIR"),
                              (ros_cache, "ROS_PREDICTIONS_DIR"),
                              (draft_pool_cache, "DRAFT_POOL_DIR")):
        monkeypatch.setattr(module, directory, tmp_path / directory)
        monkeypatch.setattr(module, "PROCESSED_DATA_DIR", tmp_path / "processed")
        monkeypatch.setattr(module, "MODEL_DIR", tmp_path / "models")
        monkeypatch.setattr(module, "_with_roster_identity", lambda f, *a, **k: f.copy())
    monkeypatch.setattr("src.projections.projection_movement.save_projection_movement_artifact", lambda *a, **k: None)
    frame = pd.DataFrame({"Player": ["Test TE"], "player_id": ["te"], "Position": ["TE"],
                          "Team": ["BUF"], "Projected Points": [12.], "Per-Game Proj": [12.],
                          "Season Proj": [180.], "ROS P10": [60.], "ROS P50": [120.], "ROS P90": [180.]})
    def predict(*args, season, **kwargs):
        schedule._load_schedules([season])
        if season == 2025:
            # Real input discovery during an older pool's first computation.
            roster = tmp_path / "nflverse_roster_2025.parquet"
            if not roster.exists():
                pd.DataFrame({"player_id": ["te"]}).to_parquet(roster, index=False)
        return frame.copy()
    monkeypatch.setattr(weekly_cache, "predict_upcoming_week", predict)
    monkeypatch.setattr(ros_cache, "predict_rest_of_season", predict)
    monkeypatch.setattr(draft_pool_cache, "_compute_pool", lambda year: (predict(season=year), {}))
    monkeypatch.setattr(warmup, "prewarm_injury_overlays", lambda *a, **k: {"status": "ok"})
    monkeypatch.setattr(warmup, "prewarm_player_context", lambda *a: {"status": "ok"})
    monkeypatch.setattr(warmup, "prewarm_week_context", lambda *a: {"inj1": {"status": "current"}, "inj0": {"status": "current"}})
    workspace_rules = {}
    for year in (2025, 2026):
        workspace = storage.get_or_create_workspace(f"manager-{year}", season=year)
        workspace_rules[year] = LeagueRules.model_validate(workspace["rules"])
        storage.create_league(f"manager-{year}", name=f"Season {year}", season=year,
                              rules=LeagueRules(), team_count=10)

    # Run the actual finalizer and actual valuation warmer with persisted
    # forecasts, not an always-valid mock of the failing reader.
    result = warmup.finalize_projection_caches(2026, 4, 2026)
    assert result["projection_cache_readiness"] == {"status": "ready", "attempts": 2}
    assert result["fantasy_value_snapshots"] == {"prepared": 4, "unavailable": 0, "failed_seasons": []}
    revision = warmup._input_revision()
    draft_pool_cache.invalidate_pool_cache()
    weekly_cache.invalidate_weekly_cache()
    ros_cache.invalidate_ros_cache()
    value_sheet.invalidate_pool_payload_cache()
    assert warmup._artifacts_readable(2026, 4, 2026)
    for year in (2025, 2026):
        assert not draft_pool_cache.load_draft_pool(year, allow_compute=False, apply_identity=False).empty
        assert draft_pool_cache.pool_artifact_status(year)["stale"] is False
        for teams, rules in ((10, LeagueRules()), (12, workspace_rules[year])):
            payload = value_sheet.peek_pool_payload_cache(year, rules, [], team_count=teams)
            assert payload and payload["count"] == 1
    assert warm_fantasy_value_snapshots()["unavailable"] == 0
    assert warmup._input_revision() == revision
    assert set(pd.read_parquet(schedule_cache).season) == {2025, 2026}
