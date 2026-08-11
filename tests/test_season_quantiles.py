"""Tests for SCORE-2 schedule-aware correlated season quantile aggregation."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.projections.season_quantiles import (
    METHOD_INDEPENDENT_SCALE,
    METHOD_MC_SCHEDULE_V1,
    SeasonQuantileParams,
    _calibrate_availability_params,
    _scheduled_weeks_by_team,
    aggregate_season_quantiles_mc,
    fit_two_piece_normal,
    legacy_scale_season_quantiles,
)


def test_fit_two_piece_normal_reconstructs_quantiles():
    mu, sigma_lo, sigma_hi = fit_two_piece_normal([8.0], [15.0], [24.0])
    rng = np.random.default_rng(0)
    z = rng.standard_normal(200_000)
    samples = mu[0] + np.where(z < 0, sigma_lo[0] * z, sigma_hi[0] * z)
    assert abs(np.percentile(samples, 10) - 8.0) < 0.3
    assert abs(np.percentile(samples, 50) - 15.0) < 0.15
    assert abs(np.percentile(samples, 90) - 24.0) < 0.3


def test_fit_two_piece_normal_handles_degenerate_quantiles():
    # q10 == q50 == q90 shouldn't produce zero/negative sigma.
    mu, sigma_lo, sigma_hi = fit_two_piece_normal([10.0], [10.0], [10.0])
    assert sigma_lo[0] > 0
    assert sigma_hi[0] > 0


def test_legacy_scale_matches_naive_x17():
    result = legacy_scale_season_quantiles([1.0, 2.0], [2.0, 4.0], [3.0, 6.0], games_per_season=17)
    assert result.method == METHOD_INDEPENDENT_SCALE
    np.testing.assert_allclose(result.season_p10, [17.0, 34.0])
    np.testing.assert_allclose(result.season_p50, [34.0, 68.0])
    np.testing.assert_allclose(result.season_p90, [51.0, 102.0])


def test_scheduled_weeks_by_team_excludes_bye(monkeypatch):
    import src.projections.season_quantiles as sq

    monkeypatch.setattr(sq, "regular_season_weeks", lambda season: list(range(1, 6)))

    def fake_bye(season, week):
        return {"KC"} if week == 3 else set()

    monkeypatch.setattr(sq, "teams_on_bye", fake_bye)
    schedule = _scheduled_weeks_by_team(2026, ["KC", "BUF"])
    assert list(schedule["KC"]) == [1, 2, 4, 5]
    assert list(schedule["BUF"]) == [1, 2, 3, 4, 5]


def test_calibrate_availability_params_matches_target_in_expectation():
    """Analytic mixture E[games] should reproduce the target for both regimes."""
    n = np.array([17.0, 17.0, 17.0])
    target = np.array([17.0, 12.0, 4.0])
    p_minor, p_major = _calibrate_availability_params(n, target, p_major_default=0.08)

    for i in range(len(n)):
        denom = p_major[i] * max(n[i] - 1, 0) / 2.0 + (1.0 - p_major[i]) * n[i]
        expected_games = (1.0 - p_minor[i]) * denom
        assert abs(expected_games - target[i]) < 0.05
    # A target exactly at n_scheduled (fully durable) needs ~zero engineered injury
    # risk to hit it exactly (regime B); lower targets use the base major-injury
    # rate plus a growing iid weekly-miss probability (regime A).
    assert p_major[0] == pytest.approx(0.0, abs=1e-6)
    assert p_major[1] == pytest.approx(0.08)
    assert p_major[2] == pytest.approx(0.08)
    assert p_minor[2] > p_minor[1] > p_minor[0]


@pytest.mark.parametrize("seed", [1, 2])
def test_mc_deterministic_given_same_seed(seed):
    q10 = pd.Series([8.0, 5.0])
    q50 = pd.Series([15.0, 10.0])
    q90 = pd.Series([24.0, 18.0])
    teams = pd.Series(["KC", "BUF"])
    games = pd.Series([17.0, 14.0])
    params = SeasonQuantileParams(n_sims=500, seed=seed)

    r1 = aggregate_season_quantiles_mc(q10, q50, q90, teams, games, 2026, params=params)
    r2 = aggregate_season_quantiles_mc(q10, q50, q90, teams, games, 2026, params=params)
    np.testing.assert_array_equal(r1.season_p10, r2.season_p10)
    np.testing.assert_array_equal(r1.season_p50, r2.season_p50)
    np.testing.assert_array_equal(r1.season_p90, r2.season_p90)


def test_mc_quantile_ordering_holds():
    q10 = pd.Series([2.0, 8.0, 0.5])
    q50 = pd.Series([9.0, 15.0, 3.0])
    q90 = pd.Series([20.0, 24.0, 12.0])
    teams = pd.Series(["KC", "KC", "BUF"])
    games = pd.Series([17.0, 10.0, 4.0])

    result = aggregate_season_quantiles_mc(
        q10, q50, q90, teams, games, 2026, params=SeasonQuantileParams(n_sims=1500)
    )
    assert np.all(result.season_p10 <= result.season_p50)
    assert np.all(result.season_p50 <= result.season_p90)
    assert np.all(result.season_p10 >= 0)


def test_mc_spread_narrower_than_naive_independent_scaling():
    """Ticket hypothesis: stacking weekly P10/P90 overstates season width vs MC."""
    q10 = pd.Series([6.0] * 10)
    q50 = pd.Series([15.0] * 10)
    q90 = pd.Series([24.0] * 10)
    teams = pd.Series(["KC"] * 5 + ["BUF"] * 5)
    games = pd.Series([17.0] * 10)

    mc = aggregate_season_quantiles_mc(
        q10, q50, q90, teams, games, 2026, params=SeasonQuantileParams(n_sims=2000)
    )
    naive = legacy_scale_season_quantiles(q10, q50, q90, games_per_season=17)
    mc_spread = mc.season_p90 - mc.season_p10
    naive_spread = naive.season_p90 - naive.season_p10
    assert np.all(mc_spread < naive_spread)
    # Independence would predict roughly sqrt(17) narrower; team/week correlation
    # should keep us from over-shrinking versus that bound.
    assert np.all(mc_spread > naive_spread / np.sqrt(17) * 0.5)


def test_mc_realized_games_reflects_bye_and_availability(monkeypatch):
    """A player with a below-full-season games target should realize fewer games than 17."""
    q10 = pd.Series([6.0])
    q50 = pd.Series([15.0])
    q90 = pd.Series([24.0])
    teams = pd.Series(["KC"])
    games = pd.Series([10.0])

    result = aggregate_season_quantiles_mc(
        q10, q50, q90, teams, games, 2026, params=SeasonQuantileParams(n_sims=3000)
    )
    assert result.meta["avg_realized_games"] == pytest.approx(10.0, abs=0.6)


def test_aggregate_season_quantiles_mc_empty_inputs():
    result = aggregate_season_quantiles_mc(
        pd.Series([], dtype=float),
        pd.Series([], dtype=float),
        pd.Series([], dtype=float),
        pd.Series([], dtype=str),
        pd.Series([], dtype=float),
        2026,
    )
    assert result.method == METHOD_MC_SCHEDULE_V1
    assert len(result.season_p10) == 0


def test_season_quantile_params_meta_roundtrip():
    params = SeasonQuantileParams(n_sims=42, rho_team=0.2, week_persistence=0.3, p_major_injury=0.1, seed=7)
    meta = params.as_meta()
    assert meta == {
        "n_sims": 42,
        "rho_team": 0.2,
        "week_persistence": 0.3,
        "p_major_injury": 0.1,
        "seed": 7,
    }
