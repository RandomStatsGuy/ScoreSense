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
    assert recap["team_insights"]
    assert recap["team_insights"][0]["steals"] == 1
    assert recap["team_insights"][0]["reaches"] == 1


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


def test_completed_recap_and_owner_report_use_full_result_history(hub_db):
    """Activity-feed limits must never truncate auction totals."""
    from src.draft_hub.draft_recap import build_owner_draft_report

    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league("recap-history", "Full History", 2026, rules)
    team = storage.list_league_teams(league["id"])[0]
    storage.update_draft_session(
        league["id"],
        status="completed",
        completed_at="2026-08-26T00:00:00+00:00",
    )
    storage.update_league_settings(league["id"], draft_completed=True)

    for idx in range(27):
        _seed_win(
            league["id"],
            team_id=team["id"],
            team_name=team["name"],
            player=f"Player {idx}",
            amount=idx + 1,
            fair=idx + 1,
            grade="fair",
        )
    # A normal auction emits nomination and bid activity in addition to wins.
    # Push every win outside the old 500-event suffix to reproduce the bug.
    for idx in range(500):
        storage.append_draft_event(
            league["id"],
            "bid",
            {"team_id": team["id"], "amount": idx + 1},
        )

    expected_spend = sum(range(1, 28))
    recap = build_draft_recap(league["id"])
    report = build_owner_draft_report(
        league["id"],
        team["id"],
        budget_remaining=0,
    )

    assert recap is not None
    assert recap["pick_count"] == 27
    assert recap["total_spent"] == expected_spend
    assert recap["scopes"]["this_mock"]["auction_wins"] == 27
    assert report is not None
    assert report["pick_count"] == len(report["picks"]) == 27
    assert report["total_spent"] == expected_spend
