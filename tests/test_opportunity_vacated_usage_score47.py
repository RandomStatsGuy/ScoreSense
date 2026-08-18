"""SCORE-47: off-roster / backup injuries must not invent vacated usage."""

from __future__ import annotations

import pandas as pd
import pytest

from src.core.opportunity import compute_vacated_usage


def _inj(
    full_name: str,
    team: str,
    position: str,
    status: str,
) -> dict:
    return {
        "full_name": full_name,
        "team": team,
        "position": position,
        "injury_status": status,
    }


def test_questionable_backup_qb_brosmer_does_not_boost_murray():
    """ARI: Max Brosmer Q, not on one-QB slate → Kyler Murray stays flat."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Kyler Murray",
                "team": "ARI",
                "position": "QB",
                "target_share_avg": 0.02,
            }
        ]
    )
    injured = pd.DataFrame(
        [_inj("Max Brosmer", "ARI", "QB", "Questionable")]
    )

    out = compute_vacated_usage(roster, injured_df=injured)
    murray = out[out["player_display_name"] == "Kyler Murray"].iloc[0]
    assert murray["injury_opportunity_boost"] == 0.0
    assert murray["injury_note"] == ""


def test_questionable_backup_qb_trubisky_does_not_boost_ward():
    """TEN: Mitchell Trubisky Q, not on slate → Cam Ward stays flat."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Cam Ward",
                "team": "TEN",
                "position": "QB",
                "target_share_avg": 0.01,
            }
        ]
    )
    injured = pd.DataFrame(
        [_inj("Mitchell Trubisky", "TEN", "QB", "Questionable")]
    )

    out = compute_vacated_usage(roster, injured_df=injured)
    ward = out[out["player_display_name"] == "Cam Ward"].iloc[0]
    assert ward["injury_opportunity_boost"] == 0.0
    assert ward["injury_note"] == ""


def test_off_roster_injured_player_never_gets_default_share():
    """Regression: former DEFAULT 0.08 share must not apply when absent."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Starter QB",
                "team": "XYZ",
                "position": "QB",
                "target_share_avg": 0.05,
            }
        ]
    )
    # Out status (weight 1.0) would have produced 0.08 vacated share pre-fix.
    injured = pd.DataFrame([_inj("Ghost Backup", "XYZ", "QB", "Out")])

    out = compute_vacated_usage(roster, injured_df=injured)
    assert float(out["injury_opportunity_boost"].sum()) == 0.0
    assert list(out["injury_note"]) == [""]


def test_on_roster_wr_injury_still_vacates_usage_to_teammate():
    """Real starter injury with projected target share still moves teammates."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Ja'Marr Chase",
                "team": "CIN",
                "position": "WR",
                "target_share_avg": 0.28,
            },
            {
                "player_display_name": "Tee Higgins",
                "team": "CIN",
                "position": "WR",
                "target_share_avg": 0.22,
            },
        ]
    )
    injured = pd.DataFrame(
        [_inj("Ja'Marr Chase", "CIN", "WR", "Out")]
    )

    out = compute_vacated_usage(roster, injured_df=injured)
    chase = out[out["player_display_name"] == "Ja'Marr Chase"].iloc[0]
    higgins = out[out["player_display_name"] == "Tee Higgins"].iloc[0]

    assert chase["injury_opportunity_boost"] == 0.0
    assert higgins["injury_opportunity_boost"] == pytest.approx(0.28)  # Out weight 1.0
    assert "Ja'Marr Chase (Out)" in higgins["injury_note"]
    assert "Ghost" not in higgins["injury_note"]


def test_questionable_on_roster_rb_still_applies_weighted_share():
    """On-roster Questionable RB with carry share still vacates (weight 0.35)."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Isiah Pacheco",
                "team": "KC",
                "position": "RB",
                "target_share_avg": 0.18,
            },
            {
                "player_display_name": "Kareem Hunt",
                "team": "KC",
                "position": "RB",
                "target_share_avg": 0.12,
            },
        ]
    )
    injured = pd.DataFrame(
        [_inj("Isiah Pacheco", "KC", "RB", "Questionable")]
    )

    out = compute_vacated_usage(roster, injured_df=injured)
    hunt = out[out["player_display_name"] == "Kareem Hunt"].iloc[0]
    expected = 0.18 * 0.35  # sole beneficiary
    assert hunt["injury_opportunity_boost"] == pytest.approx(expected)
    assert "Isiah Pacheco (Questionable)" in hunt["injury_note"]


def test_mixed_off_roster_backup_and_on_roster_starter_only_counts_starter():
    """Backup off-roster Q must not appear in notes when a real WR vacates."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Star WR",
                "team": "SEA",
                "position": "WR",
                "target_share_avg": 0.25,
            },
            {
                "player_display_name": "Other WR",
                "team": "SEA",
                "position": "WR",
                "target_share_avg": 0.15,
            },
        ]
    )
    injured = pd.DataFrame(
        [
            _inj("Star WR", "SEA", "WR", "Doubtful"),
            _inj("Backup QB", "SEA", "QB", "Questionable"),
        ]
    )

    out = compute_vacated_usage(roster, injured_df=injured)
    other = out[out["player_display_name"] == "Other WR"].iloc[0]
    assert other["injury_opportunity_boost"] == pytest.approx(0.25 * 0.75)
    assert other["injury_note"] == "Star WR (Doubtful)"
    assert "Backup QB" not in other["injury_note"]
