"""Projection meta flags align with dashboard season-mode defaults."""

from src.projections.projection_meta import get_projection_meta


def test_projection_meta_offseason_flags():
    meta = get_projection_meta("qb")
    assert meta["default_season"] >= 2025
    assert meta["is_offseason"] is True
    assert meta["preseason_mode"] is True
