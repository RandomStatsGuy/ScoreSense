"""Draft recap generation."""

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_recap import build_draft_recap
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _seed_win(league_id: str, *, team_id: str, team_name: str, player: str, amount: float, fair: float, grade: str):
    storage.append_draft_event(
        league_id,
        "win",
        {
            "team_id": team_id,
            "team_name": team_name,
            "player_id": f"p-{player}",
            "player_name": player,
            "position": "RB",
            "amount": amount,
            "fair_value": fair,
            "value_grade": grade,
        },
    )


def test_build_draft_recap_after_completed_draft(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("recap-user")
    league = storage.create_league("recap-user", "Recap League", 2025, rules, workspace_id=ws["id"])
    teams = storage.list_league_teams(league["id"])
    team = teams[0]

    storage.update_draft_session(league["id"], status="completed", completed_at="2026-01-01T00:00:00+00:00")
    storage.update_league_settings(league["id"], draft_completed=True)
    _seed_win(league["id"], team_id=team["id"], team_name=team["name"], player="Steal RB", amount=8, fair=20, grade="steal")
    _seed_win(league["id"], team_id=team["id"], team_name=team["name"], player="Reach WR", amount=30, fair=12, grade="major_reach")

    overview = storage.league_roster_overview(league["id"])
    recap = build_draft_recap(league["id"], overview=overview)

    assert recap is not None
    assert recap["pick_count"] == 2
    assert recap["headline"]
    assert recap.get("pick_draft") is False
    assert recap.get("projected_standings") in (None, [])
    assert any(a["id"] == "steal_of_draft" for a in recap["awards"])
    assert any(a["id"] == "reach_of_draft" for a in recap["awards"])


def test_relaxed_limits_skip_cap_awards_and_label_scopes(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    rules = rules.model_copy(update={"relax_salary_roster_limits": True})
    ws = storage.get_or_create_workspace("recap-relax")
    league = storage.create_league("recap-relax", "Relax Recap", 2025, rules, workspace_id=ws["id"])
    teams = storage.list_league_teams(league["id"])
    team = teams[0]
    storage.update_draft_session(league["id"], status="completed", completed_at="2026-01-01T00:00:00+00:00")
    storage.update_league_settings(league["id"], draft_completed=True)
    _seed_win(league["id"], team_id=team["id"], team_name=team["name"], player="Steal RB", amount=8, fair=20, grade="steal")
    overview = storage.league_roster_overview(league["id"])
    recap = build_draft_recap(league["id"], overview=overview)
    assert recap["limits_relaxed"] is True
    assert recap["scopes"]["this_mock"]["auction_wins"] == 1
    assert recap["scopes"]["league_wide"]["rostered_count"] == overview["teams"][0]["player_count"]
    assert "Hypothetical" in recap["scopes"]["full_keeper_roster"]["note"]
    assert not any(a["id"] in {"tightwad", "empty_wallet", "position_obsessed"} for a in recap["awards"])


def test_no_recap_while_draft_in_progress(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("recap-user-2", "Live", 2025, rules)
    storage.update_draft_session(league["id"], status="nominating")
    _seed_win(league["id"], team_id="t1", team_name="T1", player="X", amount=5, fair=5, grade="fair")
    assert build_draft_recap(league["id"]) is None
