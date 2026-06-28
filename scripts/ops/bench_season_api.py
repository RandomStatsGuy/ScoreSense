"""Quick benchmark for season projection API paths."""
import os
import time

os.environ.setdefault("AUTH_REQUIRED", "false")

from fastapi.testclient import TestClient  # noqa: E402

from app.api import app  # noqa: E402

c = TestClient(app)
paths = [
    "/api/meta/projections/qb",
    "/api/ros/qb?season=2026&week=1",
    "/api/draft/qb?season=2026",
]
for path in paths:
    t0 = time.perf_counter()
    r = c.get(path)
    ms = int((time.perf_counter() - t0) * 1000)
    print(r.status_code, ms, path, len(r.content))
