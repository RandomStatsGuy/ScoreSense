"""Tests for ScoreSense feature engineering."""

import pandas as pd

from src.core.features import (
    calc_fantasy_points_ppr,
    get_position_features,
    prepare_feature_matrix,
    season_average_baseline,
)


def test_calc_fantasy_points_ppr():
    df = pd.DataFrame(
        {
            "passing_yards": [250],
            "passing_tds": [2],
            "interceptions": [1],
            "rushing_yards": [20],
            "rushing_tds": [0],
            "receptions": [0],
            "receiving_yards": [0],
            "receiving_tds": [0],
            "fumbles_lost": [0],
        }
    )
    pts = calc_fantasy_points_ppr(df).iloc[0]
    expected = 250 * 0.04 + 2 * 4 + (-2) + 20 * 0.1
    assert pts == expected


def test_prepare_feature_matrix_shape():
    spec = get_position_features("qb")
    df = pd.DataFrame({col: [1.0] for col in spec.feature_cols})
    matrix = prepare_feature_matrix(df, "qb")
    assert list(matrix.columns) == list(spec.feature_cols)
    assert len(matrix) == 1


def test_season_average_baseline():
    df = pd.DataFrame(
        {
            "player_id": ["a", "a", "a"],
            "season": [2024, 2024, 2024],
            "Fpts": [10.0, 20.0, 30.0],
        }
    )
    baseline = season_average_baseline(df)
    assert pd.isna(baseline.iloc[0])
    assert baseline.iloc[1] == 10.0
    assert baseline.iloc[2] == 15.0
