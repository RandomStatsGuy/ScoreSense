"""Request timings stop at delivery, while background failures stay separate."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient

from app import request_stats


@pytest.fixture(autouse=True)
def clean_request_stats():
    request_stats.reset()
    yield
    request_stats.reset()


@pytest.fixture
def clock(monkeypatch):
    clock = SimpleNamespace(seconds=0.0)
    monkeypatch.setattr(request_stats, "perf_counter", lambda: clock.seconds)
    return clock


@pytest.mark.parametrize("background_fails", [False, True])
def test_background_work_does_not_extend_response_timing(clock, background_fails):
    app = FastAPI()
    app.add_middleware(request_stats.RequestStatsMiddleware)
    observed = []

    def refresh():
        # A completed response must already be visible while refresh is running.
        observed.append(request_stats.snapshot())
        clock.seconds += 63.5
        if background_fails:
            raise RuntimeError("private refresh detail")

    @app.get("/api/injuries")
    def injuries(background_tasks: BackgroundTasks):
        clock.seconds += 0.025
        background_tasks.add_task(refresh)
        return {"players": []}

    response = TestClient(app, raise_server_exceptions=False).get("/api/injuries")
    assert response.status_code == 200
    assert response.json() == {"players": []}
    assert observed[0]["requests"] == 1
    assert observed[0]["slowest"][0]["p95_ms"] == 25.0
    snapshot = request_stats.snapshot()
    assert snapshot["requests"] == 1
    assert snapshot["server_errors"] == 0
    assert snapshot["recent_errors"] == []
    assert snapshot["slowest"][0]["p50_ms"] == 25.0
    assert snapshot["timing_scope"] == "response_complete"
    failures = snapshot["recent_post_response_errors"]
    assert len(failures) == int(background_fails)
    if background_fails:
        assert failures[0]["route"] == "GET /api/injuries"
        assert failures[0]["status"] == 200
        assert failures[0]["error_type"] == "RuntimeError"
    assert "private" not in str(snapshot)


def run_asgi(app, clock, *, path="/api/stream", scope_type="http"):
    messages = []

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        # Sending a chunk can itself take time; include that in delivery timing.
        clock.seconds += 0.005
        messages.append(message)

    scope = {"type": scope_type, "path": path, "method": "GET",
             "route": SimpleNamespace(path="/api/stream")}

    async def invoke():
        await request_stats.RequestStatsMiddleware(app)(scope, receive, send)

    return invoke, messages


@pytest.mark.parametrize("status", [200, 503])
def test_streaming_waits_for_last_chunk_and_preserves_messages(clock, status):
    expected = [
        {"type": "http.response.start", "status": status, "headers": [(b"x-test", b"yes")]},
        {"type": "http.response.body", "body": b"first", "more_body": True},
        {"type": "http.response.body", "body": b"last"},
    ]

    async def app(scope, receive, send):
        await send(expected[0])
        await send(expected[1])
        assert request_stats.snapshot()["requests"] == 0
        clock.seconds += 0.040
        await send(expected[2])
        assert request_stats.snapshot()["requests"] == 1
        clock.seconds += 60

    invoke, messages = run_asgi(app, clock)
    asyncio.run(invoke())
    assert messages == expected
    snapshot = request_stats.snapshot()
    assert snapshot["requests"] == 1
    assert snapshot["server_errors"] == int(status == 503)
    assert snapshot["slowest"][0]["p95_ms"] == 55.0
    assert len(snapshot["recent_errors"]) == int(status == 503)


@pytest.mark.parametrize("sent_partial_body", [False, True])
def test_failure_before_response_completion_is_counted_once(clock, sent_partial_body):
    async def app(scope, receive, send):
        clock.seconds += 0.010
        if sent_partial_body:
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": b"partial", "more_body": True})
        raise ValueError("private response detail")

    invoke, _ = run_asgi(app, clock)
    with pytest.raises(ValueError, match="private response detail"):
        asyncio.run(invoke())
    snapshot = request_stats.snapshot()
    assert snapshot["requests"] == 1
    assert snapshot["server_errors"] == 1
    assert snapshot["recent_errors"][0]["error_type"] == "ValueError"
    assert snapshot["recent_post_response_errors"] == []
    assert "private" not in str(snapshot)


def test_trailers_are_included_in_response_delivery(clock):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "trailers": True})
        await send({"type": "http.response.body", "body": b"body"})
        assert request_stats.snapshot()["requests"] == 0
        clock.seconds += 0.030
        await send({"type": "http.response.trailers", "headers": [], "more_trailers": True})
        assert request_stats.snapshot()["requests"] == 0
        await send({"type": "http.response.trailers", "headers": []})
        clock.seconds += 60

    invoke, _ = run_asgi(app, clock)
    asyncio.run(invoke())
    assert request_stats.snapshot()["slowest"][0]["p95_ms"] == 50.0


def test_file_path_response_excludes_background_work(clock):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200})
        await send({"type": "http.response.pathsend", "path": "/private/file"})
        clock.seconds += 60

    invoke, _ = run_asgi(app, clock)
    asyncio.run(invoke())
    snapshot = request_stats.snapshot()
    assert snapshot["slowest"][0]["p95_ms"] == 10.0
    assert "private" not in str(snapshot)


@pytest.mark.parametrize("path,scope_type", [("/assets/app.js", "http"), ("/api/stream", "websocket")])
def test_other_traffic_is_not_recorded(clock, path, scope_type):
    async def app(scope, receive, send):
        await send({"type": "test.message"})

    invoke, messages = run_asgi(app, clock, path=path, scope_type=scope_type)
    asyncio.run(invoke())
    assert messages == [{"type": "test.message"}]
    assert request_stats.snapshot()["requests"] == 0


def test_reset_clears_post_response_failures(clock):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200})
        await send({"type": "http.response.body", "body": b"done"})
        raise RuntimeError("private background detail")

    invoke, _ = run_asgi(app, clock)
    with pytest.raises(RuntimeError):
        asyncio.run(invoke())
    assert len(request_stats.snapshot()["recent_post_response_errors"]) == 1
    request_stats.reset()
    snapshot = request_stats.snapshot()
    assert snapshot["requests"] == 0
    assert snapshot["recent_post_response_errors"] == []
