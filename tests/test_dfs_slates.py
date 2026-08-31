"""Tests for live DFS slate parsing."""

from src.integrations.dfs_slates import parse_dk_draftables, parse_dk_lobby_slates, parse_fd_players


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


DK_LOBBY_SAMPLE = {
    "GameTypes": [
        {"GameTypeId": 1, "Name": "Classic"},
        {"GameTypeId": 96, "Name": "Showdown Captain Mode"},
        {"GameTypeId": 158, "Name": "Madden Classic"},
        {"GameTypeId": 145, "Name": "Best Ball"},
    ],
    "DraftGroups": [
        {
            "DraftGroupId": 151307,
            "GameTypeId": 1,
            "GameCount": 12,
            "ContestStartTimeSuffix": None,
        },
        {
            "DraftGroupId": 151820,
            "GameTypeId": 96,
            "GameCount": 1,
            "ContestStartTimeSuffix": " (NE @ SEA)",
        },
        {
            "DraftGroupId": 152610,
            "GameTypeId": 158,
            "GameCount": 3,
            "ContestStartTimeSuffix": " (Madden Stream)",
        },
        {
            "DraftGroupId": 146163,
            "GameTypeId": 145,
            "GameCount": 16,
            "ContestStartTimeSuffix": " (Sit & Go)",
        },
    ],
    "Contests": [
        {"dg": 151307, "gameType": "Classic", "n": "NFL $3.5M Millionaire"},
        {"dg": 151307, "gameType": "Classic", "n": "NFL $400K Play-Action"},
        {"dg": 151820, "gameType": "Showdown Captain Mode", "n": "NFL Showdown $2.25M (NE @ SEA)"},
        {"dg": 152610, "gameType": "Madden Classic", "n": "Madden Stream $6K"},
        {"dg": 146163, "gameType": "Best Ball", "n": "NFL Best Ball $2,120"},
    ],
}


def test_parse_dk_lobby_slates_skips_madden_and_best_ball():
    slates = parse_dk_lobby_slates(DK_LOBBY_SAMPLE, category="all")
    ids = {s["slate_id"] for s in slates}
    assert ids == {"151307", "151820"}
    main = next(s for s in slates if s["slate_id"] == "151307")
    assert main["category"] == "main"
    assert main["game_count"] == 12
    assert "12 games" in main["name"]
    assert main["contest_count"] == 2
    showdown = next(s for s in slates if s["slate_id"] == "151820")
    assert showdown["category"] == "showdown"
    assert "NE @ SEA" in (showdown["name"] or "")


def test_parse_dk_lobby_slates_main_filter():
    slates = parse_dk_lobby_slates(DK_LOBBY_SAMPLE, category="main")
    assert [s["slate_id"] for s in slates] == ["151307"]


def test_parse_dk_lobby_main_falls_back_to_other_not_madden():
    payload = {
        "GameTypes": [
            {"GameTypeId": 50, "Name": "Turbo"},
            {"GameTypeId": 158, "Name": "Madden Classic"},
        ],
        "DraftGroups": [
            {
                "DraftGroupId": 1,
                "GameTypeId": 50,
                "GameCount": 4,
                "ContestStartTimeSuffix": None,
            },
            {
                "DraftGroupId": 2,
                "GameTypeId": 158,
                "GameCount": 1,
                "ContestStartTimeSuffix": " (Madden Stream)",
            },
        ],
        "Contests": [
            {"dg": 1, "gameType": "Turbo", "n": "NFL Turbo $10"},
            {"dg": 2, "gameType": "Madden Classic", "n": "Madden Stream $6K"},
        ],
    }
    slates = parse_dk_lobby_slates(payload, category="main")
    assert [s["slate_id"] for s in slates] == ["1"]
    assert slates[0]["category"] == "other"
