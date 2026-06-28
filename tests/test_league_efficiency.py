"""Tests for cap efficiency metrics."""

from src.draft_hub.league_efficiency import build_cap_efficiency


def test_build_cap_efficiency_ranks_by_points_per_dollar():
    analytics = {
        "teams": [
            {
                "team_id": "a",
                "team_name": "Alpha",
                "committed": 100,
                "dead_cap": 0,
                "spend_by_position": {"RB": 40, "WR": 30},
            },
            {
                "team_id": "b",
                "team_name": "Beta",
                "committed": 200,
                "dead_cap": 10,
                "spend_by_position": {"WR": 80, "QB": 50},
            },
        ],
    }
    scoring = {
        "available": True,
        "season": "2024",
        "standings": [
            {"team_name": "Alpha", "total_points": 150, "avg_points": 15, "weeks_scored": 10},
            {"team_name": "Beta", "total_points": 200, "avg_points": 20, "weeks_scored": 10},
        ],
    }
    out = build_cap_efficiency(analytics, scoring)
    assert out["available"] is True
    assert out["league_avg_points_per_dollar"] == 1.25
    assert out["teams"][0]["team_name"] == "Alpha"
    assert out["teams"][0]["points_per_dollar"] == 1.5
    assert out["teams"][0]["efficiency_rank"] == 1
    assert out["teams"][0]["top_spend_position"] == "RB"


def test_build_cap_efficiency_prefers_requested_season():
    out = build_cap_efficiency(
        {"teams": []},
        {"available": True, "season": "2025", "requested_season": "2022", "standings": []},
    )
    assert out["season"] == "2022"


def test_build_cap_efficiency_unavailable_without_scoring():
    out = build_cap_efficiency({"teams": []}, {"available": False, "reason": "no_sleeper"})
    assert out["available"] is False
    assert out["teams"] == []


def test_build_cap_efficiency_fuzzy_team_name():
    analytics = {
        "teams": [
            {
                "team_id": "dual",
                "team_name": "Dual Ethics",
                "committed": 100,
                "dead_cap": 0,
                "spend_by_position": {"WR": 47},
            },
        ],
    }
    scoring = {
        "available": True,
        "season": "2025",
        "standings": [
            {
                "team_name": "Lincoler's Dual Ethics",
                "total_points": 2115.54,
                "avg_points": 117.5,
                "weeks_scored": 18,
            },
        ],
    }
    out = build_cap_efficiency(analytics, scoring)
    assert out["teams"][0]["total_points"] == 2115.54
    assert out["teams"][0]["points_per_dollar"] == 21.155


def test_align_contract_analytics_to_hub_teams():
    from src.draft_hub.league_efficiency import align_contract_analytics_to_hub_teams

    overview = {
        "teams": [
            {"team": {"name": "Lincoler's Dual Ethics"}},
            {"team": {"name": "Alpha"}},
        ],
    }
    analytics = {
        "teams": [
            {"team_name": "Dual Ethics", "committed": 100, "spend_by_position": {"WR": 47}},
            {"team_name": "Alpha", "committed": 80, "spend_by_position": {"RB": 40}},
        ],
    }
    out = align_contract_analytics_to_hub_teams(analytics, overview)
    names = [t["team_name"] for t in out["teams"]]
    assert "Lincoler's Dual Ethics" in names
    assert "Dual Ethics" not in names
