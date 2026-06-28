"""Simple in-memory rate limiting for auth email endpoints."""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import DefaultDict

_LOCK = threading.Lock()
_BUCKETS: DefaultDict[str, list[float]] = defaultdict(list)


def check_rate_limit(key: str, *, max_calls: int = 5, window_seconds: int = 3600) -> bool:
    """Return True if the request is allowed, False if rate limited."""
    now = time.monotonic()
    cutoff = now - window_seconds
    with _LOCK:
        hits = [t for t in _BUCKETS[key] if t > cutoff]
        if len(hits) >= max_calls:
            _BUCKETS[key] = hits
            return False
        hits.append(now)
        _BUCKETS[key] = hits
        return True


def reset_rate_limits() -> None:
    """Clear buckets (tests only)."""
    with _LOCK:
        _BUCKETS.clear()
