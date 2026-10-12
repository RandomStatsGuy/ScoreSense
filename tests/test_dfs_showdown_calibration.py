"""Synthetic arithmetic/coverage fixtures, never an original-lineup reproduction."""
from copy import deepcopy

import pytest

from src.analytics.dfs_showdown_calibration import build_report


def fixture(points=(0, 0, 2, 10)):
    forecasts, outcomes = [], []
    for index, actual in enumerate(points):
        identity = {"season": 2026, "week": 5, "slate_id": "synthetic-a", "player_id": str(index), "score_system_id": "dk_ppr"}
        forecasts.append({**identity, "forecast_at": "2026-10-11T14:00:00Z", "data_known_at": "2026-10-11T13:00:00Z",
            "observed_period_start": "2026-09-01T00:00:00Z", "observed_period_end": "2026-10-10T23:00:00Z",
            "model_frozen_at": "2026-09-01T00:00:00Z", "kickoff_at": "2026-10-11T17:00:00Z",
            "model_id": "synthetic", "source_id": "synthetic-archive", "source_type": "synthetic",
            "basis": "flex", "projection": 3, "projection_statistic": "median", "p10": 0, "p50": 0, "p90": 10,
            "availability_conditioning": "conditional_active", "salary": 3000, "role_bucket": "low_volume"})
        outcomes.append({**identity, "points": actual, "active": True, "basis": "flex", "complete": True,
            "source_id": "synthetic-official-declaration", "source_type": "official_completed_game",
            "ended_at": "2026-10-11T20:00:00Z", "known_at": "2026-10-12T02:00:00Z"})
    return forecasts, outcomes


def report(forecasts=None, outcomes=None):
    if forecasts is None:
        forecasts, outcomes = fixture()
    return build_report(forecasts, outcomes, evidence_scope="synthetic", holdout_from=(2026, 5))


def test_discrete_quantile_ties_do_not_demand_ten_percent_exceedance():
    value = report()
    q = value["metrics"]["quantiles"]
    assert q["p90"]["above"]["value"] == 0
    assert q["p90"]["below"]["value"] == .75
    assert q["p90"]["at_or_below"]["value"] == 1
    assert q["p90"]["empirical_quantile_condition"] is True
    assert q["p50"]["pinball_loss"]["value"] == 1.5
    assert q["p50"]["median_error"] == 1
    assert value["status"] == "calculation_check_only"
    assert value["model_fitted_or_promoted"] is False


def test_median_or_unknown_point_estimate_is_not_mean_and_quantiles_do_not_imply_zero_probability():
    forecasts, outcomes = fixture()
    forecasts[0]["projection_statistic"] = "unknown"
    value = report(forecasts, outcomes)
    assert value["metrics"]["mean_error"] is None
    assert value["metrics"]["zero_score"] is None
    assert value["groups"][0]["salary_bucket"] == "under_4000"


def test_actual_mean_and_explicit_zero_probability_are_scored_on_their_own_denominators():
    forecasts, outcomes = fixture()
    forecasts[0].update(projection_statistic="mean", projection=2, p_zero=.8)
    forecasts[2]["p_zero"] = .25
    value = report(forecasts, outcomes)["metrics"]
    assert value["mean_error"]["n"] == 1 and value["mean_error"]["value"] == -2
    assert value["zero_score"]["observed_frequency"]["value"] == .5
    assert value["zero_score"]["brier_score"]["value"] == pytest.approx((.04 + .0625) / 2)


@pytest.mark.parametrize("active", [False, None, "unknown"])
def test_conditional_active_forecasts_exclude_inactive_and_unknown_outcomes(active):
    forecasts, outcomes = fixture()
    outcomes[0]["active"] = active
    value = report(forecasts, outcomes)
    assert value["coverage"]["matched_rows"] == 3
    assert value["coverage"]["excluded"]["not_confirmed_active_for_conditional_forecast"] == 1


@pytest.mark.parametrize("field", ["forecast_at", "data_known_at", "observed_period_end", "model_frozen_at"])
def test_at_or_after_kickoff_forecast_data_cannot_enter_pregame_evaluation(field):
    forecasts, outcomes = fixture()
    forecasts[0][field] = forecasts[0]["kickoff_at"]
    value = report(forecasts, outcomes)
    assert value["coverage"]["matched_rows"] == 3
    assert value["coverage"]["excluded"]["forecast_or_source_not_prelock"] == 1


