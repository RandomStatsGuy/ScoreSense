"""Live completed profiles must match the next game's trained usage inputs."""

import numpy as np
import pandas as pd
import pytest

from src.analytics.candidate_etl import _usage_volatility_and_trend
from src.core.features import add_rolling_averages, completed_game_profiles
from src.core.projection_context import build_projection_roster


def training_rows(raw_column, observations):
    """Use the existing ETL definitions, including its stored opener imputation."""
    count = len(observations)
    raw = pd.DataFrame({
        "player_id": ["player"] * count,
        "season": [2024] * 3 + [2025] * (count - 3),
        "week": [16, 17, 18] + list(range(1, count - 2)),
        "team": ["BUF"] * count,
        raw_column: observations,
    })
    rows = add_rolling_averages(raw, "player_id", [raw_column])
    rows = _usage_volatility_and_trend(rows, f"{raw_column}_avg")
    rows = rows.rename(columns={raw_column: f"{raw_column}_lead"})
    # Base ETL fills stored means, while candidate derivatives are calculated
    # before that fill. Reusing stored means would corrupt early-game windows.
    rows[f"{raw_column}_avg"] = rows[f"{raw_column}_avg"].fillna(0.0)
    return rows


@pytest.mark.parametrize("raw_column", ["carry_share", "target_share", "routes"])
@pytest.mark.parametrize("observations", [
    [.1, .2, .8, .5, .3, .9, .2],
    [0., 0., 0., 0., .2, 0., .3],
    [.1, np.nan, .8, .5, np.nan, .9, .2],
])
def test_completed_derived_usage_equals_every_next_training_row(raw_column, observations):
    rows = training_rows(raw_column, observations)
    original = rows.copy(deep=True)
    columns = [f"{raw_column}_avg", f"{raw_column}_avg_trend", f"{raw_column}_avg_volatility"]
    for index in range(1, len(rows)):
        expected = rows.iloc[[index]][columns].reset_index(drop=True)
        actual = completed_game_profiles(rows.iloc[:index]).iloc[[-1]][columns].reset_index(drop=True)
        pd.testing.assert_frame_equal(actual, expected, check_exact=False, atol=1e-14, rtol=1e-14)
    pd.testing.assert_frame_equal(rows, original)


def test_derived_usage_is_player_specific_and_excludes_target_and_future_games():
    first = training_rows("carry_share", [.1, .2, .8, .5, .3, .9, .2])
    second = training_rows("carry_share", [.9, .8, .1, .6, .7, .2, .8]).assign(player_id="other")
    data = pd.concat([first, second], ignore_index=True).sample(frac=1, random_state=9)
    before = build_projection_roster(data, 2025, 3).set_index("player_id")
    expected = data[data.season.eq(2025) & data.week.eq(3)].set_index("player_id")
    columns = ["carry_share_avg_trend", "carry_share_avg_volatility"]
    pd.testing.assert_frame_equal(before[columns].sort_index(), expected[columns].sort_index())
    data.loc[data.season.eq(2025) & data.week.ge(3), "carry_share_lead"] = -999.
    after = build_projection_roster(data, 2025, 3).set_index("player_id")
    pd.testing.assert_frame_equal(before, after)


def test_missing_derived_source_stays_unknown_instead_of_retaining_last_game_input():
    frame = pd.DataFrame({"player_id": ["player"], "season": [2025], "week": [4],
                          "carry_share_avg": [.2], "carry_share_avg_trend": [.7],
                          "carry_share_avg_volatility": [.9]})
    completed = completed_game_profiles(frame)
    assert completed.carry_share_avg_trend.isna().all()
    assert completed.carry_share_avg_volatility.isna().all()
    assert completed.iloc[0].carry_share_avg == .2


def test_legacy_share_observations_are_reconstructed_before_derived_usage_advances():
    rows = training_rows("carry_share", [.1, .2, .8, .5, .3, .9, .2])
    # Preserve the existing legacy reconstruction: two RBs sum to ten carries.
    other = rows.copy().assign(player_id="other")
    rows["carries_lead"] = rows.carry_share_lead * 10
    other["carries_lead"] = (1 - rows.carry_share_lead) * 10
    data = pd.concat([rows, other], ignore_index=True).drop(columns="carry_share_lead")
    prior = data[(data.season.lt(2025)) | (data.season.eq(2025) & data.week.lt(4))]
    completed = completed_game_profiles(prior).groupby("player_id").tail(1).set_index("player_id")
    expected = rows[rows.season.eq(2025) & rows.week.eq(4)].iloc[0]
    assert completed.loc["player", "carry_share_avg_trend"] == pytest.approx(expected.carry_share_avg_trend)
    assert completed.loc["player", "carry_share_avg_volatility"] == pytest.approx(expected.carry_share_avg_volatility)


def test_shared_input_revision_invalidates_weekly_dfs_draft_and_ros(monkeypatch, tmp_path):
    from src.draft_hub import draft_pool_cache
    from src.projections import dfs_pool, input_policy, ros_cache, weekly_cache

    for module in (draft_pool_cache, ros_cache, weekly_cache):
        monkeypatch.setattr(module, "MODEL_DIR", tmp_path)
        monkeypatch.setattr(module, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(input_policy, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(input_policy, "ROOKIE_ROLE_OVERRIDES_PATH", tmp_path / "overrides.yaml")
    monkeypatch.setattr(dfs_pool, "BUNDLE_PATH", tmp_path / "special.joblib")
    functions = [weekly_cache.weekly_fingerprint, dfs_pool.pool_fingerprint,
                 draft_pool_cache.pool_fingerprint, ros_cache.ros_fingerprint]
    current = [function() for function in functions]
    monkeypatch.setattr(input_policy, "PROJECTION_INPUT_POLICY", "completed_profiles_current_roles_exact_week_consensus_v2")
    previous = [function() for function in functions]
    assert all(new != old for new, old in zip(current, previous))
