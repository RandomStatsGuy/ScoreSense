"""Tests for ScoreSense feature engineering."""

import numpy as np
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


def test_platform_trend_noise_has_one_training_and_inference_contract():
    from src.projections.temporal_inputs import feature_digest
    columns = ["carry_share_avg_trend", "receiving_yards_avg"]
    windows = pd.DataFrame({columns[0]: [0.04577569169960479, -1e-16, np.nan],
                            columns[1]: [10., 20., 30.]})
    linux = windows.copy()
    linux[columns[0]] = [0.0457756916996047, 1e-16, np.nan]
    original = windows.copy()
    training = prepare_feature_matrix(windows, "rb", feature_cols_override=columns)
    inference = prepare_feature_matrix(linux, "rb", feature_cols_override=columns)
    y = pd.Series([10., 20., 0.])
    pd.testing.assert_frame_equal(training, inference)
    assert feature_digest(training, y) == feature_digest(inference, y)
    assert not np.signbit(training.loc[1, columns[0]])
    assert training.attrs["input_quality"]["null_counts"][columns[0]] == 1
    pd.testing.assert_frame_equal(windows, original)

    revised = linux.copy()
    revised.loc[0, columns[0]] += 1e-8
    changed = prepare_feature_matrix(revised, "rb", feature_cols_override=columns)
    assert feature_digest(changed, y) != feature_digest(training, y)
    # Other features and outcomes retain their exact qualification checks.
    revised = linux.copy()
    revised.loc[0, columns[1]] = np.nextafter(10., np.inf)
    changed = prepare_feature_matrix(revised, "rb", feature_cols_override=columns)
    assert feature_digest(changed, y) != feature_digest(training, y)
    assert feature_digest(training, y + 1e-9) != feature_digest(training, y)


def test_trend_rounding_boundary_does_not_reintroduce_platform_noise():
    # An actual frozen-vs-production pair fell on a 12-decimal rounding boundary.
    from src.projections.temporal_inputs import feature_digest
    values = pd.DataFrame({"carry_share_avg_trend": [-0.0015503119995]})
    other = values.copy()
    other.iloc[0, 0] = np.nextafter(values.iloc[0, 0], -np.inf)
    a = prepare_feature_matrix(values, "rb", feature_cols_override=list(values))
    b = prepare_feature_matrix(other, "rb", feature_cols_override=list(other))
    assert feature_digest(a, pd.Series([0.])) == feature_digest(b, pd.Series([0.]))


def test_trend_slope_preserves_ols_and_pregame_window():
    from src.analytics.candidate_etl import _trend_slope, _usage_volatility_and_trend
    for values in ([.1, .2], [.4, .1, .3], [.05, .05, .05, .05], [.04, .08, .12, .06]):
        assert np.isclose(_trend_slope(values), np.polyfit(range(len(values)), values, 1)[0], atol=1e-15)
    assert _trend_slope([.05, .05, .05, .05]) == 0.
    data = pd.DataFrame({"player_id": ["a"]*5, "season": [2025]*5,
                         "week": [1, 2, 3, 4, 5], "carry_share_avg": [.1, .2, .4, .3, .9]})
    before = _usage_volatility_and_trend(data, "carry_share_avg")
    changed = data.copy()
    changed.loc[4, "carry_share_avg"] = -999.
    after = _usage_volatility_and_trend(changed, "carry_share_avg")
    assert pd.isna(before.iloc[0].carry_share_avg_trend)
    assert before.iloc[4].carry_share_avg_trend == _trend_slope([.1, .2, .4, .3])
    pd.testing.assert_series_equal(before.carry_share_avg_trend, after.carry_share_avg_trend)
