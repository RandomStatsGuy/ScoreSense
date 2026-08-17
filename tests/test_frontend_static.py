"""Tests for serving built frontend root assets (PWA manifest, service worker)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def frontend_dist_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!DOCTYPE html><html><body>app</body></html>", encoding="utf-8")
    (dist / "manifest.webmanifest").write_text('{"name":"ScoreSense"}', encoding="utf-8")
    (dist / "sw.js").write_text("self.skipWaiting();", encoding="utf-8")
    (dist / "pwa-192.png").write_bytes(b"png")
    assets = dist / "assets"
    assets.mkdir()
    (assets / "index.js").write_text("console.log('ok');", encoding="utf-8")

    import app.api as api_module

    if not hasattr(api_module, "serve_spa"):
        pytest.skip("Frontend static routes not registered (build frontend/dist first)")
    monkeypatch.setattr(api_module, "FRONTEND_DIST", dist)
    return TestClient(api_module.app)


def test_serve_pwa_manifest_not_html(frontend_dist_client: TestClient) -> None:
    res = frontend_dist_client.get("/manifest.webmanifest")
    assert res.status_code == 200
    assert "ScoreSense" in res.text
    assert "<!DOCTYPE html>" not in res.text


def test_serve_service_worker_not_html(frontend_dist_client: TestClient) -> None:
    res = frontend_dist_client.get("/sw.js")
    assert res.status_code == 200
    assert "skipWaiting" in res.text
    assert "<!DOCTYPE html>" not in res.text


def test_serve_pwa_icon_from_dist_root(frontend_dist_client: TestClient) -> None:
    res = frontend_dist_client.get("/pwa-192.png")
    assert res.status_code == 200
    assert res.content == b"png"


def test_unknown_spa_route_falls_back_to_index(frontend_dist_client: TestClient) -> None:
    res = frontend_dist_client.get("/hub/setup")
    assert res.status_code == 200
    assert "app" in res.text


def test_index_html_is_not_cached(frontend_dist_client: TestClient) -> None:
    res = frontend_dist_client.get("/")
    assert res.status_code == 200
    assert "no-store" in res.headers.get("cache-control", "")


def test_service_worker_is_not_cached(frontend_dist_client: TestClient) -> None:
    res = frontend_dist_client.get("/sw.js")
    assert res.status_code == 200
    assert "no-store" in res.headers.get("cache-control", "")


def test_spa_fallback_html_is_not_cached(frontend_dist_client: TestClient) -> None:
    res = frontend_dist_client.get("/hub/setup")
    assert res.status_code == 200
    assert "no-store" in res.headers.get("cache-control", "")


def test_frontend_cache_headers_shell_vs_assets() -> None:
    from app.api import frontend_cache_headers

    html = frontend_cache_headers("index.html", spa_shell=True)
    assert "no-store" in html["Cache-Control"]

    sw = frontend_cache_headers("sw.js")
    assert "no-store" in sw["Cache-Control"]

    workbox = frontend_cache_headers("workbox-abc.js")
    assert "no-store" in workbox["Cache-Control"]

    icon = frontend_cache_headers("pwa-192.png")
    assert icon == {}


def test_frontend_file_response_marks_service_worker_uncacheable(tmp_path: Path) -> None:
    from app.api import _frontend_file_response

    sw = tmp_path / "sw.js"
    sw.write_text("self.skipWaiting();", encoding="utf-8")
    resp = _frontend_file_response(sw)
    assert "no-store" in resp.headers["cache-control"]


def test_hashed_assets_are_cached_immutably(tmp_path: Path) -> None:
    from fastapi import FastAPI

    from app.api import ImmutableStaticFiles

    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "index-abc123.js").write_text("console.log('ok');", encoding="utf-8")
    mini = FastAPI()
    mini.mount("/assets", ImmutableStaticFiles(directory=assets), name="assets")
    res = TestClient(mini).get("/assets/index-abc123.js")
    assert res.status_code == 200
    cache = res.headers.get("cache-control", "")
    assert "immutable" in cache
    assert "max-age=31536000" in cache
