import numpy as np
import pandas as pd
import pytest

from src.analytics.forecast_validation import (
    actionable_mask, attach_game_market, forecast_metrics, paired_week_bootstrap,
)


def rows(scores, position="QB"):
    return pd.DataFrame({"Fpts": scores, "season": 2025, "week": 1, "position": position})


def predictions(medians, width=2):
    return pd.DataFrame({"q10": np.asarray(medians)-width, "q50": medians,
                         "q90": np.asarray(medians)+width})


def test_market_home_favorite_and_team_alias_without_using_outcomes():
    schedule = pd.DataFrame({"season": [2025], "week": [1], "home_team": ["LA"],
        "away_team": ["SEA"], "spread_line": [6.], "total_line": [48.],
        "home_score": [999], "away_score": [-999], "game_type": ["REG"]})
    frame = pd.DataFrame({"season": [2025, 2025, 2026], "week": [1, 1, 1],
                          "team": ["SEA", "LAR", "SEA"]}, index=[17, 4, 88])
    result = attach_game_market(frame, schedule)
    assert result.index.equals(frame.index)
    assert result.game_implied_team_total.iloc[:2].tolist() == [21., 27.]
    assert result.game_spread.iloc[:2].tolist() == [-6., 6.]
    assert np.isnan(result.game_total_line.iloc[2])
    schedule[["home_score", "away_score"]] = 0
    pd.testing.assert_frame_equal(result, attach_game_market(frame, schedule))


@pytest.mark.parametrize("game_type", ["WC", "DIV", "CON", "SB"])
def test_market_preserves_postseason(game_type):
    schedule = pd.DataFrame({"season": [2025], "week": [19], "home_team": ["KC"],
        "away_team": ["BUF"], "spread_line": [-2.], "total_line": [50.], "game_type": [game_type]})
    frame = pd.DataFrame({"season": [2025], "week": [19], "team": ["KC"]})
    assert attach_game_market(frame, schedule).game_implied_team_total.item() == 24.
    with pytest.raises(ValueError, match="multiple games"):
        attach_game_market(frame, pd.concat([schedule, schedule]))


def test_actionable_selection_uses_reference_forecasts_and_separate_te_pool():
    frame = rows([0.]*30 + [100.]*30)
    frame.loc[30:, "position"] = "TE"
    reference = predictions(list(range(30)) + list(range(30)))
    mask = actionable_mask(frame, reference)
    assert mask.sum() == 48
    assert mask[:30].sum() == 24
    assert mask[30:].sum() == 24
    frame.Fpts = np.arange(60)[::-1] * 100.
    pd.testing.assert_series_equal(mask, actionable_mask(frame, reference))


def test_wide_intervals_cannot_win_by_coverage_alone():
    frame = rows([10., 10.])
    sharp = forecast_metrics(frame, predictions([10., 10.]), "qb")
    broad = forecast_metrics(frame, predictions([10., 10.], width=50), "qb")
    assert sharp["coverage_p10_p90"] == broad["coverage_p10_p90"] == 1.
    assert sharp["weighted_interval_score"] < broad["weighted_interval_score"]
    assert sharp["weighted_interval_score"] == pytest.approx(4./15.)
    assert sharp["interval_score_80"] == 4.


def test_boom_recall_alone_hides_false_alarms_and_bust_metrics_expose_them():
    frame = rows([30., 0., 0., 0.])
    broad = forecast_metrics(frame, predictions([10.]*4, width=30), "qb")
    assert broad["boom"]["recall"] == 1.
    assert broad["boom"]["precision"] == .25
    assert broad["boom"]["false_positive_rate"] == 1.
    assert broad["bust"]["precision"] == .75
    assert broad["bust"]["false_positive_rate"] == 1.


def test_discrete_zero_ties_bracket_nominal_quantile():
    metrics = forecast_metrics(rows([0., 0., 0.]), predictions([0.]*3, width=0), "rb")
    assert metrics["quantile_calibration"]["0.1"] == {
        "below": 0., "at_or_below": 1., "distance_from_nominal": 0.}
    assert metrics["weighted_interval_score"] == 0.


def test_bootstrap_is_paired_and_keeps_weeks_together():
    frame = rows([10., 20., 0., 10.])
    frame.week = [1, 1, 2, 2]
    reference = predictions([8., 18., 2., 8.])
    candidate = predictions(frame.Fpts.tolist())
    result = paired_week_bootstrap(frame, reference, candidate, repeats=100)
    assert result["week_blocks"] == 2
    assert result["ci95"] == [-2., -2.]
    assert result["fraction_delta_below_zero"] == 1.
    same = paired_week_bootstrap(frame, reference, reference, repeats=100)
    assert same["ci95"] == [0., 0.]


def test_unmatched_nonfinite_and_crossed_forecasts_are_rejected():
    frame = rows([10., 20.])
    pred = predictions([10., 20.])
    with pytest.raises(ValueError, match="index and order"):
        forecast_metrics(frame, pred.iloc[::-1], "qb")
    pred.loc[0, "q90"] = np.nan
    with pytest.raises(ValueError, match="finite"):
        forecast_metrics(frame, pred, "qb")
    pred.loc[0, "q90"] = 0.
    with pytest.raises(ValueError, match="ordered"):
        forecast_metrics(frame, pred, "qb")
    with pytest.raises(ValueError, match="Cohort mask"):
        forecast_metrics(frame, predictions([10., 20.]), "qb", mask=pd.Series([True, False], index=[4, 5]))
