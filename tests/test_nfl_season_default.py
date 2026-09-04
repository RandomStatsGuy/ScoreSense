"""New workspaces default to the current NFL season, not a hardcoded year."""

from datetime import datetime, timezone

from src.draft_hub.storage import current_nfl_season


def test_current_nfl_season_uses_calendar_year_after_february():
    assert current_nfl_season(datetime(2026, 9, 4, tzinfo=timezone.utc)) == 2026
    assert current_nfl_season(datetime(2026, 2, 1, tzinfo=timezone.utc)) == 2025
    assert current_nfl_season(datetime(2026, 3, 1, tzinfo=timezone.utc)) == 2026
