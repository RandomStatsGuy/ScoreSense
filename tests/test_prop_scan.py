"""Tests for prop scan helpers."""

from src.products.prop_scan import _fair_lines_for_row, parse_prop_lines_csv


def test_fair_lines_qb():
    fair = _fair_lines_for_row("QB", 20.0, 12.0, 28.0)
    assert fair["pass_yards"] > 0
    assert 0 < fair["anytime_td"] < 1


def test_parse_prop_lines_csv():
    csv = "player,prop_type,line\nPatrick Mahomes,pass_yards,275.5\n"
    df = parse_prop_lines_csv(csv)
    assert len(df) == 1
    assert df.iloc[0]["prop_type"] == "pass_yards"
