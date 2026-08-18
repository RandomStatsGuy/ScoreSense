"""SCORE-50: floor ≤ projected ≤ ceiling after blend / overlay / vet-backup paths."""

from __future__ import annotations

import pandas as pd

from src.integrations.sleeper import apply_vet_backup_projection_scale
from src.ml.quantile import repair_projection_quantiles
from src.projections.injury_overlay import apply_overlay_to_quantiles
from src.projections.ros_projections import _apply_rolling_rate


def test_vet_backup_scales_weekly_tails_with_p50():
    """Weekly Low/High must scale with Projected Points (not leave P50 alone)."""
    result = pd.DataFrame(
        {
            "Player": ["Backup QB"],
            "Team": ["SF"],
            "Projected Points": [18.0],
            "Low (P10)": [10.0],
            "High (P90)": [26.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_display_name": ["Backup QB"],
            "team": ["SF"],
            "_vet_backup_mult": [0.4],
        }
    )
    scaled = apply_vet_backup_projection_scale(result, roster)
    assert scaled.loc[0, "Projected Points"] == 7.2
    assert scaled.loc[0, "Low (P10)"] == 4.0
    assert scaled.loc[0, "High (P90)"] == 10.4
    assert scaled.loc[0, "Low (P10)"] <= scaled.loc[0, "Projected Points"]
    assert scaled.loc[0, "Projected Points"] <= scaled.loc[0, "High (P90)"]


def test_vet_backup_scales_per_game_triplet():
    result = pd.DataFrame(
        {
            "Player": ["Backup QB"],
            "Team": ["SF"],
            "Per-Game Proj": [15.0],
            "Per-Game Floor": [8.0],
            "Per-Game Ceiling": [22.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_display_name": ["Backup QB"],
            "team": ["SF"],
            "_vet_backup_mult": [0.5],
        }
    )
    scaled = apply_vet_backup_projection_scale(result, roster)
    assert scaled.loc[0, "Per-Game Floor"] <= scaled.loc[0, "Per-Game Proj"]
    assert scaled.loc[0, "Per-Game Proj"] <= scaled.loc[0, "Per-Game Ceiling"]


def test_rolling_rate_shifts_tails_with_p50():
    weekly = pd.DataFrame(
        {
            "player_id": ["a"],
            "Projected Points": [10.0],
            "Low (P10)": [6.0],
            "High (P90)": [14.0],
        }
    )
    rolling = pd.DataFrame({"player_id": ["a"], "Projected Points": [16.0]})
    out = _apply_rolling_rate(weekly, rolling)
    assert out.loc[0, "Projected Points"] == 16.0
    assert out.loc[0, "Low (P10)"] == 12.0
    assert out.loc[0, "High (P90)"] == 20.0
    assert out.loc[0, "Low (P10)"] <= out.loc[0, "Projected Points"] <= out.loc[0, "High (P90)"]


def test_overlay_compose_keeps_quantile_order():
    """Overlay that lifts P50 above the raw ceiling must repair tails."""
    p10, p50, p90 = apply_overlay_to_quantiles(
        9.0,
        12.0,
        14.0,
        {"final_delta": 5.0},  # final P50 = 17 > raw P90 14
    )
    assert p50 == 17.0
    assert p10 <= p50 <= p90


def test_opportunity_scaled_frame_stays_ordered_after_repair():
    frame = pd.DataFrame(
        {
            "Projected Points": [20.0],
            "Low (P10)": [22.0],  # crossed before repair
            "High (P90)": [18.0],
        }
    )
    fixed = repair_projection_quantiles(frame)
    assert fixed.loc[0, "Projected Points"] == 20.0
    assert fixed.loc[0, "Low (P10)"] <= 20.0 <= fixed.loc[0, "High (P90)"]
