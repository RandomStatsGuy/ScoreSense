"""In-memory API timings and recent server errors for the admin Server tab.

Pure ASGI so streaming responses are untouched. Keys are route templates
(``/api/hub/league/{league_id}``), never raw paths, so ids and query strings
are not retained. Errors keep the exception type only — no messages.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from time import perf_counter

_MAX_ROUTES = 400
_SAMPLES_PER_ROUTE = 200
_MAX_ERRORS = 100

_lock = threading.Lock()
_routes: dict[str, dict] = {}
_errors: deque = deque(maxlen=_MAX_ERRORS)
_started_at = time.time()


def _route_key(scope) -> str | None:
    route = scope.get("route")
    path = getattr(route, "path", None) or getattr(route, "path_format", None)
    if path:
        return f"{scope.get('method', 'GET')} {path}"
    return None


def record(key: str | None, status: int, elapsed_ms: float, error_type: str | None = None) -> None:
    now = time.time()
    with _lock:
        if key:
            entry = _routes.get(key)
            if entry is None:
                if len(_routes) >= _MAX_ROUTES:
                    return
                entry = _routes[key] = {"count": 0, "errors": 0, "samples": deque(maxlen=_SAMPLES_PER_ROUTE)}
            entry["count"] += 1
            entry["samples"].append(elapsed_ms)
            if status >= 500:
                entry["errors"] += 1
        if status >= 500:
            _errors.appendleft({"at": now, "route": key or "unmatched", "status": status, "error_type": error_type})


def _percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def snapshot(*, slowest: int = 8, errors: int = 20) -> dict:
    with _lock:
        rows = [
            {
                "route": key,
                "count": entry["count"],
                "errors": entry["errors"],
                "p50_ms": round(_percentile(list(entry["samples"]), 0.5), 1),
                "p95_ms": round(_percentile(list(entry["samples"]), 0.95), 1),
            }
            for key, entry in _routes.items()
            if entry["samples"]
        ]
        recent = list(_errors)[:errors]
        total = sum(entry["count"] for entry in _routes.values())
        failed = sum(entry["errors"] for entry in _routes.values())
    rows.sort(key=lambda row: row["p95_ms"], reverse=True)
    return {
        "since": _started_at,
        "requests": total,
        "server_errors": failed,
        "slowest": rows[:slowest],
        "recent_errors": recent,
    }


def reset() -> None:
    global _started_at
    with _lock:
        _routes.clear()
        _errors.clear()
        _started_at = time.time()


class RequestStatsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            return await self.app(scope, receive, send)
        started = perf_counter()
        status_holder = {"status": 500}

        async def tracking_send(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = int(message.get("status", 500))
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as exc:
            record(_route_key(scope), 500, (perf_counter() - started) * 1000, type(exc).__name__)
            raise
        record(_route_key(scope), status_holder["status"], (perf_counter() - started) * 1000)
