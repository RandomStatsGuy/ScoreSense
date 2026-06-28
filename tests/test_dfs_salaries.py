"""Tests for DFS salary CSV parsing and pool join."""

import pandas as pd

from src.products.dfs_salaries import attach_salaries_to_pool, parse_salary_csv


DK_SAMPLE = """Position,Name + ID,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev,AvgPointsPerGame
QB,Patrick Mahomes (12345),Patrick Mahomes,12345,QB,8200,KC@LV,KC,24.1
RB,Christian McCaffrey (23456),Christian McCaffrey,23456,RB/FLEX,9000,SF@SEA,SF,22.0
DST,49ers (99999),49ers,99999,DST,2800,SF@SEA,SF,8.0
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