def test_missing_outcomes_and_unarchived_timestamps_produce_coverage_not_zero_fill():
    forecasts, outcomes = fixture()
    outcomes.pop()
    forecasts[0].pop("data_known_at")
    value = report(forecasts, outcomes)
    assert value["coverage"]["matched_rows"] == 2
    assert value["coverage"]["excluded"] == {"outcome_missing": 1, "pregame_known_at_evidence_missing": 1}
    missing = build_report([], [], holdout_from=(2026, 5))
    assert missing["status"] == "coverage_only" and missing["metrics"] is None


def test_malformed_timezone_cannot_normalize_into_a_pregame_timestamp():
    forecasts, outcomes = fixture()
    forecasts[0]["data_known_at"] = "2026-10-11T13:00:00+01:99"
    value = report(forecasts, outcomes)
    assert value["coverage"]["matched_rows"] == 3
    assert value["coverage"]["excluded"]["pregame_known_at_evidence_missing"] == 1


@pytest.mark.parametrize("field,value", [("data_known_at", "2026-10-11T16:00:00Z"),
    ("model_frozen_at", "2026-10-11T16:00:00Z"), ("observed_period_start", "2026-10-11T16:00:00Z")])
def test_later_source_model_or_invalid_observed_window_cannot_explain_an_earlier_forecast(field, value):
    forecasts, outcomes = fixture()
    forecasts[0][field] = value
    result = report(forecasts, outcomes)
    assert result["coverage"]["matched_rows"] == 3
    assert result["coverage"]["excluded"]["source_unavailable_at_forecast_or_invalid_window"] == 1


def test_no_holdout_declaration_means_no_benchmark_and_earlier_weeks_are_not_evaluated():
    forecasts, outcomes = fixture()
    forecasts[0]["week"] = outcomes[0]["week"] = 4
    value = report(forecasts, outcomes)
    assert value["coverage"]["excluded"]["earlier_reference_week_not_evaluated"] == 1
    assert build_report(forecasts, outcomes)["coverage"]["matched_rows"] == 0


def test_uncertainty_uses_whole_slate_week_blocks_and_one_block_stays_unknown():
    forecasts, outcomes = fixture()
    assert report()["metrics"]["quantiles"]["p90"]["below"]["block_interval"] is None
    forecasts[0]["slate_id"] = outcomes[0]["slate_id"] = "synthetic-b"
    value = report(forecasts, outcomes)["metrics"]["quantiles"]["p90"]["below"]["block_interval"]
    assert value["blocks"] == 2 and 0 <= value["lower"] <= value["upper"] <= 1
    assert value == report(forecasts, outcomes)["metrics"]["quantiles"]["p90"]["below"]["block_interval"]


@pytest.mark.parametrize("mutation", ["duplicate", "nonfinite", "quantile_order", "p_zero"])
def test_ambiguous_or_invalid_numeric_archives_fail(mutation):
    forecasts, outcomes = fixture()
    if mutation == "duplicate":
        forecasts.append(deepcopy(forecasts[0]))
    elif mutation == "nonfinite":
        forecasts[0]["p90"] = float("nan")
    elif mutation == "quantile_order":
        forecasts[0]["p10"] = 20
    else:
        forecasts[0]["p_zero"] = 1.5
    with pytest.raises(ValueError):
        report(forecasts, outcomes)


def test_compatible_scoring_and_official_completed_sources_are_required():
    forecasts, outcomes = fixture()
    outcomes[0]["score_system_id"] = "other"
    outcomes[1]["source_type"] = "unverified_box_score"
    value = report(forecasts, outcomes)
    assert value["coverage"]["matched_rows"] == 2
    assert value["coverage"]["excluded"] == {"official_completed_outcome_evidence_missing": 1, "outcome_missing": 1}


def test_report_does_not_mutate_forecasts_or_outcomes():
    forecasts, outcomes = fixture()
    before = deepcopy((forecasts, outcomes))
    report(forecasts, outcomes)
    assert (forecasts, outcomes) == before
