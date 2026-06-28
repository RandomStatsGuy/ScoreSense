"""Tests for fantasy draft season projections."""

import pandas as pd

from src.projections.draft_projections import _feature_season_for_draft, draft_projection_note


def test_feature_season_uses_latest_available_prior_year():
    df = pd.DataFrame(
        {
            "season": [2024] * 18,
            "week": list(range(1, 19)),
            "player_id": ["p1"] * 18,
        }
    )
    assert _feature_season_for_draft(df, season=2026, target_week=1) == 2024


def test_draft_projection_note_prior_year():
    note = draft_projection_note(2025, feature_season=2024, games_per_season=17)
    assert "17 games" in note
    assert "2024 stats" in note
