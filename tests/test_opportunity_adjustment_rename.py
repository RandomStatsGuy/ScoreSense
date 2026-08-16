"""SCORE-26: Injury Boost → Opportunity Adjustment (backend read-model)."""

from __future__ import annotations

import pandas as pd

from src.core.opportunity import (
    OPPORTUNITY_ADJUSTMENT_COL,
    OPPORTUNITY_ADJUSTMENT_LEGACY_COL,
    attach_opportunity_adjustment,
    ensure_opportunity_adjustment_columns,
    pick_opportunity_adjustment,
)


def test_attach_writes_canonical_and_legacy_alias():
    frame = pd.DataFrame({"Player": ["A", "B"]})
    attach_opportunity_adjustment(frame, pd.Series([0.1, 0.0]))
    assert list(frame[OPPORTUNITY_ADJUSTMENT_COL]) == [0.1, 0.0]
    assert list(frame[OPPORTUNITY_ADJUSTMENT_LEGACY_COL]) == [0.1, 0.0]


def test_ensure_backfills_canonical_from_legacy_artifact_column():
    legacy = pd.DataFrame(
        {
            "Player": ["Tee Higgins"],
            "Injury Boost": [0.15],
        }
    )
    out = ensure_opportunity_adjustment_columns(legacy)
    assert out[OPPORTUNITY_ADJUSTMENT_COL].iloc[0] == 0.15
    assert out[OPPORTUNITY_ADJUSTMENT_LEGACY_COL].iloc[0] == 0.15


def test_pick_prefers_canonical_over_legacy():
    row = {
        "Opportunity Adjustment": 0.2,
        "Injury Boost": 0.05,
    }
    assert pick_opportunity_adjustment(row) == 0.2


def test_pick_reads_snake_case_and_legacy_keys():
    assert pick_opportunity_adjustment({"opportunity_adjustment": 0.11}) == 0.11
    assert pick_opportunity_adjustment({"injury_boost": 0.09}) == 0.09
    assert pick_opportunity_adjustment({}) is None
