"""Read consumers share defaults without overriding an explicitly selected period."""
import pytest
from src.projections import projection_meta as meta


def test_explicit_period_does_not_require_training_files_or_calendar(monkeypatch):
    monkeypatch.setattr(meta, "get_projection_meta", lambda *_: pytest.fail("Explicit context must not scan data"))
    assert meta.resolve_projection_read_context(2025, 6) == (2025, 6)


@pytest.mark.parametrize("season,week,expected", [(None, None, (2026, 7)), (None, 4, (2026, 4)),
    (2026, None, (2026, 7)), (2025, None, (2025, 18)), (2027, None, (2027, 1))])
def test_partial_context_preserves_requested_dimension(monkeypatch, season, week, expected):
    monkeypatch.setattr(meta, "get_projection_meta", lambda *_: {
        "default_season": 2026, "default_week": 7, "weeks_by_season": {"2025": [1, 18, 19], "2026": [1, 2, 3, 4]}})
    assert meta.resolve_projection_read_context(season, week) == expected
