"""API health and lineup route registration."""

from app.api import app


def test_health_route_registered():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/health" in paths


def test_lineup_routes_registered():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/lineup/pool" in paths
    assert "/api/lineup/optimize" in paths
    assert "/api/lineup/vegas" in paths


def test_optimize_request_supports_construction_controls():
    from app.api import LineupOptimizeRequest

    request = LineupOptimizeRequest(
        qb_stack_count=2,
        stack_bring_back=True,
        max_per_team=3,
        min_salary=49000,
        lineup_count=150,
        max_exposure=0.5,
        randomness=0.15,
    )
    assert request.qb_stack_count == 2
    assert request.stack_bring_back is True
    assert request.max_exposure == 0.5

    defaults = LineupOptimizeRequest()
    assert defaults.qb_stack_count is None
    assert defaults.max_exposure is None
    assert defaults.randomness is None


def test_showdown_formats_listed():
    from src.products.dfs_config import list_site_configs

    formats = list_site_configs()
    assert "draftkings_showdown" in formats
    assert formats["draftkings_showdown"]["roster"] == {"cpt": 1, "flex": 5}
    assert formats["draftkings_showdown"]["captain_label"] == "CPT"
    assert formats["fanduel_single"]["captain_label"] == "MVP"
    assert formats["fanduel"]["base_site"] == "fanduel"


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
