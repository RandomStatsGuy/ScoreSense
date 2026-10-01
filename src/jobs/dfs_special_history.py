"""Refresh current-season observed special-teams outcomes, never on HTTP reads."""
import io
import pandas as pd
import requests
from src.projections.dfs_special_teams import score_history


def _refresh_special_history(season, retained):
    url = f"https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_{int(season)}.parquet"
    response = requests.get(url, timeout=30)
    if response.status_code == 404:
        # Before the season begins no current game file exists. Keep explicitly
        # historical training data; never manufacture a current game row.
        out = retained.copy()
        out.attrs["current_season_available"] = False
        return out
    response.raise_for_status()
    teams = pd.read_parquet(io.BytesIO(response.content))
    schedule_response = requests.get("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", timeout=30)
    schedule_response.raise_for_status()
    games = pd.read_csv(io.StringIO(schedule_response.text))
    current = score_history(teams, games)
    out = pd.concat([retained[retained.season.ne(season)], current], ignore_index=True).sort_values(["season", "week", "game_id", "team"])
    out.attrs["current_season_available"] = not current.empty
    return out


def refresh_special_history(season, retained):
    try:
        return _refresh_special_history(season, retained)
    except requests.RequestException:
        # Forecast the requested matchup from known historical inputs when a
        # transient feed outage occurs. Freshness remains explicitly failed.
        import logging
        logging.getLogger(__name__).warning('Current special-teams feed unavailable; retaining historical inputs', exc_info=True)
        out=retained.copy()
        out.attrs.update(current_season_available=False, input_refresh_failed=True)
        return out
