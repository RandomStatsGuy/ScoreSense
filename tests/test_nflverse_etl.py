from __future__ import annotations

from unittest.mock import Mock

import pandas as pd
import pytest

from src.etl import nflverse_etl


def _pbp(season: int) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "season": season,
                "week": 1,
                "defteam": "BUF",
                "epa": 0.2,
                "play_type": "pass",
                "pass": 1,
                "rush": 0,
            },
            {
                "season": season,
                "week": 1,
                "defteam": "BUF",
                "epa": -0.1,
                "play_type": "run",
                "pass": 0,
                "rush": 1,
            },
        ]
    )


def test_team_epa_skips_unpublished_latest_season(monkeypatch):
    nfl = Mock()
    nfl.import_pbp_data.side_effect = [_pbp(2025), NameError("Error is not defined")]
    monkeypatch.setattr(nflverse_etl, "_import_nfl_data_py", lambda: nfl)

    result = nflverse_etl.load_team_epa([2025, 2026])

    assert set(result["season"]) == {2025}
    assert result.iloc[0]["opponent"] == "BUF"


def test_team_epa_still_fails_when_historical_pbp_is_missing(monkeypatch):
    nfl = Mock()
    nfl.import_pbp_data.side_effect = RuntimeError("historical PBP unavailable")
    monkeypatch.setattr(nflverse_etl, "_import_nfl_data_py", lambda: nfl)

    with pytest.raises(RuntimeError, match="historical PBP unavailable"):
        nflverse_etl.load_team_epa([2025, 2026])
