"""Bounded, process-local scoring timings; no league or player data is recorded."""
from collections import deque
from functools import wraps
from threading import Lock
import math
import time

_LOCK = Lock()
_ROWS = {}


def record(name, seconds):
    with _LOCK:
        row = _ROWS.setdefault(name, {"count": 0, "total_ms": 0.0, "samples": deque(maxlen=200)})
        elapsed = seconds * 1000
        row["count"] += 1
        row["total_ms"] += elapsed
        row["samples"].append(elapsed)


def profile_scoring(name, *, cache_result=False):
    def decorate(func):
        @wraps(func)
        def measured(*args, **kwargs):
            started = time.perf_counter()
            outcome = "error"
            try:
                result = func(*args, **kwargs)
                if cache_result:
                    outcome = "hit" if result.get("cached") else "refresh" if result.get("available") else "unavailable"
                return result
            finally:
                record(f"{name}.{outcome}" if cache_result else name, time.perf_counter() - started)
        return measured
    return decorate


def snapshot():
    with _LOCK:
        rows = []
        for name, row in sorted(_ROWS.items()):
            samples = sorted(row["samples"])
            rows.append({"operation": name, "count": row["count"], "sample_count": len(samples),
                         "total_ms": round(row["total_ms"], 1),
                         "p50_ms": round(samples[(len(samples) - 1) // 2], 1),
                         "p95_ms": round(samples[math.ceil(len(samples) * .95) - 1], 1)})
        return {"scope": "process_lifetime", "operations": rows}
