from datetime import datetime, timezone

import pandas as pd
import pytest

from src.core import schedule_utils as schedule
from src.draft_hub.hub_scoring import nfl_week_started


def test_week_started_uses_first_et_kickoff_from_saved_schedule_only(tmp_path, monkeypatch):
    path = tmp_path / "schedule.parquet"
    monkeypatch.setattr(schedule, "SCHEDULE_CACHE", path)
    pd.DataFrame([
        {"season":2026,"week":4,"gameday":"2026-10-04","gametime":"13:00"},
        {"season":2026,"week":4,"gameday":"2026-10-01","gametime":"20:15"},
        {"season":2026,"week":3,"gameday":"2026-09-24","gametime":"20:15"},
    ]).to_parquet(path)
    def forbidden(*args): raise AssertionError("live schedule fetch on status read")
    monkeypatch.setattr("src.etl.nflverse_etl.load_schedules", forbidden)
    assert nfl_week_started(2026, 4, now=datetime(2026,10,2,0,14,tzinfo=timezone.utc)) is False
    assert nfl_week_started(2026, 4, now=datetime(2026,10,2,0,15,tzinfo=timezone.utc)) is True
    assert nfl_week_started(2025, 4) is None
    path.unlink()
    assert nfl_week_started(2026, 4) is None


@pytest.mark.parametrize("time", [None, "", "unknown", "25:00"])
def test_unknown_kickoff_cannot_hide_missing_statistics(monkeypatch, time):
    monkeypatch.setattr(schedule, "_load_schedules", lambda *a, **kw: pd.DataFrame([
        {"season":2026,"week":4,"gameday":"2026-10-01","gametime":time}]))
    assert nfl_week_started(2026, 4) is None


def test_first_kickoff_keeps_utc_midnight_calendar_date(monkeypatch):
    monkeypatch.setattr(schedule, "_load_schedules", lambda *a, **kw: pd.DataFrame([
        {"season":2026,"week":4,"gameday":pd.Timestamp("2026-10-01",tz="UTC"),"gametime":"20:15"}]))
    assert nfl_week_started(2026, 4, now=datetime(2026,10,1,23,tzinfo=timezone.utc)) is False


def test_first_kickoff_ignores_other_season_types_with_same_week(monkeypatch):
    monkeypatch.setattr(schedule, "_load_schedules", lambda *a, **kw: pd.DataFrame([
        {"season":2026,"week":4,"gameday":"2026-08-27","gametime":"20:15","game_type":"PRE"},
        {"season":2026,"week":4,"gameday":"2027-02-07","gametime":"18:30","game_type":"SB"},
        {"season":2026,"week":4,"gameday":"2026-10-01","gametime":"20:15","game_type":"REG"}]))
    assert nfl_week_started(2026, 4, now=datetime(2026,9,30,tzinfo=timezone.utc)) is False
