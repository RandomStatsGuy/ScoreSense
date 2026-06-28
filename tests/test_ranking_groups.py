"""Tests for weekly slate grouping."""

import pandas as pd
import pytest

from src.ml.ranking_groups import (
    build_relevance_labels,
    build_weekly_groups,
    prepare_ranking_frame,
    sort_for_ranking,
    validate_groups,
)


def test_build_weekly_groups_contiguous_slates():
    df = pd.DataFrame(
        {
            "season": [2024, 2024, 2024, 2024],
            "week": [1, 1, 2, 2],
            "player_id": ["a", "b", "c", "d"],
            "Fpts": [10.0, 12.0, 8.0, 15.0],
        }
    )
    sorted_df = sort_for_ranking(df)
    groups = build_weekly_groups(sorted_df)
    validate_groups(sorted_df, groups)
    assert groups == [2, 2]


def test_prepare_ranking_frame_filters_regular_season():
    df = pd.DataFrame(
        {
            "season": [2024, 2024, 2024],
            "week": [1, 19, 1],
            "player_id": ["a", "b", "c"],
            "Fpts": [10.0, 20.0, 8.0],
        }
    )
    ranked_df, groups = prepare_ranking_frame(df)
    assert len(ranked_df) == 2
    assert sum(groups) == 2


def test_interleaved_slates_raise():
    df = pd.DataFrame(
        {
            "season": [2024, 2024, 2024],
            "week": [1, 2, 1],
            "player_id": ["a", "b", "c"],
            "Fpts": [10.0, 12.0, 8.0],
        }
    )
    with pytest.raises(ValueError, match="contiguous"):
        build_weekly_groups(df)


def test_fpts_tiers_ties_equal_fpts_within_slate():
    import numpy as np

    y = np.array([10.0, 10.0, 12.0, 12.0, 28.0, 30.0])
    groups = [6]
    labels = build_relevance_labels(y, groups, method="fpts_tiers", max_relevance=30)
    assert labels[0] == labels[1]
    assert labels[2] == labels[3]
    assert labels[-1] > labels[0]
