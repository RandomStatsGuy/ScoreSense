"""Per-league Sleeper roster sync mode — the pause that keeps ScoreSense rosters as they are.

``live``  Sleeper sync writes rosters, contracts, and team membership (legacy behavior).
``off``   Nothing driven by Sleeper writes roster rows, contracts, or stored team
          membership. Read-only Sleeper data (scoring, team names, NFL calendar)
          keeps flowing.

A league with no saved mode is ``live``. The schema migration that adds the
column pauses every Sleeper-linked contract league that already exists, so a
deploy never opens a window where a sync can rewrite a hand-corrected league.

Guards live in the write functions themselves (``league_sleeper_sync``,
``cap_sheet_import``, ``in_season_contract_projection``) so no route or future
caller can get around them.
"""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage

SLEEPER_SYNC_LIVE = storage.SLEEPER_SYNC_LIVE
SLEEPER_SYNC_OFF = storage.SLEEPER_SYNC_OFF
SLEEPER_SYNC_MODES = storage.SLEEPER_SYNC_MODES

SKIPPED_PAUSED = "sleeper_sync_paused"

PAUSED_MESSAGE = (
    "Sleeper roster sync is paused for this league, so rosters stay as they are. "
    "A commissioner can turn it back on in Roster management → Access & imports."
)

SCORING_ONLY_MESSAGE = (
    "Sleeper roster sync is paused, so rosters stayed as they are. Scoring was refreshed from Sleeper."
)

UNLINK_CLEAR_PAUSED_MESSAGE = (
    "Sleeper roster sync is paused, so unlinking can't remove players that came from Sleeper. "
    "Keep those players, or turn sync back on first."
)


class SleeperSyncPaused(ValueError):
    """Raised when a Sleeper-driven roster write runs on a paused league.

    Subclasses ValueError so existing routes return it as a 400 with the message.
    """

    def __init__(self, message: str = PAUSED_MESSAGE) -> None:
        super().__init__(message)


def resolve_sleeper_sync_mode(league: dict[str, Any] | None) -> str:
    raw = str((league or {}).get("sleeper_sync_mode") or "").strip().lower()
    return raw if raw in SLEEPER_SYNC_MODES else SLEEPER_SYNC_LIVE


def sleeper_sync_paused(league_id: str | None) -> bool:
    if not league_id:
        return False
    return storage.league_sleeper_sync_paused(str(league_id))


def workspace_sleeper_sync_paused(workspace_id: str | None) -> bool:
    if not workspace_id:
        return False
    return storage.workspace_sleeper_sync_paused(str(workspace_id))


def team_sleeper_sync_paused(team_id: str | None) -> bool:
    if not team_id:
        return False
    return storage.team_sleeper_sync_paused(str(team_id))


def require_sleeper_roster_writes(league_id: str | None) -> None:
    if sleeper_sync_paused(league_id):
        raise SleeperSyncPaused()


def require_workspace_sleeper_roster_writes(workspace_id: str | None) -> None:
    if workspace_sleeper_sync_paused(workspace_id):
        raise SleeperSyncPaused()


def require_team_sleeper_roster_writes(team_id: str | None) -> None:
    if team_sleeper_sync_paused(team_id):
        raise SleeperSyncPaused()


def sleeper_sync_state(league: dict[str, Any] | None) -> dict[str, Any]:
    mode = resolve_sleeper_sync_mode(league)
    return {"mode": mode, "paused": mode == SLEEPER_SYNC_OFF}


def set_sleeper_sync_mode(league_id: str, mode: str) -> dict[str, Any]:
    normalized = str(mode or "").strip().lower()
    if normalized not in SLEEPER_SYNC_MODES:
        raise ValueError(f"Unknown Sleeper sync mode: {mode}")
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    storage.set_league_sleeper_sync_mode(league_id, normalized)
    return sleeper_sync_state(storage.get_league(league_id))
