"""Causal historical component replay, never a live projection accuracy claim."""
import numpy as np
import pandas as pd
import pytest

from src.analytics import dfs_serving_timing_eval as replay
from src.analytics.candidate_etl import _usage_volatility_and_trend


def history(position="rb"):
    shares = [.1, .2, .8, .5, .3, .9, .2, .4]
    data = pd.DataFrame({"player_id": ["a"]*8, "season": [2020]*4+[2021]*4,
        "week": [1, 2, 3, 4]*2, "position": ["RB" if position == "rb" else "TE"]*8,
        "opponent": ["KC"]*8, "team": ["LV"]*8,
        "Fpts": [0., -2., 6., 8., 0., 12., 3., 999.],
        "carry_share_lead": shares, "target_share_lead": shares,
        "carries_lead": [3., 0., 4., 2., 5., 1., 0., 999.],
        "rushing_yards_lead": [10.]*8, "targets_lead": [1., 0., 5., 1., 2., 4., 0., 999.],
        "receptions_lead": [0., 0., 3., 1., 1., 3., 0., 999.],
        "receiving_yards_lead": [10.]*8, "receiving_air_yards_lead": [20.]*8,
        "target_quality_raw_lead": [1.]*8,
        "opponent_pass_epa_allowed": [.1]*8, "opponent_rush_epa_allowed": [.2]*8})
    for share in ("target_share", "carry_share"):
        col = f"{share}_avg"
        data[col] = data.groupby("player_id")[f"{share}_lead"].transform(lambda s: s.shift().expanding().mean())
        data = _usage_volatility_and_trend(data, col)
    return data


@pytest.mark.parametrize("position,column", [("rb", "carry_share_avg_trend"), ("wr", "target_share_avg_volatility")])
def test_replay_is_training_aligned_and_reproduces_old_last_game_value(position, column):
    data = history(position)
    stale, corrected, evidence = replay.replay_inputs(data, position)
    assert stale.loc[6, column] == pytest.approx(data.loc[5, column])
    assert corrected.loc[6, column] == pytest.approx(data.loc[6, column])
    assert stale.loc[6, column] != pytest.approx(corrected.loc[6, column])
    assert evidence["training_parity"][column]["mismatched"] == 0
    assert list(corrected.index) == list(stale.index)


def test_target_and_future_observations_cannot_change_earlier_replay_inputs():
    data = history()
    old_stale, old_corrected, _ = replay.replay_inputs(data, "rb")
    changed = data.copy()
    changed.loc[6:, ["Fpts", "carry_share_lead", "target_share_lead", "carries_lead", "targets_lead"]] = 9000.
    # Recompute historical derivatives as a normal ETL would after revised data.
    for share in ("target_share", "carry_share"):
        col = f"{share}_avg"
        changed[col] = changed.groupby("player_id")[f"{share}_lead"].transform(lambda s: s.shift().expanding().mean())
        changed = _usage_volatility_and_trend(changed, col)
    new_stale, new_corrected, _ = replay.replay_inputs(changed, "rb")
    columns = ["carry_share_avg_trend", "recent4_Fpts_avg", "recent4_carries_avg"]
    pd.testing.assert_frame_equal(old_stale.loc[:6, columns], new_stale.loc[:6, columns])
    pd.testing.assert_frame_equal(old_corrected.loc[:6, columns], new_corrected.loc[:6, columns])


@pytest.mark.parametrize("defect", ["duplicate", "unknown_id", "postseason", "nonfinite", "fractional_week"])
def test_invalid_or_ambiguous_historical_rows_reject(defect):
    data = history()
    if defect == "duplicate": data = pd.concat([data, data.iloc[[0]]])
    if defect == "unknown_id": data.loc[0, "player_id"] = None
    if defect == "postseason": data["season_type"] = "POST"
    if defect == "nonfinite": data.loc[0, "Fpts"] = np.inf
    if defect == "fractional_week": data["week"] = data.week.astype(float); data.loc[0, "week"] = 1.5
    with pytest.raises(ValueError):
        replay.validate_history(data)


def test_cohorts_do_not_turn_unknown_history_into_low_usage_or_select_on_outcomes():
    rows = pd.DataFrame({"recent4_targets_avg": [np.nan, 0., 2., 2.1], "Fpts": [90., 10., -2., 0.]})
    before = replay.usage_cohorts(rows, "wr")
    rows["Fpts"] = rows.Fpts * -100
    after = replay.usage_cohorts(rows, "wr")
    assert list(before["low_prior_usage"]) == [False, True, True, False]
    assert list(before["unknown_prior_usage"]) == [True, False, False, False]
    for name in before:
        pd.testing.assert_series_equal(before[name], after[name])


def test_paired_metrics_keep_zero_negative_outcomes_and_median_semantics():
    rows = pd.DataFrame({"player_id": ["a", "b", "a", "b"], "season": [2025]*4,
        "week": [1, 1, 2, 2], "position": ["WR"]*4, "Fpts": [0., -2., 4., 8.],
        "recent4_targets_avg": [0., 1., 2., 5.]})
    stale = pd.DataFrame({"q10": [-2.]*4, "q50": [3.]*4, "q90": [12.]*4})
    corrected = stale.copy(); corrected["q50"] = [0., -1., 4., 7.]
    result = replay.compare_predictions(rows, stale, corrected, "wr", repeats=30)
    assert result["all_observed"]["observed_zero_frequency"] == .25
    assert result["all_observed"]["corrected"]["mae"] == .5
    assert "median_average_error" in result["all_observed"]["corrected"]
    assert "mean_bias" not in result["all_observed"]["corrected"]
    assert result["all_observed"]["paired_mae"]["mean_mae_delta"] < 0
    assert result["low_prior_usage"]["rows"] == 3


def test_evaluation_fits_only_earlier_seasons_and_keeps_research_separate(tmp_path, monkeypatch):
    source = tmp_path / "source"; source.mkdir()
    data = history(); data.to_parquet(source / "rb_mlready.parquet")
    calls = []
    def fit(X, y, position, season, cols, directory):
        calls.append((season, y.tolist()))
        return {}, {"training_matrix_digest": "synthetic"}
    monkeypatch.setattr(replay, "_models", fit)
    monkeypatch.setattr(replay, "predict_quantiles", lambda models, X: pd.DataFrame({"q10": -2., "q50": 4., "q90": 20.}, index=X.index))
    output = tmp_path / "research"
    report = replay.evaluate("rb", source, output, [2021])
    assert calls == [(2021, [0., -2., 6., 8.])]
    assert report["comparisons"][0]["training_max_season"] == 2020
    assert report["production_models_changed"] is False
    assert report["pregame_publication_verified"] is False
    assert (output / "rb_2021_rows.parquet").is_file()
    assert not (source / "checkpoints").exists()
    with pytest.raises(ValueError, match="separate"):
        replay.evaluate("rb", source, source / "models", [2021])


def test_one_week_cannot_estimate_block_uncertainty():
    rows = pd.DataFrame({"player_id": ["a", "b"], "season": [2025]*2,
        "week": [1]*2, "position": ["TE"]*2, "Fpts": [0., 4.], "recent4_targets_avg": [1., 2.]})
    predictions = pd.DataFrame({"q10": [0.]*2, "q50": [2.]*2, "q90": [10.]*2})
    evidence = replay.compare_predictions(rows, predictions, predictions, "wr")["all_observed"]["paired_mae"]
    assert evidence["week_blocks"] == 1
    assert evidence["ci95"] is None
    assert evidence["mean_mae_delta"] == 0
