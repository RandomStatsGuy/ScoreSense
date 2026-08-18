"""Injury return estimate heuristics."""

from src.integrations.injury_timeline import estimate_injury_return


def test_acl_surgery_ir_returns_long_window():
    est = estimate_injury_return("IR", "Knee - ACL", "Surgery")
    assert "Season" in est.label or est.weeks_min >= 8
    assert est.confidence in ("medium", "low", "high")


def test_questionable_acl_does_not_show_season_window():
    """Q means the player may play this week — do not advertise a season-ending ETA."""
    est = estimate_injury_return("Questionable", "Knee - ACL", "Torn ACL")
    assert "Season" not in est.label
    assert est.weeks_max is not None
    assert est.weeks_max <= 1


def test_questionable_foot_soreness_stays_game_time():
    est = estimate_injury_return("Questionable", "Foot", "Soreness")
    assert est.label == "Game-time decision"
    assert est.weeks_max is not None
    assert est.weeks_max <= 1


def test_questionable_dnp_practice_still_extends_window():
    est = estimate_injury_return(
        "Questionable",
        "Knee",
        "",
        practice_participation="Did Not Participate",
    )
    assert est.label == "1-2 weeks"
    assert est.weeks_max == 2


def test_questionable_hamstring_sprain_short_window():
    est = estimate_injury_return("Questionable", "Hamstring", "Sprain")
    assert est.weeks_max is not None
    assert est.weeks_max <= 3


def test_out_this_week():
    est = estimate_injury_return("Out", "Ankle", "")
    assert est.label == "Out this week"
    assert est.weeks_min == 1


def test_bucky_irving_pattern():
    est = estimate_injury_return("Questionable", "Shoulder", "Surgery")
    assert est.label
    assert est.is_estimate is True
