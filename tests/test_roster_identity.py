"""nflverse roster identity overlay — team, position, leftover names."""

import pandas as pd

from src.integrations.roster_identity import apply_roster_identity_overlay


def _nflverse() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "player_id": "00-0037745",
                "player_name": "Velus Jones Jr.",
                "team": "SEA",
                "position": "RB",
                "status": "DEV",
            },
            {
                "player_id": "00-0038134",
                "player_name": "Kenneth Walker III",
                "team": "KC",
                "position": "RB",
                "status": "ACT",
            },
            {
                "player_id": "00-0038611",
                "player_name": "Chris Rodriguez Jr.",
                "team": "JAX",
                "position": "RB",
                "status": "ACT",
            },
            {
                "player_id": "00-0040547",
                "player_name": "Nate Carter",
                "team": "KC",
                "position": "RB",
                "status": "DEV",
            },
            {
                "player_id": "00-0038839",
                "player_name": "Mitchell Tinsley",
                "team": "HOU",
                "position": "WR",
                "status": "DEV",
            },
            {
                "player_id": "00-0040311",
                "player_name": "Theo Wease Jr.",
                "team": "LAC",
                "position": "WR",
                "status": "DEV",
            },
            {
                "player_id": "00-0037837",
                "player_name": "Calvin Austin III",
                "team": "NYG",
                "position": "WR",
                "status": "RES",
            },
            {
                "player_id": "00-0037614",
                "player_name": "John Metchie III",
                "team": "CAR",
                "position": "WR",
                "status": "ACT",
            },
        ]
    )


def _sleeper() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "full_name": "Kenneth Walker",
                "team": "KC",
                "position": "RB",
                "status": "Active",
                "gsis_id": "",
            },
            {
                "full_name": "Kenneth Walker",
                "team": "",
                "position": "WR",
                "status": "Active",
                "gsis_id": "",
            },
            {
                "full_name": "Velus Jones",
                "team": "SEA",
                "position": "WR",
                "status": "Active",
                "gsis_id": "",
            },
        ]
    )


def test_velus_drops_off_wr_board():
    wr = pd.DataFrame(
        [
            {
                "Player": "Velus Jones Jr.",
                "Team": "SEA",
                "Position": "WR",
                "player_id": "00-0037745",
                "Season": 2026,
                "Week": 1,
            }
        ]
    )
    updated, stats = apply_roster_identity_overlay(
        wr,
        "wr",
        season=2026,
        week=1,
        nflverse_df=_nflverse(),
        sleeper_df=_sleeper(),
        load_defaults=False,
    )
    assert updated.empty
    assert stats["dropped_wrong_position"] == 1


def test_velus_stays_on_rb_board():
    rb = pd.DataFrame(
        [
            {
                "Player": "Velus Jones Jr.",
                "Team": "SEA",
                "Position": "RB",
                "player_id": "00-0037745",
                "Season": 2026,
                "Week": 1,
            }
        ]
    )
    updated, stats = apply_roster_identity_overlay(
        rb,
        "rb",
        season=2026,
        week=1,
        nflverse_df=_nflverse(),
        sleeper_df=_sleeper(),
        load_defaults=False,
    )
    assert len(updated) == 1
    assert updated.iloc[0]["Team"] == "SEA"
    assert updated.iloc[0]["Position"] == "RB"
    assert stats["dropped_wrong_position"] == 0


def test_week1_team_moves_from_nflverse():
    board = pd.DataFrame(
        [
            {
                "Player": "Kenneth Walker III",
                "Team": "SEA",
                "Position": "RB",
                "player_id": "00-0038134",
            },
            {
                "Player": "Chris Rodriguez Jr.",
                "Team": "WAS",
                "Position": "RB",
                "player_id": "00-0038611",
            },
            {
                "Player": "Nate Carter",
                "Team": "ATL",
                "Position": "RB",
                "player_id": "00-0040547",
            },
        ]
    )
    updated, stats = apply_roster_identity_overlay(
        board,
        "rb",
        season=2026,
        week=1,
        nflverse_df=_nflverse(),
        sleeper_df=_sleeper(),
        load_defaults=False,
    )
    teams = dict(zip(updated["Player"], updated["Team"]))
    assert teams["Kenneth Walker III"] == "KC"
    assert teams["Chris Rodriguez Jr."] == "JAX"
    assert teams["Nate Carter"] == "KC"
    assert stats["teams_updated"] == 3


