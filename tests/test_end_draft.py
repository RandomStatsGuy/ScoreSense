"""End draft early."""

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_state import end_draft, start_draft
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_commissioner_can_end_live_draft(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("end-draft-user")
    league = storage.create_league("end-draft-user", "End Draft", 2025, rules, workspace_id=ws["id"])

    start_draft(league["id"], "end-draft-user")
    state = end_draft(league["id"], "end-draft-user", force=True)

    assert state["session"]["status"] == "completed"
    assert state["session"]["completed_at"]
    assert state["league"]["status"] == "completed"
    assert state["league"]["draft_completed"] is True
    assert state["events"][-1]["event_type"] == "end"


def test_end_draft_releases_open_nominee(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("end-draft-user-2")
    league = storage.create_league("end-draft-user-2", "End Draft 2", 2025, rules, workspace_id=ws["id"])
    storage.update_league_status(league["id"], "live")
    storage.update_draft_session(
        league["id"],
        status="bidding",
        current_nominee_json='{"player_id":"p1","player_name":"Open Player","position":"RB"}',
        high_bid=5,
        high_bidder_team_id=storage.list_league_teams(league["id"])[0]["id"],
    )

    state = end_draft(league["id"], "end-draft-user-2", force=True)
    assert state["session"]["status"] == "completed"
    assert state["session"]["current_nominee_json"] is None
    assert state["events"][-1]["payload"]["released_nominee"] == "Open Player"


def test_non_commissioner_cannot_end_draft(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("comm-user", "Comm League", 2025, rules)
    storage.update_draft_session(league["id"], status="nominating")

    with pytest.raises(ValueError, match="Only commissioner"):
        end_draft(league["id"], "other-user")
