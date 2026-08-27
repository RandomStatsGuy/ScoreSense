"""Insights landing: records, champions, and overview payload."""

from src.draft_hub.league_history import (
    build_insights_landing,
    champion_from_winners_bracket,
    compute_regular_season_records,
)


def test_compute_regular_season_records_ignores_playoffs_and_byes():
    weeks = [
        {
            "week": 1,
            "is_playoff": False,
            "teams": [
                {"roster_id": "1", "matchup_id": 1, "points": 120},
                {"roster_id": "2", "matchup_id": 1, "points": 90},
            ],
        },
        {
            "week": 2,
            "is_playoff": False,
            "teams": [
                {"roster_id": "1", "matchup_id": 2, "points": 100},
                {"roster_id": "2", "matchup_id": 2, "points": 100},
            ],
        },
        {
            "week": 15,
            "is_playoff": True,
            "teams": [
                {"roster_id": "1", "matchup_id": 9, "points": 200},
                {"roster_id": "2", "matchup_id": 9, "points": 10},
            ],
        },
        {
            "week": 3,
            "is_playoff": False,
            "teams": [
                {"roster_id": "1", "matchup_id": 3, "points": 80},
            ],
        },
    ]
    records = compute_regular_season_records(weeks)
    assert records["1"] == {"wins": 1, "losses": 0, "ties": 1}
    assert records["2"] == {"wins": 0, "losses": 1, "ties": 1}


def test_champion_from_winners_bracket_uses_first_place_match():
    bracket = [
        {"r": 1, "p": None, "w": 3, "l": 4},
        {"r": 2, "p": 1, "w": 7, "l": 2},
        {"r": 2, "p": 3, "w": 5, "l": 6},
    ]
    labels = {"7": "Champs", "2": "Runner"}
    meta = {"7": {"owner_id": "user-a"}, "2": {"owner_id": "user-b"}}
    champ = champion_from_winners_bracket(bracket, labels, meta)
    assert champ["champion_roster_id"] == "7"
    assert champ["champion_team_name"] == "Champs"
    assert champ["champion_owner_id"] == "user-a"
    assert champ["runner_up_team_name"] == "Runner"


def test_build_insights_landing_without_sleeper_still_returns_catalog():
    payload = build_insights_landing("", award_titles={"points_king": "Scoring champ"})
    assert payload["available"] is False
    catalog = payload["award_catalog"]
    king = next(row for row in catalog if row["id"] == "points_king")
    assert king["title"] == "Scoring champ"
