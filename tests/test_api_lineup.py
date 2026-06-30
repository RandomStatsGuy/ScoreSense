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


def test_assetlinks_empty_without_fingerprint(monkeypatch):
    from app.api import serve_android_assetlinks

    monkeypatch.setattr("app.api.TWA_SHA256_FINGERPRINT", "")
    assert serve_android_assetlinks() == []


def test_assetlinks_with_fingerprint(monkeypatch):
    from app.api import serve_android_assetlinks

    monkeypatch.setattr(
        "app.api.TWA_SHA256_FINGERPRINT",
        "AA:BB:CC:DD,EE:FF:00:11",
    )
    payload = serve_android_assetlinks()
    assert len(payload) == 1
    assert payload[0]["target"]["package_name"] == "com.fourthdownlabs.scoresense"
    assert payload[0]["target"]["sha256_cert_fingerprints"] == [
        "AA:BB:CC:DD",
        "EE:FF:00:11",
    ]
