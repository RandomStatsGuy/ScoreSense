"""Tests for player name linking."""

import pandas as pd

from src.sentiment.player_link import _roster_position, link_mention, load_season_roster, roster_display_names


def test_roster_position_preserves_te():
    row = pd.Series({"position": "TE"})
    assert _roster_position(row, "wr") == "TE"
    row_wr = pd.Series({"position": "WR"})
    assert _roster_position(row_wr, "wr") == "WR"


def test_load_season_roster_wr_te_distinction():
    path = __import__("src.config", fromlist=["PROCESSED_DATA_DIR"]).PROCESSED_DATA_DIR / "wr_mlready.parquet"
    if not path.exists():
        return
    df = pd.read_parquet(path, columns=["season"])
    if df.empty:
        return
    season = int(df["season"].max())
    roster = load_season_roster(season)
    positions = set(roster["position"].unique())
    if "TE" in positions or "WR" in positions:
        assert "WR" in positions or "TE" in positions
        te_rows = roster[roster["position"] == "TE"]
        if not te_rows.empty:
            assert (te_rows["position"] == "TE").all()


def test_link_mention_exact():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0031234",
                "team": "LV",
                "position": "QB",
                "name_key": "aidan oconnell",
                "display_name": "Aidan O'Connell",
            }
        ]
    )
    linked = link_mention("Aidan O'Connell", "LV", roster)
    assert linked is not None
    assert linked["player_id"] == "00-0031234"


def test_roster_display_names_scoped_to_team():
    roster = pd.DataFrame(
        [
            {"player_id": "p1", "team": "LV", "position": "QB", "name_key": "a", "display_name": "Player A"},
            {"player_id": "p2", "team": "KC", "position": "QB", "name_key": "b", "display_name": "Player B"},
        ]
    )
    names = roster_display_names(roster, "LV")
    assert names == ["Player A"]
