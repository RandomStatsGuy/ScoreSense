"""Injury return estimate heuristics."""

from src.integrations.injury_timeline import estimate_injury_return


def test_acl_surgery_ir_returns_long_window():
    est = estimate_injury_return("IR", "Knee - ACL", "Surgery")
    assert "Season" in est.label or est.weeks_min >= 8
    assert est.confidence in ("medium", "low", "high")


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
