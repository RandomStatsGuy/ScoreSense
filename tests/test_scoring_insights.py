from src.draft_hub.scoring_insights import build_scoring_awards


def _sample_scoring():
    return {
        "available": True,
        "season": "2024",
        "standings": [
            {"team_name": "Alpha", "total_points": 1500, "avg_points": 88.2, "weeks_scored": 17},
            {"team_name": "Beta", "total_points": 1200, "avg_points": 70.6, "weeks_scored": 17},
        ],
        "weeks": [
            {
                "week": 1,
                "is_playoff": False,
                "teams": [
                    {"team_name": "Alpha", "points": 120},
                    {"team_name": "Beta", "points": 45},
                ],
            },
            {
                "week": 2,
                "is_playoff": False,
                "teams": [
                    {"team_name": "Alpha", "points": 95},
                    {"team_name": "Beta", "points": 110},
                ],
            },
            {
                "week": 3,
                "is_playoff": False,
                "teams": [
                    {"team_name": "Alpha", "points": 100},
                    {"team_name": "Beta", "points": 98},
                ],
            },
        ],
    }


def test_build_scoring_awards_includes_core_ids():
    awards = build_scoring_awards(_sample_scoring())
    ids = {a["id"] for a in awards}
    assert "points_king" in ids
    assert "basement" in ids
    assert "weekly_nuke" in ids
    assert "weekly_disaster" in ids
    assert "margin_massacre" in ids
    assert awards[0]["display_name"] == "Alpha"
    assert awards[0]["team_name"] is None


def test_build_scoring_awards_uses_owner_map():
    awards = build_scoring_awards(
        _sample_scoring(),
        owner_map={"Alpha": "Alice", "Beta": "Bob"},
        planning_season="2024",
    )
    king = next(a for a in awards if a["id"] == "points_king")
    assert king["display_name"] == "Alice"
    assert king["team_name"] is None


def test_build_scoring_awards_year_specific_shows_team():
    scoring = {**_sample_scoring(), "requested_season": "2022", "season": "2024"}
    awards = build_scoring_awards(
        scoring,
        owner_map={"Alpha": "Alice"},
        planning_season="2024",
    )
    king = next(a for a in awards if a["id"] == "points_king")
    assert king["display_name"] == "Alice · Alpha"
    assert king["team_name"] == "Alpha"


def test_build_scoring_awards_empty_when_preseason():
    scoring = {**_sample_scoring(), "preseason": True}
    assert build_scoring_awards(scoring) == []


def test_build_scoring_awards_uses_requested_season():
    scoring = {**_sample_scoring(), "season": "2025", "requested_season": "2022"}
    awards = build_scoring_awards(scoring)
    king = next(a for a in awards if a["id"] == "points_king")
    assert king["detail"].startswith("2022 ·")


def test_build_scoring_awards_skips_tied_weekly_margins():
    scoring = {
        **_sample_scoring(),
        "weeks": [
            {
                "week": 9,
                "is_playoff": False,
                "teams": [
                    {"team_name": "Alpha", "points": 100},
                    {"team_name": "Beta", "points": 100},
                ],
            },
        ],
    }
    awards = build_scoring_awards(scoring)
    ids = {a["id"] for a in awards}
    assert "nail_biter" not in ids
    assert "margin_massacre" not in ids
