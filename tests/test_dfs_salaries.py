"""Tests for DFS salary CSV parsing and pool join."""

import pandas as pd

from src.products.dfs_salaries import (
    attach_salaries_to_pool,
    collapse_captain_rows,
    parse_salary_csv,
)


DK_SAMPLE = """Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame
QB,Patrick Mahomes (12345),Patrick Mahomes,12345,QB,8200,KC@LV,KC,24.1
RB,Christian McCaffrey (23456),Christian McCaffrey,23456,RB/FLEX,9000,SF@SEA,SF,22.0
DST,49ers (99999),49ers,99999,DST,2800,SF@SEA,SF,8.0
"""

DK_SHOWDOWN_SAMPLE = """Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame
QB,Drake Maye (11111),Drake Maye,11111,CPT,15000,NE@SEA,NE,21.0
QB,Drake Maye (22222),Drake Maye,22222,FLEX,10000,NE@SEA,NE,21.0
WR,Jaxon Smith-Njigba (33333),Jaxon Smith-Njigba,33333,CPT,15900,NE@SEA,SEA,19.4
WR,Jaxon Smith-Njigba (44444),Jaxon Smith-Njigba,44444,FLEX,10600,NE@SEA,SEA,19.4
DST,Seahawks (55555),Seahawks,55555,CPT,6300,NE@SEA,SEA,7.2
DST,Seahawks (66666),Seahawks,66666,FLEX,4200,NE@SEA,SEA,7.2
"""


def test_parse_draftkings_csv():
    df = parse_salary_csv(DK_SAMPLE.encode(), site="draftkings")
    assert len(df) == 3
    assert set(df["position"]) == {"QB", "RB", "DST"}
    assert int(df.loc[df["position"] == "QB", "salary"].iloc[0]) == 8200


def test_attach_salaries_matches_name_and_team():
    pool = pd.DataFrame(
        [
            {
                "player_id": "p1",
                "Player": "Patrick Mahomes",
                "Team": "KC",
                "Position": "QB",
                "Projected Points": 22.0,
                "Low (P10)": 15.0,
                "High (P90)": 28.0,
            }
        ]
    )
    salaries = parse_salary_csv(DK_SAMPLE.encode())
    merged, stats = attach_salaries_to_pool(pool, salaries)
    row = merged.iloc[0]
    assert row["salary"] == 8200
    assert stats["matched"] >= 1
    assert stats["dst_added"] == 1


def test_parse_showdown_csv_keeps_real_positions_and_roster_slots():
    df = parse_salary_csv(DK_SHOWDOWN_SAMPLE.encode(), site="draftkings")
    assert len(df) == 6
    assert set(df["position"]) == {"QB", "WR", "DST"}
    assert (df["roster_position"] == "CPT").sum() == 3


def test_collapse_captain_rows_from_roster_position():
    df = parse_salary_csv(DK_SHOWDOWN_SAMPLE.encode(), site="draftkings")
    collapsed = collapse_captain_rows(df)
    assert len(collapsed) == 3
    maye = collapsed[collapsed["player_name"] == "Drake Maye"].iloc[0]
    assert maye["salary"] == 10000
    assert maye["cpt_salary"] == 15000
    assert maye["dfs_id"] == "22222"
    assert maye["cpt_dfs_id"] == "11111"
    # Idempotent — collapsing twice changes nothing.
    again = collapse_captain_rows(collapsed)
    assert len(again) == 3
    assert again[again["player_name"] == "Drake Maye"].iloc[0]["cpt_salary"] == 15000


def test_collapse_captain_rows_from_salary_ratio_pairs():
    """Live DK showdown draftables have no Roster Position — pairs sit at 1.5×."""
    raw = pd.DataFrame(
        [
            {"dfs_id": "c1", "player_name": "Drake Maye", "name_key": "drake maye", "position": "QB", "team": "NE", "salary": 15000, "site": "draftkings"},
            {"dfs_id": "f1", "player_name": "Drake Maye", "name_key": "drake maye", "position": "QB", "team": "NE", "salary": 10000, "site": "draftkings"},
            {"dfs_id": "f2", "player_name": "Solo Player", "name_key": "solo player", "position": "WR", "team": "SEA", "salary": 5000, "site": "draftkings"},
        ]
    )
    collapsed = collapse_captain_rows(raw)
    assert len(collapsed) == 2
    maye = collapsed[collapsed["player_name"] == "Drake Maye"].iloc[0]
    assert maye["salary"] == 10000
    assert maye["cpt_salary"] == 15000
    assert maye["cpt_dfs_id"] == "c1"
    solo = collapsed[collapsed["player_name"] == "Solo Player"].iloc[0]
    assert pd.isna(solo["cpt_salary"])


def test_attach_salaries_carries_captain_columns():
    pool = pd.DataFrame(
        [
            {
                "player_id": "p1",
                "Player": "Drake Maye",
                "Team": "NE",
                "Position": "QB",
                "Projected Points": 21.0,
                "Low (P10)": 14.0,
                "High (P90)": 27.0,
            }
        ]
    )
    salaries = parse_salary_csv(DK_SHOWDOWN_SAMPLE.encode(), site="draftkings")
    merged, stats = attach_salaries_to_pool(pool, salaries)
    maye = merged[merged["Player"] == "Drake Maye"].iloc[0]
    assert maye["salary"] == 10000
    assert maye["cpt_salary"] == 15000
    assert maye["cpt_dfs_id"] == "11111"
    dst = merged[merged["Position"] == "DST"].iloc[0]
    assert dst["salary"] == 4200
    assert dst["cpt_salary"] == 6300
    assert stats["dst_added"] == 1
