"""Tests for live DFS slate parsing."""

import requests

import src.integrations.dfs_slates as dfs_slates

from src.integrations.dfs_slates import (
    parse_dk_available_players,
    parse_dk_draftables,
    parse_dk_lobby_slates,
    parse_fd_players,
)


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


def test_global_player_id_cannot_replace_draftable_id():
    entry = {**DK_DRAFTABLES_SAMPLE["draftables"][0], "playerDkId": 123, "playerId": 456}
    entry.pop("draftableId")
    assert parse_dk_draftables({"draftables": [entry]}).iloc[0]["dfs_id"] == ""


def test_parse_dk_available_players_keeps_usable_salary_and_team():
    payload = {
        "playerList": [
            {
                "fn": "Puka",
                "ln": "Nacua",
                "pn": "WR",
                "s": 11400,
                "tid": 343,
                "htid": 343,
                "htabbr": "LAR",
                "atabbr": "NYG",
            },
            {
                "fn": "Unavailable",
                "ln": "Player",
                "pn": "QB",
                "s": 9000,
                "tid": 1,
                "htid": 1,
                "htabbr": "KC",
                "atabbr": "DEN",
                "IsDisabledFromDrafting": True,
            },
        ]
    }

    df = parse_dk_available_players(payload)

    assert len(df) == 1
    row = df.iloc[0]
    assert row["team"] == "LAR"
    assert row["dfs_id"] == ""
    assert int(row["salary"]) == 11400
    assert int(row["cpt_salary"]) == 17100


def test_dk_salary_fetch_falls_back_when_draftables_is_forbidden(monkeypatch, tmp_path):
    forbidden = requests.Response()
    forbidden.status_code = 403
    calls = []

    def fake_get(url, params=None):
        calls.append((url, params))
        if url == dfs_slates.DK_DRAFTABLES_URL.format(draft_group_id="123"):
            error = requests.HTTPError("forbidden")
            error.response = forbidden
            raise error
        return {
            "playerList": [
                {
                    "fn": "Puka",
                    "ln": "Nacua",
                    "pn": "WR",
                    "s": 11400,
                    "tid": 343,
                    "htid": 343,
                    "htabbr": "LAR",
                    "atabbr": "NYG",
                }
            ]
        }

    monkeypatch.setattr(dfs_slates, "_dk_get", fake_get)
    monkeypatch.setattr(dfs_slates, "_cache_path", lambda *_: tmp_path / "salary.parquet")
    monkeypatch.setattr(dfs_slates, "_cache_meta_path", lambda *_: tmp_path / "meta.json")

    salaries = dfs_slates.fetch_dk_salaries("123", use_cache=False)

    assert len(salaries) == 1
    assert calls[1] == (
        dfs_slates.DK_AVAILABLE_PLAYERS_URL,
        {"draftGroupId": "123"},
    )


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
