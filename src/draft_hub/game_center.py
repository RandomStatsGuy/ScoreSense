"""Game Center presentation data from cached schedules and frozen room baselines."""
from __future__ import annotations

import copy
from datetime import datetime, timezone, timedelta

import pandas as pd

from src.core.team_codes import normalize_team_for_match


def cached_game_states(season: int, week: int, *, now=None) -> dict:
    # Never trigger schedule ETL or a provider request on this presentation path.
    from src.core.schedule_utils import SCHEDULE_CACHE, schedule_kickoff_utc

    if not SCHEDULE_CACHE.exists():
        return {}
    try:
        schedules = pd.read_parquet(SCHEDULE_CACHE)
        rows = schedules[(schedules.season == season) & (schedules.week == week)]
        if "game_type" in rows:
            rows = rows[rows.game_type == "REG"]
        clock = pd.Timestamp(now or datetime.now(timezone.utc))
        result = {}
        for _, row in rows.iterrows():
            kickoff = schedule_kickoff_utc(row.get("gameday"), row.get("gametime"))
            complete = pd.notna(row.get("home_score")) and pd.notna(row.get("away_score"))
            state = "final" if complete else "live" if kickoff is not None and kickoff <= clock < kickoff + timedelta(hours=6) else "pregame" if kickoff is not None and kickoff > clock else "unknown"
            for team in (row.home_team, row.away_team):
                result[normalize_team_for_match(str(team).upper())] = {
                    "game_state": state,
                    "kickoff_at": kickoff.isoformat() if kickoff is not None else None,
                }
        return result
    except (OSError, ValueError, TypeError, KeyError):
        return {}


def game_center_payload(payload: dict, league_id: str, *, game_states=None) -> dict:
    """Enrich a copy: shared scoring caches must stay viewer-independent."""
    from src.draft_hub.team_room import projection_snapshots

    out = copy.deepcopy(payload)
    try:
        season, week = int(out["season"]), int(out["week"])
    except (KeyError, ValueError, TypeError):
        return out
    states = cached_game_states(season, week) if game_states is None else game_states
    out["has_live_games"] = any(g.get("game_state") == "live" for g in states.values()) and not out.get("preseason")
    if not out.get("scoring_control") and states and all(g.get("game_state") == "final" for g in states.values()) and not out.get("preseason"):
        out["week_complete"] = True
        out["live"] = False
    players = []
    for matchup in out.get("matchups") or []:
        for team in matchup.get("teams") or []:
            for player in (team.get("starters") or []) + (team.get("bench_players") or []):
                game = states.get(normalize_team_for_match(str(player.get("team") or "").upper()), {})
                state = game.get("game_state", "unknown")
                if (out.get("scoring_control") or {}).get("final") or (not out.get("scoring_control") and not out.get("placeholder") and week < int(out.get("current_week") or week)):
                    state = "final"
                if out.get("preseason"):
                    state = "pregame"
                player.update(game, game_state=state)
                if player.get("player_id"):
                    players.append(player)
    snapshots = projection_snapshots(league_id, season, week, [
        (p["player_id"], p.get("proj"), p["game_state"] != "pregame") for p in players
    ])
    for player in players:
        player["pregame_projection"] = snapshots.get(player["player_id"])
    return out
