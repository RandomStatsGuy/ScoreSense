"""Choose ingestion years independently of frozen training/evaluation splits.

Only ETL/refresh jobs call this helper. The existing job calendar may refresh
its provider cache; failure falls back to the NFL season's calendar boundary.
Explicit historical ingestion requests bypass this default entirely.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from typing import Any

from src.config import DEFAULT_TEST_SEASONS, DEFAULT_TRAIN_SEASONS


def default_ingestion_seasons(*, now: datetime | None = None,
                              state_loader: Callable[[], dict[str, Any]] | None = None,
                              configured_seasons: Iterable[int] | None = None) -> list[int]:
    """Retain configured history and every year through the active NFL season.

    January/February still belong to the preceding NFL season. A stale provider
    snapshot cannot move the cutoff behind that calendar fallback, and a
    malformed/future snapshot cannot trigger unbounded future-year ingestion.
    Training and evaluation constants are never extended or modified.
    """
    configured = list(configured_seasons) if configured_seasons is not None else [*DEFAULT_TRAIN_SEASONS, *DEFAULT_TEST_SEASONS]
    if not configured or any(isinstance(year, bool) or not isinstance(year, int) or year < 1999 for year in configured):
        raise ValueError("Configured ingestion history requires integer seasons from 1999 onward")
    clock = now or datetime.now(timezone.utc)
    active = clock.year - 1 if clock.month <= 2 else clock.year
    if state_loader is None:
        from src.integrations.sleeper import get_nfl_state
        state_loader = lambda: get_nfl_state(allow_stale=False)
    try:
        state = state_loader()
        for field in ("season", "league_season"):
            raw = state.get(field)
            if isinstance(raw, bool) or not str(raw or "").isdigit():
                continue
            provider_year = int(raw)
            if clock.year - 1 <= provider_year <= clock.year:
                active = max(active, provider_year)
                break
    except Exception:
        # Calendar availability is optional for ingestion, unlike the source
        # statistics themselves. Never drop a year because this lookup failed.
        pass
    return list(range(min(configured), max(max(configured), active) + 1))
