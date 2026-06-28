"""Optional per-route timing for Draft Hub hot paths (HUB_TIMING=true)."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Any, Generator

from src.config import HUB_TIMING

logger = logging.getLogger(__name__)

_LOG_THRESHOLD_MS = 500.0


class HubTimer:
    """Record phase timings; log slow requests and set X-Hub-Timing-MS."""

    def __init__(self, route: str, response: Any | None = None) -> None:
        self.route = route
        self.response = response
        self.phases: dict[str, float] = {}
        self._start = 0.0

    def __enter__(self) -> HubTimer:
        if HUB_TIMING:
            self._start = time.perf_counter()
        return self

    def __exit__(self, *_args: object) -> None:
        if not HUB_TIMING:
            return
        total_ms = (time.perf_counter() - self._start) * 1000
        if self.response is not None:
            self.response.headers["X-Hub-Timing-MS"] = f"{total_ms:.0f}"
        if total_ms >= _LOG_THRESHOLD_MS:
            logger.info(
                "hub_timing route=%s total_ms=%.0f phases=%s",
                self.route,
                total_ms,
                self.phases,
            )

    @contextmanager
    def phase(self, name: str) -> Generator[None, None, None]:
        if not HUB_TIMING:
            yield
            return
        t0 = time.perf_counter()
        try:
            yield
        finally:
            self.phases[name] = round((time.perf_counter() - t0) * 1000, 1)
