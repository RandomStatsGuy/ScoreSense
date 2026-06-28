"""Reset practice draft state."""

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_recap import build_draft_recap
from src.draft_hub.draft_state import end_draft, start_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.test_draft import reset_test_draft, setup_test_draft


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_reset_clears_practice_draft(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("reset-user", "Practice", 2025, rules, test_mode=True)
    setup_test_draft(league["id"], "reset-user", bot_count=2)
    start_draft(league["id"], "reset-user")

    team = storage.list_league_teams(league["id"])[0]
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws,
        {
            "player_id": "p1",
            "player_name": "Player One",
            "team": "DAL",
            "position": "RB",
            "salary": 10,
            "contract_years": 1,
        },
        team_id=team["id"],
    )
    storage.append_draft_event(league["id"], "win", {"team_id": team["id"], "player_name": "Player One", "amount": 10})
    end_draft(league["id"], "reset-user")

    assert build_draft_recap(league["id"]) is not None

    state = reset_test_draft(league["id"], "reset-user")["state"]
    assert state["session"]["status"] == "setup"
    assert state["league"]["draft_completed"] is False
    assert state["events"] == []
    assert build_draft_recap(league["id"]) is None
    assert storage.list_league_rosters_by_team(league["id"])[team["id"]] == []


def test_reset_rejected_for_live_league(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("live-user")
    league = storage.create_league("live-user", "Live", 2025, rules, workspace_id=ws["id"])
    with pytest.raises(ValueError, match="practice"):
        reset_test_draft(league["id"], "live-user")
