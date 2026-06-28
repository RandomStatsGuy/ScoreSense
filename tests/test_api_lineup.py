"""API health and lineup route registration."""

from app.api import app


def test_health_route_registered():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/health" in paths


def test_lineup_routes_registered():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/lineup/pool" in paths
    assert "/api/lineup/optimize" in paths


def test_health_payload_includes_lineup_feature():
    from app.api import health

    payload = health()
    assert payload["status"] == "ok"
    assert payload["features"]["lineup"] is True
