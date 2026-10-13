"""The research classifier must not turn observed-row risk into contest risk."""
import json

import numpy as np
import pandas as pd
import pytest

from src.analytics.dfs_zero_score_eval import (
    BUCKETS, CONDITIONING, FEATURE_COLS, evaluate, make_classifier,
    paired_probability_interval, prepare_research_rows, prevalence_baselines,
    probability_metrics, usage_buckets,
)


def history_fixture():
    rows = []
    for season in range(2018, 2021):
        for player, position in (("low", "WR"), ("high", "WR"), ("tight", "TE")):
            for week in range(1, 5):
                targets = 1 if player == "low" else 8 if player == "high" else 4
                score = 0 if (week + season) % 3 == 0 else -1 if player == "low" and week == 2 else targets * 1.5
                rows.append({"player_id": player, "position": position, "season": season, "week": week,
                    "Fpts": score, "targets_lead": targets, "receptions_lead": targets - 1,
                    "receiving_yards_lead": targets * 8, "receiving_air_yards_lead": targets * 10})
    return pd.DataFrame(rows)


def test_prior_feature_and_zero_event_preserve_negative_scores_and_cold_starts():
    rows = prepare_research_rows(history_fixture())
    low = rows[rows.player_id.eq("low") & rows.season.eq(2018)]
    assert low.iloc[0].recent4_Fpts_avg != low.iloc[0].recent4_Fpts_avg
    assert low.iloc[0].usage_bucket == BUCKETS[0]
    assert low.iloc[1].recent4_Fpts_avg == low.iloc[0].Fpts
    assert rows.loc[rows.Fpts.lt(0), "is_zero"].eq(0).all()
    assert rows.loc[rows.Fpts.eq(0), "is_zero"].eq(1).all()
    assert rows.loc[rows.position.eq("TE"), "is_tight_end"].eq(1).all()
    assert rows.loc[rows.position.eq("WR"), "is_tight_end"].eq(0).all()


def test_training_preprocessing_and_baselines_ignore_target_and_future_outcomes():
    original = history_fixture()
    report, rows = evaluate(original, seasons=[2019], bootstrap_repeats=20)
    changed = original.copy()
    # Change every future outcome and usage column, and target-year outcomes.
    changed.loc[changed.season.eq(2020), ["Fpts", "targets_lead", "receptions_lead", "receiving_yards_lead", "receiving_air_yards_lead"]] = 1000
    changed.loc[changed.season.eq(2019), "Fpts"] += 13
    after, after_rows = evaluate(changed, seasons=[2019], bootstrap_repeats=20)
    a, b = report["folds"][0], after["folds"][0]
    assert a["training_max_season"] == 2018
    assert a["training_matrix_and_labels_sha256"] == b["training_matrix_and_labels_sha256"]
    assert a["fitted_pipeline_sha256"] == b["fitted_pipeline_sha256"]
    # Target-week scoring is not an input to that week's prediction.
    first = rows.week.eq(1)
    np.testing.assert_array_equal(rows.loc[first, "probability_classifier"], after_rows.loc[first, "probability_classifier"])
    for baseline in ("training_global_prevalence", "training_usage_prevalence"):
        np.testing.assert_array_equal(rows[f"probability_{baseline}"], after_rows[f"probability_{baseline}"])


def test_current_game_and_future_usage_do_not_change_earlier_features():
    original = history_fixture()
    changed = original.copy()
    changed.loc[changed.season.ge(2019) & changed.week.ge(3), "targets_lead"] = 1000
    before = prepare_research_rows(original)
    after = prepare_research_rows(changed)
    mask = before.season.eq(2019) & before.week.le(3)
    np.testing.assert_array_equal(before.loc[mask, list(FEATURE_COLS)], after.loc[mask, list(FEATURE_COLS)])


def test_imputation_and_scaling_fit_only_passed_training_matrix():
    train = pd.DataFrame({"x": [0., 2., np.nan, 4.], "empty": [np.nan] * 4})
    model = make_classifier().fit(train, [0, 1, 0, 1])
    np.testing.assert_array_equal(model.named_steps["imputer"].statistics_, [2., 0.])
    fitted_mean = model.named_steps["scaler"].mean_.copy()
    assert np.isfinite(model.predict_proba(pd.DataFrame({"x": [1e6, np.nan], "empty": [2., np.nan]}))).all()
    np.testing.assert_array_equal(model.named_steps["scaler"].mean_, fitted_mean)
    assert model.named_steps["classifier"].class_weight is None


def test_missing_prior_usage_stays_a_separate_group_and_is_not_invented_zero():
    frame = history_fixture()
    frame.loc[frame.player_id.eq("tight"), "targets_lead"] = np.nan
    report, rows = evaluate(frame, seasons=[2019], bootstrap_repeats=20)
    unknown = rows.loc[rows.player_id.eq("tight")]
    assert unknown.usage_bucket.eq(BUCKETS[0]).all()
    assert unknown.recent4_targets_avg.isna().all()
    assert np.isfinite(unknown.probability_classifier).all()
    assert report["folds"][0]["cohorts"]["unknown_prior_usage"]["rows"] == len(unknown)
    assert report["folds"][0]["input_missing_counts"]["recent4_targets_avg"] == len(unknown)


def test_predeclared_buckets_include_boundaries_without_outcome_selection():
    frame = pd.DataFrame({"recent4_targets_avg": [np.nan, 0, 2, 2.001, 6, 6.001], "Fpts": [1000] * 6})
    assert usage_buckets(frame).tolist() == [BUCKETS[0], BUCKETS[1], BUCKETS[1], BUCKETS[2], BUCKETS[2], BUCKETS[3]]


