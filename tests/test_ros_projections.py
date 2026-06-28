"""Tests for rest-of-season projections."""

import pandas as pd

from src.projections.ros_projections import _weeks_remaining


def test_weeks_remaining_midseason():
    assert _weeks_remaining(10) == 9
    assert _weeks_remaining(18) == 1
    assert _weeks_remaining(19) == 0
