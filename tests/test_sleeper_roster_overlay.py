"""Tests for Sleeper roster overlay on draft projections."""

import pandas as pd

from src.integrations.sleeper import apply_sleeper_roster_overlay


def _mock_sleeper() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "sleeper_id": "s1",
                "full_name": "Geno Smith",
                "team": "NYJ",
                "position": "QB",
                "status": "Active",
                "gsis_id": "00-0030565",
                "years_exp": 12,
            },
            {
                "sleeper_id": "s2",
                "full_name": "Kenny Pickett",
                "team": "CAR",
                "position": "QB",
                "status": "Active",
                "gsis_id": "00-0038102",
                "years_exp": 3,
            },
            {
                "sleeper_id": "s3",
                "full_name": "Fernando Mendoza",
                "team": "LV",
                "position": "QB",
                "status": "Active",
                "gsis_id": "",
                "years_exp": 0,
                "depth_chart_order": 1,
                "search_rank": 39,
            },
            {
                "sleeper_id": "s5",
                "full_name": "Jacob Clark",
                "team": "LV",
                "position": "QB",
                "status": "Active",
                "gsis_id": "",
                "years_exp": 0,
                "depth_chart_order": None,
                "search_rank": 9999999,
            },
            {
                "sleeper_id": "s4",
                "full_name": "Retired QB",
                "team": "",
                "position": "QB",
                "status": "Retired",
                "gsis_id": "00-0099999",
                "years_exp": 10,
            },
        ]
    )


def test_apply_sleeper_roster_overlay_updates_teams_and_adds_rookie():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0030565",
                "player_display_name": "Geno Smith",
                "team": "LV",
                "season": 2026,
                "week": 1,
                "passing_yards_avg": 220.0,
            },
            {
                "player_id": "00-0038102",
                "player_display_name": "Kenny Pickett",
                "team": "LV",
                "season": 2026,
                "week": 1,
                "passing_yards_avg": 180.0,
            },
        ]
    )

    updated, stats = apply_sleeper_roster_overlay(
        roster,
        "qb",
        season=2026,
        sleeper_df=_mock_sleeper(),
    )

    assert stats["applied"] is True
    assert stats["teams_updated"] == 2
    assert stats["rookies_added"] == 2

    geno = updated[updated["player_display_name"] == "Geno Smith"].iloc[0]
    pickett = updated[updated["player_display_name"] == "Kenny Pickett"].iloc[0]
    mendoza = updated[updated["player_display_name"] == "Fernando Mendoza"].iloc[0]

    assert geno["team"] == "NYJ"
    assert pickett["team"] == "CAR"
    assert mendoza["team"] == "LV"
    assert bool(mendoza["_rookie_estimate"]) is True
    assert mendoza["_rookie_role_label"] == "starter-camp"
    assert float(mendoza["_rookie_role_mult"]) == 2.75

    clark = updated[updated["player_display_name"] == "Jacob Clark"].iloc[0]
    assert clark["_rookie_role_label"] == "development"
    assert float(clark["_rookie_role_mult"]) == 0.26
    assert float(clark["passing_yards_avg"]) < float(mendoza["passing_yards_avg"])


def test_apply_sleeper_roster_overlay_drops_unrostered():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0099999",
                "player_display_name": "Retired QB",
                "team": "LV",
                "season": 2026,
                "week": 1,
                "passing_yards_avg": 100.0,
            }
        ]
    )

    updated, stats = apply_sleeper_roster_overlay(
        roster,
        "qb",
        season=2026,
        sleeper_df=_mock_sleeper(),
        add_rookies=False,
    )

    assert stats["removed_unrostered"] == 1
    assert updated.empty