def test_training_only_prevalence_uses_fixed_smoothing_and_unseen_bucket_fallback():
    train = pd.DataFrame({"is_zero": [1, 0], "usage_bucket": [BUCKETS[1], BUCKETS[1]]})
    test = pd.DataFrame({"is_zero": [1, 1], "usage_bucket": [BUCKETS[1], BUCKETS[3]]})
    first = prevalence_baselines(train, test)
    test["is_zero"] = 0
    second = prevalence_baselines(train, test)
    for key in first:
        np.testing.assert_array_equal(first[key], [.5, .5])
        np.testing.assert_array_equal(first[key], second[key])


def test_proper_scores_and_reliability_include_probability_one_and_single_class():
    result = probability_metrics(np.array([0, 1, 1]), np.array([0., .5, 1.]))
    assert result["brier_score"] == pytest.approx(.25 / 3)
    assert result["log_loss"] == pytest.approx(np.log(2) / 3)
    assert result["reliability"][-1]["n"] == 1
    assert sum(row["n"] for row in result["reliability"]) == 3
    assert np.isfinite(probability_metrics(np.zeros(2), np.array([.1, .2]))["log_loss"])


def test_week_block_intervals_use_paired_proper_scores_and_leave_single_week_unknown():
    rows = pd.DataFrame({"season": [2019] * 4, "week": [1, 1, 2, 2], "is_zero": [0, 1, 0, 1]})
    perfect = rows.is_zero.to_numpy(dtype=float)
    baseline = np.full(4, .5)
    result = paired_probability_interval(rows, perfect, baseline, metric="brier_score", repeats=50)
    assert result["mean_delta"] == -.25
    assert result["week_blocks"] == 2
    assert result["ci95"] == [-.25, -.25]
    single = paired_probability_interval(rows.iloc[:2], perfect[:2], baseline[:2], metric="log_loss", repeats=50)
    assert single["ci95"] is None
    assert single["bootstrap_repeats"] == 0


@pytest.mark.parametrize("defect", ["duplicate", "missing_id", "blank_id", "nonfinite", "missing_outcome", "nullable_outcome", "boolean_outcome", "fractional_week", "boolean_week", "nullable_week", "wrong_position"])
def test_invalid_identities_and_outcomes_are_rejected(defect):
    frame = history_fixture()
    if defect == "duplicate":
        frame = pd.concat([frame, frame.iloc[:1]], ignore_index=True)
    elif defect in ("missing_id", "blank_id"):
        frame.loc[0, "player_id"] = None if defect == "missing_id" else " "
    elif defect in ("nonfinite", "missing_outcome"):
        frame.loc[0, "Fpts"] = np.inf if defect == "nonfinite" else np.nan
    elif defect == "nullable_outcome":
        frame["Fpts"] = frame.Fpts.astype("Float64")
        frame.loc[0, "Fpts"] = pd.NA
    elif defect == "boolean_outcome":
        frame["Fpts"] = frame.Fpts.astype(object)
        frame.loc[0, "Fpts"] = True
    elif defect in ("fractional_week", "boolean_week"):
        frame["week"] = frame.week.astype(object)
        frame.loc[0, "week"] = 1.5 if defect == "fractional_week" else True
    elif defect == "nullable_week":
        frame["week"] = frame.week.astype("Int64")
        frame.loc[0, "week"] = pd.NA
    else:
        frame.loc[0, "position"] = "RB"
    with pytest.raises(ValueError):
        prepare_research_rows(frame)


@pytest.mark.parametrize("probabilities", [[-.01, .5], [.1, 1.01], [np.nan, .5], [np.inf, .5]])
def test_invalid_probabilities_are_rejected(probabilities):
    with pytest.raises(ValueError):
        probability_metrics(np.array([0, 1]), np.array(probabilities))


def test_fractional_event_is_rejected_instead_of_cast_to_zero():
    with pytest.raises(ValueError):
        probability_metrics(np.array([.5, 1]), np.array([.2, .8]))


def test_fold_rejects_missing_train_test_and_single_class_training():
    frame = history_fixture()
    for seasons in ([2018], [2019, 2019], [2021]):
        with pytest.raises(ValueError):
            evaluate(frame, seasons=seasons, bootstrap_repeats=20)
    frame.loc[frame.season.eq(2018), "Fpts"] = 1
    with pytest.raises(ValueError, match="Both zero and nonzero"):
        evaluate(frame, seasons=[2019], bootstrap_repeats=20)


def test_report_saves_real_walk_forward_rows_without_promotion_or_inactive_reconstruction():
    frame = history_fixture()
    # Both a missing observed week and postseason rows must stay outside the cohort.
    frame = frame[~(frame.player_id.eq("low") & frame.season.eq(2019) & frame.week.eq(3))]
    postseason = frame.iloc[:1].copy()
    postseason[["season", "week"]] = [2019, 18]
    frame = pd.concat([frame, postseason], ignore_index=True)
    report, rows = evaluate(frame, seasons=[2019, 2020], bootstrap_repeats=20)
    assert len(rows) == 23
    assert not ((rows.season == 2019) & (rows.week == 18)).any()
    assert not ((rows.player_id == "low") & (rows.season == 2019) & (rows.week == 3)).any()
    assert [fold["training_max_season"] for fold in report["folds"]] == [2018, 2019]
    assert report["conditioning"] == CONDITIONING
    assert report["serving_changed"] is False
    assert report["production_eligible"] is False
    assert report["fitted_models_saved"] is False
    assert len(report["folds"][0]["fitted_pipeline_sha256"]) == 64
    assert report["pooled_cohorts"]["all_observed"]["rows"] == len(rows)
    json.dumps(report, allow_nan=False)
