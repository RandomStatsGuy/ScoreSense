"""Free-agent availability must reflect active rosters, not the keeper question.

`retained_through_draft` answers "is this contract still on the books for the
draft". Its pre-draft fallback is `is_current_auction_award`, which is never
true in a pick draft, so before this every rostered player in a no-contract
league showed up as a free agent.
"""

from __future__ import annotations

import pytest

from src.draft_hub.schemas import LeagueRules
from src.draft_hub.value_sheet import build_value_overlay

SNAKE = LeagueRules(draft_type="snake", salary_cap=0)
AUCTION = LeagueRules(draft_type="auction", salary_cap=200)


def _pool(*player_ids: str) -> dict:
    return {
        "season": 2026,
        "team_count": 6,
        "rows": [
            {"player_id": pid, "player_name": f"Player {pid}", "position": "RB", "fair_value": 10.0}
            for pid in player_ids
        ],
    }


def _slot(player_id: str, *, team_id: str = "team-a", **extra) -> dict:
    row = {
        "player_id": player_id,
        "player_name": f"Player {player_id}",
        "position": "RB",
        "team_id": team_id,
        "salary": 0,
        "contract_years": 1,
        "roster_status": "active",
    }
    row.update(extra)
    return row


def _status(sheet: dict, player_id: str) -> str:
    return next(r["status"] for r in sheet["rows"] if r["player_id"] == player_id)


def _available(sheet: dict, player_id: str) -> bool:
    return next(r["is_available"] for r in sheet["rows"] if r["player_id"] == player_id)


@pytest.mark.parametrize("draft_type", ["snake", "linear"])
def test_rostered_player_is_not_a_free_agent_in_a_pick_draft(draft_type):
    """The reported bug: every rostered player showed in Free agents."""
    rules = LeagueRules(draft_type=draft_type, salary_cap=0)
    sheet = build_value_overlay(
        _pool("00-0000001", "00-0000002"),
        rules,
        [],
        league_roster=[_slot("00-0000001")],
        my_team_id="team-b",
        draft_completed=False,
    )

    assert _available(sheet, "00-0000001") is False
    assert _status(sheet, "00-0000001") == "taken"
    assert _available(sheet, "00-0000002") is True
    assert sheet["available_count"] == 1


def test_pick_draft_marks_your_own_players_rostered():
    sheet = build_value_overlay(
        _pool("00-0000001"),
        SNAKE,
        [],
        league_roster=[_slot("00-0000001", team_id="team-a")],
        my_team_id="team-a",
        draft_completed=False,
    )

    assert _status(sheet, "00-0000001") == "rostered"


def test_pick_draft_ignores_a_cut_row():
    """Only active rows are ownership — a cut player is available again."""
    sheet = build_value_overlay(
        _pool("00-0000001"),
        SNAKE,
        [],
        league_roster=[_slot("00-0000001", roster_status="cut_before_draft")],
        my_team_id="team-b",
        draft_completed=False,
    )

    assert _available(sheet, "00-0000001") is True


def test_auction_pre_draft_still_frees_an_expiring_non_award():
    """Unchanged for auctions: a 1-year row that is not this year's award expires."""
    sheet = build_value_overlay(
        _pool("00-0000001"),
        AUCTION,
        [],
        league_roster=[_slot("00-0000001", salary=12)],
        my_team_id="team-b",
        draft_completed=False,
    )

    assert _available(sheet, "00-0000001") is True


def test_auction_after_draft_holds_the_roster():
    sheet = build_value_overlay(
        _pool("00-0000001"),
        AUCTION,
        [],
        league_roster=[_slot("00-0000001", salary=12)],
        my_team_id="team-b",
        draft_completed=True,
    )

    assert _available(sheet, "00-0000001") is False


def test_ownership_matches_via_the_sleeper_player_id_field():
    """A GSIS-keyed roster row owns a Sleeper-keyed pool row through its side id."""
    sheet = build_value_overlay(
        _pool("sleeper-4242"),
        SNAKE,
        [],
        league_roster=[_slot("00-0000001", sleeper_player_id="4242")],
        my_team_id="team-b",
        draft_completed=False,
    )

    assert _available(sheet, "sleeper-4242") is False


def test_ownership_matches_a_bare_sleeper_id_pool_row():
    sheet = build_value_overlay(
        _pool("sleeper-4242"),
        SNAKE,
        [],
        league_roster=[_slot("4242")],
        my_team_id="team-b",
        draft_completed=False,
    )

    assert _available(sheet, "sleeper-4242") is False
