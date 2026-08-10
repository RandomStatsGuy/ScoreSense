"""Projection meta flags align with dashboard season-mode defaults."""

from src.projections.projection_meta import get_projection_meta


def test_projection_meta_offseason_flags(monkeypatch):
    monkeypatch.setattr(
        "src.core.projection_context.get_nfl_state",
        lambda: {"season": 2026, "season_type": "off", "week": 1},
    )
    from src.projections import projection_meta as meta_mod

    meta_mod._META_CACHE.clear()
    meta = get_projection_meta("qb")
    assert meta["default_season"] >= 2025
    assert meta["is_offseason"] is True
    assert meta["preseason_mode"] is True
