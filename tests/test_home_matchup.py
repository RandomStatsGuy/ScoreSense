from datetime import datetime
from unittest.mock import patch

import pandas as pd
import pytest

from src.draft_hub.home_matchup import home_matchup_window


def schedule(last="2026-09-28", time="20:15"):
    return pd.DataFrame([
        {"season": 2026, "week": 3, "game_type": "REG", "gameday": "2026-09-24", "gametime": "20:15"},
        {"season": 2026, "week": 3, "game_type": "REG", "gameday": last, "gametime": time},
        {"season": 2026, "week": 4, "game_type": "REG", "gameday": "2026-10-01", "gametime": "20:15"},
        {"season": 2026, "week": 4, "game_type": "REG", "gameday": "2026-10-05", "gametime": "20:15"},
    ])


@pytest.mark.parametrize("at,week,mode", [
    ("2026-09-29T23:59:59-04:00", 3, "scores"),
    ("2026-09-30T00:00:00-04:00", 4, "projected"),
    ("2026-09-29T21:00:00-07:00", 4, "projected"),
    ("2026-10-01T20:14:59-04:00", 4, "projected"),
    ("2026-10-01T20:15:00-04:00", 4, "scores"),
])
def test_wednesday_and_kickoff_boundaries(at, week, mode):
    with patch("src.draft_hub.home_matchup._load_schedules", return_value=schedule()):
        assert home_matchup_window(2026, now=datetime.fromisoformat(at)) == {"week": week, "home_display_mode": mode}


def test_delayed_game_keeps_its_week_until_its_playing_window_ends():
    with patch("src.draft_hub.home_matchup._load_schedules", return_value=schedule("2026-09-30", "13:00")):
        assert home_matchup_window(2026, now=datetime.fromisoformat("2026-09-30T00:00:00-04:00"))["week"] == 3
        assert home_matchup_window(2026, now=datetime.fromisoformat("2026-09-30T19:00:00-04:00"))["week"] == 4


def test_missing_schedule_is_not_a_guessed_week():
    with patch("src.draft_hub.home_matchup._load_schedules", return_value=pd.DataFrame()):
        assert home_matchup_window(2026) is None


def test_season_end_does_not_invent_a_nineteenth_regular_week():
    frame = pd.DataFrame([{"season": 2026, "week": 18, "game_type": "REG", "gameday": "2027-01-10", "gametime": "20:15"}])
    with patch("src.draft_hub.home_matchup._load_schedules", return_value=frame):
        assert home_matchup_window(2026, now=datetime.fromisoformat("2027-01-20T00:00:00-05:00")) == {"week": 18, "home_display_mode": "scores"}
