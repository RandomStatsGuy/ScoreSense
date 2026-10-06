"""Unlink Sleeper so ScoreSense hosts lineups and scoring for a league.

Covers the commissioner unlink path and the inference guard: a league the
commissioner deliberately unlinked must not be re-attached to a member's
personal Sleeper link on the next read.
"""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.hub_scoring import sleeper_hosts_scoring
from src.draft_hub.league_sleeper_sync import (
    disconnect_sleeper_league,
    resolve_sleeper_league_id,
    sleeper_roster_slot_count,
)
from src.draft_hub.schemas import LeagueRules

SLEEPER_ID = "1257419072740644612"


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _league_with_personal_link(sub: str = "unlink-comm", *, linked: bool = True,
                              legacy_workspace: bool = False) -> dict:
    """The manager's personal link is separate from an explicitly linked league."""
    workspace = storage.get_or_create_workspace(sub, season=2026)
    storage.update_sleeper_link(sub, sleeper_league_id=SLEEPER_ID, sleeper_roster_id="2")
    league = storage.create_league(sub, "Unlink League", 2026, LeagueRules(), team_count=4,
                                   workspace_id=workspace["id"] if legacy_workspace else None)
    if linked and not legacy_workspace:
        storage.update_league_sleeper_id(league["id"], SLEEPER_ID)
    return storage.get_league(league["id"])


def _add_slot(ws_id: str, team_id: str, player_id: str, source: str) -> None:
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": player_id,
            "player_name": f"Player {player_id}",
            "team": "TST",
            "position": "RB",
            "salary": 10,
            "source": source,
        },
        team_id,
    )


def test_dedicated_native_league_does_not_inherit_personal_sleeper_link(hub_db):
    league = _league_with_personal_link(linked=False)
    assert league["sleeper_league_id"] is None
    assert sleeper_hosts_scoring(league) is False
    assert resolve_sleeper_league_id(league["id"]) is None
    assert storage.get_team_by_user(league["id"], "unlink-comm")["sleeper_roster_id"] is None
    assert storage.get_or_create_workspace("unlink-comm", season=2026)["sleeper_league_id"] == SLEEPER_ID


def test_unlink_clears_link_and_makes_league_hub_hosted(hub_db):
    league = _league_with_personal_link()

    result = disconnect_sleeper_league(league["id"])

    assert result["was_linked_to"] == SLEEPER_ID
    assert result["lineup_source"] == "hub"

    after = storage.get_league(league["id"])
    assert after["sleeper_league_id"] is None
    assert after["sleeper_hosting_disabled"] is True
    assert sleeper_hosts_scoring(after) is False


def test_unlink_survives_link_inference(hub_db):
    """resolve_sleeper_league_id must not re-attach the personal link afterwards."""
    league = _league_with_personal_link(legacy_workspace=True)
    # The scoped fallback exists only for an exact commissioner-owned legacy pool.
    storage.clear_league_sleeper_id(league["id"], disable_hosting=False)
    assert resolve_sleeper_league_id(league["id"]) == SLEEPER_ID

    disconnect_sleeper_league(league["id"])

    assert resolve_sleeper_league_id(league["id"]) is None
    assert storage.get_league(league["id"])["sleeper_league_id"] is None


def test_unlink_clears_team_mappings(hub_db):
    league = _league_with_personal_link()
    team = storage.list_league_teams(league["id"])[0]
    storage.update_team_sleeper_link(
        str(team["id"]),
        sleeper_roster_id="2",
        sleeper_team_name="Sleeper Squad",
    )

    result = disconnect_sleeper_league(league["id"])

    assert result["teams_cleared"] == 1
    refreshed = storage.get_team(str(team["id"]))
    assert refreshed["sleeper_roster_id"] is None
    assert refreshed["sleeper_team_name"] is None


def test_unlink_removes_only_sleeper_sourced_roster_rows(hub_db):
    league = _league_with_personal_link()
    ws_id = str(league["workspace_id"])
    team_id = str(storage.list_league_teams(league["id"])[0]["id"])
    _add_slot(ws_id, team_id, "00-0000001", "sleeper")
    _add_slot(ws_id, team_id, "00-0000002", "sleeper")
    _add_slot(ws_id, team_id, "00-0000003", "cap_sheet")
    assert sleeper_roster_slot_count(league["id"]) == 2

    result = disconnect_sleeper_league(league["id"])

    assert result["roster_rows_removed"] == 2
    remaining = storage.list_league_roster(ws_id)
    assert [row["player_id"] for row in remaining] == ["00-0000003"]


def test_unlink_can_keep_sleeper_rosters(hub_db):
    league = _league_with_personal_link()
    ws_id = str(league["workspace_id"])
    team_id = str(storage.list_league_teams(league["id"])[0]["id"])
    _add_slot(ws_id, team_id, "00-0000001", "sleeper")

    result = disconnect_sleeper_league(league["id"], clear_sleeper_roster=False)

    assert result["roster_rows_removed"] == 0
    assert result["roster_cleared"] is False
    assert len(storage.list_league_roster(ws_id)) == 1
    # The link is still gone even though the players stayed.
    assert storage.get_league(league["id"])["sleeper_league_id"] is None


def test_reconnect_lifts_the_unlink_flag(hub_db):
    league = _league_with_personal_link()
    disconnect_sleeper_league(league["id"])
    assert resolve_sleeper_league_id(league["id"]) is None

    # Clearing the opt-out flag alone cannot inherit an unrelated personal link.
    storage.set_league_sleeper_hosting_disabled(league["id"], False)
    assert resolve_sleeper_league_id(league["id"]) is None
    # Explicit reconnect supplies the league ID, as connect_sleeper_league does.
    storage.update_league_sleeper_id(league["id"], SLEEPER_ID)
    assert resolve_sleeper_league_id(league["id"]) == SLEEPER_ID


def test_unlink_on_missing_league_raises(hub_db):
    with pytest.raises(ValueError):
        disconnect_sleeper_league("no-such-league")


def test_disconnect_routes_registered():
    from app.hub_routes import router

    paths = {getattr(route, "path", "") for route in router.routes}
    assert f"{router.prefix}/league/{{league_id}}/sleeper/disconnect" in paths
