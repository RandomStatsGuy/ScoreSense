"""One-click mock draft rooms — quick bots or league-name mirror."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from src.draft_hub import storage
from src.draft_hub.draft_state import get_room_state, start_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.test_draft import setup_test_draft

MockDraftMode = Literal["quick_bots", "league_mirror"]


def _mirror_bot_names(source_league_id: str, commissioner_sub: str) -> list[str]:
    teams = storage.list_league_teams(source_league_id)
    viewer = storage.get_team_by_user(source_league_id, commissioner_sub)
    viewer_id = str(viewer["id"]) if viewer else None
    names: list[str] = []
    for team in teams:
        if team.get("is_bot"):
            continue
        if viewer_id and str(team["id"]) == viewer_id:
            continue
        label = str(team.get("name") or "Manager").strip()
        if not label:
            continue
        names.append(f"{label} (Mock)")
    return names


def start_mock_draft(
    commissioner_sub: str,
    *,
    mode: MockDraftMode,
    season: int = 2025,
    team_count: int = 12,
    bot_count: int = 7,
    source_league_id: str | None = None,
    auto_start: bool = True,
    name: str | None = None,
) -> dict[str, Any]:
    """Create a sandbox mock draft and optionally start the auction immediately."""
    rules = load_preset("salary_cap_auction_v1")
    team_count = max(2, min(int(team_count), 24))
    bot_count = max(1, min(int(bot_count), 11))

    if mode == "league_mirror":
        if not source_league_id:
            raise ValueError("source_league_id required for league_mirror mock")
        source = storage.get_league(source_league_id)
        if not source:
            raise ValueError("Source league not found")
        viewer = storage.get_team_by_user(source_league_id, commissioner_sub)
        if not viewer and source.get("commissioner_sub") != commissioner_sub:
            raise ValueError("You must be a member of the source league")
        display_name = name or f"{source.get('name', 'League')} — mock draft"
    else:
        display_name = name or "Quick mock draft"

    league = storage.create_league(
        commissioner_sub,
        display_name,
        season,
        rules,
        team_count=team_count,
        workspace_id=None,
        test_mode=True,
    )
    league_id = league["id"]

    if mode == "league_mirror":
        mirror_names = _mirror_bot_names(source_league_id, commissioner_sub)
        if viewer:
            comm_teams = [t for t in storage.list_league_teams(league_id) if t.get("is_commissioner")]
            if comm_teams:
                storage.update_team_display_name(comm_teams[0]["id"], str(viewer.get("name") or "My team"))
        budget = float(rules.salary_cap)
        added = 0
        for label in mirror_names:
            if added >= team_count - 1:
                break
            bot_id = str(uuid.uuid4())
            storage.add_bot_team(league_id, bot_id, label, budget)
            added += 1
        if added == 0:
            setup_test_draft(league_id, commissioner_sub, bot_count=min(bot_count, team_count - 1))
        else:
            storage.update_league_test_mode(league_id, True)
    else:
        setup_test_draft(
            league_id,
            commissioner_sub,
            bot_count=min(bot_count, team_count - 1),
        )

    if auto_start:
        start_draft(league_id, commissioner_sub)

    return {
        "mock_mode": mode,
        "league_id": league_id,
        "auto_started": auto_start,
        "state": get_room_state(league_id, commissioner_sub),
    }
