"""SCORE-47: off-roster / backup injuries must not invent vacated usage."""

from __future__ import annotations

import pandas as pd
import pytest

from src.core.opportunity import compute_vacated_usage, skill_opportunity_group


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


def test_skill_opportunity_group_allowlist():
    assert skill_opportunity_group("RB") == "rb"
    assert skill_opportunity_group("fb") == "rb"
    assert skill_opportunity_group("WR") == "pass"
    assert skill_opportunity_group("TE") == "pass"
    assert skill_opportunity_group("QB") == "qb"
    for pos in ("CB", "DB", "DT", "DE", "LB", "S", "K", "P", "OL", "OT", "LS"):
        assert skill_opportunity_group(pos) is None


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


def test_defensive_teammates_do_not_boost_rb_sampson_style():
    """CLE: Questionable CB/DT/DB must not raise Dylan Sampson (or appear in notes)."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Dylan Sampson",
                "team": "CLE",
                "position": "RB",
                "target_share_avg": 0.08,
                "carry_share_avg": 0.42,
            },
            {
                "player_display_name": "Jerry Jeudy",
                "team": "CLE",
                "position": "WR",
                "target_share_avg": 0.24,
                "carry_share_avg": 0.0,
            },
        ]
    )
    injured = pd.DataFrame(
        [
            _inj("Denzel Ward", "CLE", "CB", "Questionable"),
            _inj("Dom Jones", "CLE", "DB", "Questionable"),
            _inj("Mason Graham", "CLE", "DT", "Questionable"),
        ]
    )

    out = compute_vacated_usage(roster, injured_df=injured)
    sampson = out[out["player_display_name"] == "Dylan Sampson"].iloc[0]
    jeudy = out[out["player_display_name"] == "Jerry Jeudy"].iloc[0]
    assert sampson["injury_opportunity_boost"] == 0.0
    assert jeudy["injury_opportunity_boost"] == 0.0
    assert sampson["injury_note"] == ""
    assert "Denzel Ward" not in str(sampson["injury_note"])
    assert "Mason Graham" not in str(jeudy["injury_note"])


def test_on_roster_defensive_player_with_share_still_does_not_vacate():
    """Even if a CB leaked onto the feature roster with a usage share, skip them."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Dylan Sampson",
                "team": "CLE",
                "position": "RB",
                "target_share_avg": 0.10,
                "carry_share_avg": 0.40,
            },
            {
                "player_display_name": "Denzel Ward",
                "team": "CLE",
                "position": "CB",
                "target_share_avg": 0.50,
                "carry_share_avg": 0.50,
            },
        ]
    )
    injured = pd.DataFrame([_inj("Denzel Ward", "CLE", "CB", "Out")])

    out = compute_vacated_usage(roster, injured_df=injured)
    sampson = out[out["player_display_name"] == "Dylan Sampson"].iloc[0]
    assert sampson["injury_opportunity_boost"] == 0.0
    assert sampson["injury_note"] == ""


def test_wr_injury_does_not_splash_onto_rb_on_mixed_roster():
    """Vacated WR targets stay in the pass-catcher group, not RB carries."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Ja'Marr Chase",
                "team": "CIN",
                "position": "WR",
                "target_share_avg": 0.28,
                "carry_share_avg": 0.0,
            },
            {
                "player_display_name": "Tee Higgins",
                "team": "CIN",
                "position": "WR",
                "target_share_avg": 0.22,
                "carry_share_avg": 0.0,
            },
            {
                "player_display_name": "Chase Brown",
                "team": "CIN",
                "position": "RB",
                "target_share_avg": 0.08,
                "carry_share_avg": 0.55,
            },
        ]
    )
    injured = pd.DataFrame([_inj("Ja'Marr Chase", "CIN", "WR", "Out")])

    out = compute_vacated_usage(roster, injured_df=injured)
    higgins = out[out["player_display_name"] == "Tee Higgins"].iloc[0]
    brown = out[out["player_display_name"] == "Chase Brown"].iloc[0]
    assert higgins["injury_opportunity_boost"] == pytest.approx(0.28)
    assert brown["injury_opportunity_boost"] == 0.0
    assert "Ja'Marr Chase (Out)" in higgins["injury_note"]
    assert brown["injury_note"] == ""


def test_rb_injury_still_boosts_backups_when_defense_also_injured():
    """Real RB vacancy still applies; defensive Qs are omitted from notes."""
    roster = pd.DataFrame(
        [
            {
                "player_display_name": "Nick Chubb",
                "team": "CLE",
                "position": "RB",
                "target_share_avg": 0.06,
                "carry_share_avg": 0.55,
            },
            {
                "player_display_name": "Dylan Sampson",
                "team": "CLE",
                "position": "RB",
                "target_share_avg": 0.05,
                "carry_share_avg": 0.25,
            },
        ]
    )
    injured = pd.DataFrame(
        [
            _inj("Nick Chubb", "CLE", "RB", "Out"),
            _inj("Denzel Ward", "CLE", "CB", "Questionable"),
            _inj("Mason Graham", "CLE", "DT", "Questionable"),
        ]
    )

    out = compute_vacated_usage(roster, injured_df=injured)
    sampson = out[out["player_display_name"] == "Dylan Sampson"].iloc[0]
    assert sampson["injury_opportunity_boost"] == pytest.approx(0.55)
    assert sampson["injury_note"] == "Nick Chubb (Out)"
    assert "Denzel Ward" not in sampson["injury_note"]
    assert "Mason Graham" not in sampson["injury_note"]


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
