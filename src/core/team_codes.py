"""Normalize NFL team codes across nflverse, mlready, and Sleeper."""

from __future__ import annotations

# Sleeper / some APIs use LAR; mlready + nflverse schedules use LA.
SLEEPER_TO_MLREADY: dict[str, str] = {
    "LAR": "LA",
}

MLREADY_TO_SCHEDULE: dict[str, str] = {
    "LA": "LA",
}


def normalize_team_to_mlready(team: str) -> str:
    team = str(team or "").strip().upper()
    return SLEEPER_TO_MLREADY.get(team, team)


def normalize_team_to_schedule(team: str) -> str:
    team = normalize_team_to_mlready(team)
    return MLREADY_TO_SCHEDULE.get(team, team)
