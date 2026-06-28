"""Tests for live DFS slate parsing."""

from src.integrations.dfs_slates import parse_dk_draftables, parse_fd_players


DK_DRAFTABLES_SAMPLE = {
    "draftables": [
        {
            "draftableId": 39506085,
            "displayName": "Ja'Marr Chase",
            "position": "WR",
            "salary": 8100,
            "teamAbbreviation": "CIN",
            "isDisabled": False,
        },
        {
            "draftableId": 999,
            "displayName": "Bengals",
            "position": "DST",
            "salary": 3000,
            "teamAbbreviation": "CIN",
            "isDisabled": False,
        },
        {
            "draftableId": 1,
            "displayName": "Disabled",
            "position": "QB",
            "salary": 5000,
            "teamAbbreviation": "KC",
            "isDisabled": True,
        },
    ]
}


FD_PLAYERS_SAMPLE = {
    "players": [
        {
            "id": "player-1",
            "name": "Patrick Mahomes",
            "salary": 8800,
            "team": {"abbreviation": "KC"},
            "positions": ["QB"],
        }
    ]
}


def test_parse_dk_draftables():
    df = parse_dk_draftables(DK_DRAFTABLES_SAMPLE)
    assert len(df) == 2
    assert int(df.loc[df["position"] == "WR", "salary"].iloc[0]) == 8100
    assert df.iloc[0]["name_key"]


def test_parse_fd_players():
    df = parse_fd_players(FD_PLAYERS_SAMPLE)
    assert len(df) == 1
    assert int(df.iloc[0]["salary"]) == 8800
    assert df.iloc[0]["team"] == "KC"