def test_wr_team_moves_and_ir_kept():
    board = pd.DataFrame(
        [
            {
                "Player": "Mitchell Tinsley",
                "Team": "CIN",
                "Position": "WR",
                "player_id": "00-0038839",
            },
            {
                "Player": "Theo Wease Jr.",
                "Team": "MIA",
                "Position": "WR",
                "player_id": "00-0040311",
            },
            {
                "Player": "Calvin Austin III",
                "Team": "PIT",
                "Position": "WR",
                "player_id": "00-0037837",
            },
            {
                "Player": "John Metchie III",
                "Team": "NYJ",
                "Position": "WR",
                "player_id": "00-0037614",
            },
        ]
    )
    updated, stats = apply_roster_identity_overlay(
        board,
        "wr",
        season=2026,
        nflverse_df=_nflverse(),
        sleeper_df=pd.DataFrame(),
        load_defaults=False,
    )
    teams = dict(zip(updated["Player"], updated["Team"]))
    assert teams["Mitchell Tinsley"] == "HOU"
    assert teams["Theo Wease Jr."] == "LAC"
    assert teams["Calvin Austin III"] == "NYG"
    assert teams["John Metchie III"] == "CAR"
    assert stats["teams_updated"] == 4


def test_2025_only_names_drop_as_stale():
    board = pd.DataFrame(
        [
            {
                "Player": "Giovanni Ricci",
                "Team": "DET",
                "Position": "TE",
                "player_id": "00-0035956",
            },
            {
                "Player": "Travis Vokolek",
                "Team": "ARI",
                "Position": "TE",
                "player_id": "00-0038456",
            },
            {
                "Player": "Malik Heath",
                "Team": "ATL",
                "Position": "WR",
                "player_id": "00-0038465",
            },
            {
                "Player": "Ja'Marr Chase",
                "Team": "CIN",
                "Position": "WR",
                "player_id": "00-0036900",
            },
        ]
    )
    nfl = _nflverse()
    nfl = pd.concat(
        [
            nfl,
            pd.DataFrame(
                [
                    {
                        "player_id": "00-0036900",
                        "player_name": "Ja'Marr Chase",
                        "team": "CIN",
                        "position": "WR",
                        "status": "ACT",
                    }
                ]
            ),
        ],
        ignore_index=True,
    )
    updated, stats = apply_roster_identity_overlay(
        board,
        "wr",
        season=2026,
        nflverse_df=nfl,
        sleeper_df=pd.DataFrame(),
        load_defaults=False,
    )
    names = set(updated["Player"])
    assert names == {"Ja'Marr Chase"}
    assert stats["dropped_stale"] == 3


def test_rookie_stub_not_dropped_when_missing_from_nflverse():
    board = pd.DataFrame(
        [
            {
                "Player": "Camp Rookie",
                "Team": "LV",
                "Position": "QB",
                "player_id": "sleeper-xyz",
                "_rookie_estimate": True,
            }
        ]
    )
    updated, stats = apply_roster_identity_overlay(
        board,
        "qb",
        season=2026,
        nflverse_df=_nflverse(),
        sleeper_df=pd.DataFrame(),
        load_defaults=False,
    )
    assert len(updated) == 1
    assert stats["dropped_stale"] == 0


def test_sleeper_suffix_fallback_when_nflverse_empty():
    board = pd.DataFrame(
        [
            {
                "Player": "Kenneth Walker III",
                "Team": "SEA",
                "Position": "RB",
                "player_id": "00-0038134",
            }
        ]
    )
    updated, stats = apply_roster_identity_overlay(
        board,
        "rb",
        season=2026,
        nflverse_df=pd.DataFrame(),
        sleeper_df=_sleeper(),
        load_defaults=False,
    )
    assert updated.iloc[0]["Team"] == "KC"
    assert stats["source"] == "sleeper"
    assert stats["teams_updated"] == 1
