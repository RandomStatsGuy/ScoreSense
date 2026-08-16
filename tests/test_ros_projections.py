"""Tests for SCORE-32 ROS near-term / decaying opportunity adjustments."""

from __future__ import annotations

import pandas as pd
import pytest

from src.core.opportunity import (
    DEFAULT_ROS_OPPORTUNITY_HORIZON_WEEKS,
    effective_ros_opportunity_weeks,
    parse_injury_note_statuses,
    ros_opportunity_decay_factors,
    ros_opportunity_horizon_weeks,
)
from src.projections.ros_projections import (
    _scale_ros_with_opportunity_decay,
    _weeks_remaining,
)


def test_weeks_remaining_midseason():
    assert _weeks_remaining(10) == 9
    assert _weeks_remaining(18) == 1
    assert _weeks_remaining(19) == 0


def test_parse_injury_note_statuses():
    assert parse_injury_note_statuses("Ja'Marr Chase (Questionable)") == ["Questionable"]
    assert parse_injury_note_statuses(
        "Ja'Marr Chase (Questionable); Joe Mixon (Out)"
    ) == ["Questionable", "Out"]
    assert parse_injury_note_statuses("") == []
    assert parse_injury_note_statuses(None) == []


def test_ros_opportunity_horizon_questionable_is_one_week():
    assert ros_opportunity_horizon_weeks(["Questionable"]) == 1
    assert ros_opportunity_horizon_weeks(injury_note="Star WR (Questionable)") == 1
    assert ros_opportunity_horizon_weeks(["Doubtful"]) == 2
    assert ros_opportunity_horizon_weeks(["IR"]) == 6
    # Mixed drivers → max horizon
    assert ros_opportunity_horizon_weeks(["Questionable", "Out"]) == 1
    assert ros_opportunity_horizon_weeks(["Questionable", "IR"]) == 6


def test_ros_opportunity_horizon_default_when_boost_without_status():
    assert ros_opportunity_horizon_weeks(has_opportunity=True) == DEFAULT_ROS_OPPORTUNITY_HORIZON_WEEKS
    assert ros_opportunity_horizon_weeks(has_opportunity=False) == 0


def test_questionable_decay_factors_are_near_term_only():
    factors = ros_opportunity_decay_factors(1, weeks_remaining=10)
    assert factors[0] == pytest.approx(1.0)
    assert all(f == 0.0 for f in factors[1:])
    assert effective_ros_opportunity_weeks(1, 10) == pytest.approx(1.0)


def test_doubtful_linear_decay():
    factors = ros_opportunity_decay_factors(2, weeks_remaining=5)
    assert factors == pytest.approx([1.0, 0.5, 0.0, 0.0, 0.0])
    assert effective_ros_opportunity_weeks(2, 5) == pytest.approx(1.5)


def test_scale_ros_questionable_does_not_multiply_full_remaining():
    """Regression: Questionable opportunity must not scale by all weeks remaining."""
    frame = pd.DataFrame(
        {
            "Player": ["Beneficiary"],
            "player_id": ["p1"],
            "Projected Points": [12.0],  # injury-on weekly (includes opp)
            "Low (P10)": [9.0],
            "High (P90)": [15.0],
            "base_p50": [10.0],  # no-injury weekly
            "base_p10": [7.5],
            "base_p90": [12.5],
            "weeks_remaining": [10],
            "Injury Note": "Star WR (Questionable)",
        }
    )
    out = _scale_ros_with_opportunity_decay(frame)
    # Opportunity delta = 2.0 pts/week; Questionable horizon → 1 effective week
    assert out.loc[0, "ros_proj"] == pytest.approx(10.0 * 10 + 2.0 * 1.0)
    assert out.loc[0, "ros_proj"] == pytest.approx(102.0)
    # Old buggy behavior would have been 12 * 10 = 120
    assert out.loc[0, "ros_proj"] < 120.0
    assert out.loc[0, "ros_low"] == pytest.approx(7.5 * 10 + 1.5 * 1.0)
    assert out.loc[0, "ros_high"] == pytest.approx(12.5 * 10 + 2.5 * 1.0)


def test_scale_ros_no_opportunity_matches_baseline():
    frame = pd.DataFrame(
        {
            "Player": ["Steady"],
            "player_id": ["p2"],
            "Projected Points": [8.0],
            "Low (P10)": [6.0],
            "High (P90)": [10.0],
            "base_p50": [8.0],
            "base_p10": [6.0],
            "base_p90": [10.0],
            "weeks_remaining": [8],
            "Injury Note": "",
        }
    )
    out = _scale_ros_with_opportunity_decay(frame)
    assert out.loc[0, "ros_proj"] == pytest.approx(64.0)
    assert out.loc[0, "ros_low"] == pytest.approx(48.0)
    assert out.loc[0, "ros_high"] == pytest.approx(80.0)


def test_scale_ros_ir_horizon_credits_more_than_questionable():
    shared = {
        "Player": ["Beneficiary"],
        "player_id": ["p1"],
        "Projected Points": [12.0],
        "Low (P10)": [9.0],
        "High (P90)": [15.0],
        "base_p50": [10.0],
        "base_p10": [7.5],
        "base_p90": [12.5],
        "weeks_remaining": [10],
    }
    q = _scale_ros_with_opportunity_decay(
        pd.DataFrame({**shared, "Injury Note": "Star (Questionable)"})
    )
    ir = _scale_ros_with_opportunity_decay(
        pd.DataFrame({**shared, "Injury Note": "Star (IR)"})
    )
    assert ir.loc[0, "ros_proj"] > q.loc[0, "ros_proj"]
    # IR horizon 6 → sum(1, 5/6, ..., 1/6) = 21/6 = 3.5 effective weeks
    assert ir.loc[0, "ros_proj"] == pytest.approx(10.0 * 10 + 2.0 * 3.5)
