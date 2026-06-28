"""Draft timer and pick value grading."""

from src.draft_hub.draft_state import _pick_value_blurb, _pick_value_grade


def test_pick_value_grade_steal():
    assert _pick_value_grade(10.0, 20.0) == "steal"


def test_pick_value_grade_reach():
    assert _pick_value_grade(30.0, 20.0) == "reach"


def test_pick_value_blurb_includes_ppg():
    text = _pick_value_blurb("great_value", amount=18.0, fair_value=24.0, per_game=14.2)
    assert "Great value" in text
    assert "14.2 PPG" in text
    assert "$18 spent" in text
