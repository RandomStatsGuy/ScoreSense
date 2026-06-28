"""Tests for external projection integrations."""

import pandas as pd

from src.integrations.external_projections import (
    attach_espn_projections,
    merge_external_projections,
    parse_espn_weekly_response,
)


NESTED_ESPN_FIXTURE = {
    "players": [
        {
            "player": {
                "id": 4362628,
                "fullName": "Patrick Mahomes",
                "defaultPositionId": 1,
                "stats": [
                    {
                        "scoringPeriodId": 9,
                        "statSourceId": 1,
                        "appliedTotal": 22.5,
                    },
                    {
                        "scoringPeriodId": 9,
                        "statSourceId": 0,
                        "appliedTotal": 18.0,
                    },
                ],
            }
        },
        {
            "player": {
                "id": 9999999,
                "fullName": "Unknown Player",
                "defaultPositionId": 3,
                "stats": [
                    {
                        "scoringPeriodId": 8,
                        "statSourceId": 1,
                        "appliedTotal": 10.0,
                    },
                ],
            }
        },
    ]
}


def test_parse_espn_weekly_response_nested():
    df = parse_espn_weekly_response(NESTED_ESPN_FIXTURE, season=2024, week=9)
    assert len(df) == 1
    row = df.iloc[0]
    assert row["espn_id"] == "4362628"
    assert row["player_name"] == "Patrick Mahomes"
    assert row["espn_proj"] == 22.5
    assert row["espn_position"] == "QB"
    assert row["name_key"] == "patrick mahomes"


def test_parse_espn_weekly_response_flat_list():
    flat = [entry["player"] for entry in NESTED_ESPN_FIXTURE["players"]]
    df = parse_espn_weekly_response(flat, season=2024, week=9)
    assert len(df) == 1
    assert df.iloc[0]["espn_proj"] == 22.5


def test_attach_espn_projections_by_name(monkeypatch):
    base = pd.DataFrame(
        {
            "player_id": ["00-0036389"],
            "player_display_name": ["Patrick Mahomes"],
            "season": [2024],
            "week": [9],
            "name_key": ["patrick mahomes"],
        }
    )
    espn = pd.DataFrame(
        {
            "season": [2024],
            "week": [9],
            "espn_id": ["4362628"],
            "player_name": ["Patrick Mahomes"],
            "espn_position": ["QB"],
            "espn_proj": [22.5],
            "name_key": ["patrick mahomes"],
        }
    )

    monkeypatch.setattr(
        "src.integrations.external_projections.load_espn_season_projections",
        lambda season, weeks=None: espn,
    )
    monkeypatch.setattr(
        "src.integrations.external_projections.load_espn_to_gsis_crosswalk",
        lambda force_refresh=False: pd.DataFrame(columns=["espn_id", "player_id", "full_name", "team"]),
    )

    out = attach_espn_projections(base, season=2024)
    assert out.iloc[0]["espn_proj"] == 22.5


def test_merge_external_projections_includes_fantasypros(monkeypatch):
    base = pd.DataFrame(
        {
            "player_id": ["p1"],
            "player_display_name": ["Patrick Mahomes"],
            "position": ["QB"],
            "team": ["KC"],
            "season": [2024],
            "week": [9],
        }
    )

    monkeypatch.setattr(
        "src.integrations.external_projections.load_ffopportunity_weekly",
        lambda season, force_refresh=False: pd.DataFrame(
            {
                "player_id": ["p1"],
                "season": [2024],
                "week": [9],
                "ffopportunity_proj": [20.0],
            }
        ),
    )
    monkeypatch.setattr(
        "src.integrations.external_projections.attach_espn_projections",
        lambda out, season: out.assign(espn_proj=float("nan")),
    )
    monkeypatch.setattr(
        "src.integrations.fantasypros.attach_fantasypros_projections",
        lambda out, season, position: out.assign(fantasypros_proj=22.5),
    )

    out = merge_external_projections(base, season=2024)
    assert "fantasypros_proj" in out.columns
    assert out.iloc[0]["fantasypros_proj"] == 22.5
