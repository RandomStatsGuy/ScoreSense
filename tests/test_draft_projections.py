"""Tests for fantasy draft season projections."""

import pandas as pd
import pytest

from src.projections.draft_projections import (
    _feature_season_for_draft,
    draft_projection_note,
    predict_draft_season,
)
from src.projections.season_quantiles import METHOD_INDEPENDENT_SCALE, METHOD_MC_SCHEDULE_V1


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


def test_draft_projection_note_legacy_still_flags_unadjusted():
    """Default (no method / legacy A-B flag) keeps the old disclosure."""
    note = draft_projection_note(2025, feature_season=2024, games_per_season=17)
    assert "Not schedule- or bye-adjusted." in note


def test_draft_projection_note_mc_schedule_v1_describes_calibrated_bands():
    note = draft_projection_note(
        2025, feature_season=2024, games_per_season=17, season_quantile_method=METHOD_MC_SCHEDULE_V1
    )
    assert "Not schedule- or bye-adjusted." not in note
    assert "schedule- and bye-adjusted" in note


@pytest.mark.parametrize("position", ["qb"])
def test_predict_draft_season_season_quantiles_live(position):
    """SCORE-2: Season P10/P50/P90 (Floor/Ceiling) come from the MC aggregator by default."""
    draft = predict_draft_season(position, season=2026)
    for col in (
        "Season P10",
        "Season P50",
        "Season P90",
        "Season Spread",
        "games_expected",
        "season_quantile_method",
        "Season Floor",
        "Season Ceiling",
    ):
        assert col in draft.columns

    assert (draft["season_quantile_method"] == METHOD_MC_SCHEDULE_V1).all()
    assert draft.attrs.get("season_quantile_method") == METHOD_MC_SCHEDULE_V1
    assert isinstance(draft.attrs.get("season_coverage_meta"), dict)

    # Floor <= Proj <= Ceiling must hold as a UX/consumer contract even though the
    # simulation's raw median can drift from the (blended) point estimate for
    # boom/bust roles -- see predict_draft_season's shift-correction.
    assert (draft["Season Floor"] <= draft["Season Proj"] + 1e-6).all()
    assert (draft["Season Proj"] <= draft["Season Ceiling"] + 1e-6).all()
    assert (draft["Season Floor"] == draft["Season P10"]).all()
    assert (draft["Season Ceiling"] == draft["Season P90"]).all()
    assert (draft["games_expected"] >= 0).all()

    # No longer the naive weekly-quantile x 17 scale.
    naive_floor = (draft["Per-Game Floor"] * 17).round(1)
    assert not (draft["Season Floor"] == naive_floor).all()


def test_predict_draft_season_legacy_method_matches_naive_scale(monkeypatch):
    import src.projections.draft_projections as draft_projections_mod

    monkeypatch.setattr(draft_projections_mod, "SEASON_QUANTILE_METHOD", METHOD_INDEPENDENT_SCALE)
    draft = predict_draft_season("qb", season=2026)
    assert (draft["season_quantile_method"] == METHOD_INDEPENDENT_SCALE).all()
    # Legacy still uses weekly×games (not MC), but on blend-centered quantiles
    # with Season P50 forced to Season Proj so the displayed band brackets the
    # headline used for sorting/bids (same contract as the MC path).
    assert (draft["Season P50"] - draft["Season Proj"]).abs().max() < 0.15
    assert (draft["Season Floor"] <= draft["Season Proj"] + 1e-6).all()
    assert (draft["Season Proj"] <= draft["Season Ceiling"] + 1e-6).all()
    assert (draft["Season Floor"] == draft["Season P10"]).all()
    assert (draft["Season Ceiling"] == draft["Season P90"]).all()
