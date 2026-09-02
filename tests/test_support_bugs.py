"""In-app bug reports → SCORE Jira."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth import create_access_token, create_guest_access_token, register_native_user
from src.auth import user_store
from src.auth.rate_limit import reset_rate_limits
from src.support.jira_bugs import (
    build_bug_description,
    build_bug_summary,
    create_user_bug,
    jira_configured,
)


@pytest.fixture()
def client(auth_db, monkeypatch):
    monkeypatch.setattr("src.config.JIRA_EMAIL", "")
    monkeypatch.setattr("src.config.JIRA_API_TOKEN", "")
    from app.api import app

    return TestClient(app)


def _auth_headers(email: str = "reporter@example.com") -> dict[str, str]:
    user = register_native_user(email, "longpassword1", "Pat Reporter", accept_terms=True)
    user_store.mark_email_verified(user["id"])
    token = create_access_token(user, auth_type="native")
    return {"Authorization": f"Bearer {token}"}


def test_jira_configured_reads_live_config(monkeypatch):
    monkeypatch.setattr("src.config.JIRA_EMAIL", "")
    monkeypatch.setattr("src.config.JIRA_API_TOKEN", "")
    assert jira_configured() is False
    monkeypatch.setattr("src.config.JIRA_EMAIL", "ops@example.com")
    monkeypatch.setattr("src.config.JIRA_API_TOKEN", "token")
    assert jira_configured() is True


def test_build_bug_summary_prefixes_product_area():
    assert build_bug_summary("Create league swallows click", "Fantasy") == (
        "Fantasy: Create league swallows click"
    )
    assert build_bug_summary("Weird overlay", "Other") == "Weird overlay"


def test_build_bug_description_names_reporter():
    doc = build_bug_description(
        what_happened="Create league sits at the bottom and the overlay eats the click.",
        expected="The room is created and Fantasy switches to it.",
        area="Fantasy",
        page_path="/hub/setup",
        reporter_name="Pat",
        reporter_email="pat@example.com",
        reporter_sub="ss:abc",
    )
    texts = " ".join(
        node["content"][0]["text"]
        for node in doc["content"]
        if node.get("content")
    )
    assert "Create league sits at the bottom" in texts
    assert "Fantasy · /hub/setup" in texts
    assert "pat@example.com" in texts


def test_status_disabled_without_token(client):
    res = client.get("/api/support/bugs/status")
    assert res.status_code == 200
    assert res.json() == {"enabled": False}


def test_create_requires_sign_in(client):
    res = client.post(
        "/api/support/bugs",
        json={
            "title": "Create league is broken",
            "what_happened": "The overlay eats the click when I try to create a league.",
            "area": "Fantasy",
        },
    )
    assert res.status_code == 401
    assert "Sign in" in res.json()["detail"]


def test_create_rejects_guest(client):
    token, _sub = create_guest_access_token(
        league_id="league-1",
        team_id="team-1",
        name="Guest",
    )
    res = client.post(
        "/api/support/bugs",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "title": "Create league is broken",
            "what_happened": "The overlay eats the click when I try to create a league.",
            "area": "Fantasy",
        },
    )
    assert res.status_code == 403
    assert "Guest" in res.json()["detail"] or "guest" in res.json()["detail"].lower()


def test_create_unconfigured_returns_503(client):
    res = client.post(
        "/api/support/bugs",
        headers=_auth_headers(),
        json={
            "title": "Create league is broken",
            "what_happened": "The overlay eats the click when I try to create a league.",
            "area": "Fantasy",
            "page_path": "/hub/setup",
        },
    )
    assert res.status_code == 503
    assert "board" in res.json()["detail"].lower()


def test_create_rejects_short_title(client, monkeypatch):
    monkeypatch.setattr("src.config.JIRA_EMAIL", "ops@example.com")
    monkeypatch.setattr("src.config.JIRA_API_TOKEN", "token")
    res = client.post(
        "/api/support/bugs",
        headers=_auth_headers(),
        json={
            "title": "Nope",
            "what_happened": "The overlay eats the click when I try to create a league.",
        },
    )
    assert res.status_code == 400


def test_create_files_labeled_bug(client, monkeypatch):
    captured = {}

    def _fake_create(*, summary, description, labels=("user-reported", "pickup"), **_kw):
        captured["summary"] = summary
        captured["description"] = description
        captured["labels"] = labels
        return {"key": "SCORE-99", "id": "1", "url": "https://scoresenseapp.atlassian.net/browse/SCORE-99"}

    monkeypatch.setattr("src.config.JIRA_EMAIL", "ops@example.com")
    monkeypatch.setattr("src.config.JIRA_API_TOKEN", "token")
    monkeypatch.setattr("app.support_routes.create_user_bug", _fake_create)

    res = client.post(
        "/api/support/bugs",
        headers=_auth_headers(),
        json={
            "title": "Create league swallows the click",
            "what_happened": "The overlay eats the click when I try to create a league.",
            "expected": "The room is created and Fantasy switches to it.",
            "area": "Fantasy",
            "page_path": "/hub/setup?invite=secret",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["key"] == "SCORE-99"
    assert body["url"].endswith("/browse/SCORE-99")
    assert captured["summary"] == "Fantasy: Create league swallows the click"
    assert captured["labels"] == ("user-reported", "pickup")
    texts = " ".join(
        node["content"][0]["text"]
        for node in captured["description"]["content"]
        if node.get("content")
    )
    assert "/hub/setup" in texts
    assert "invite=secret" not in texts
    assert "reporter@example.com" in texts


def test_create_rate_limited(client, monkeypatch):
    monkeypatch.setattr("src.config.JIRA_EMAIL", "ops@example.com")
    monkeypatch.setattr("src.config.JIRA_API_TOKEN", "token")
    monkeypatch.setattr(
        "app.support_routes.create_user_bug",
        lambda **_kw: {"key": "SCORE-1", "id": "1", "url": "https://example/browse/SCORE-1"},
    )
    reset_rate_limits()
    monkeypatch.setattr("app.support_routes.check_rate_limit", lambda *_a, **_k: False)
    res = client.post(
        "/api/support/bugs",
        headers=_auth_headers(),
        json={
            "title": "Create league swallows the click",
            "what_happened": "The overlay eats the click when I try to create a league.",
            "area": "Fantasy",
        },
    )
    assert res.status_code == 429


def test_create_user_bug_posts_expected_payload(monkeypatch):
    posted = {}

    class _Res:
        status_code = 201

        def json(self):
            return {"key": "SCORE-12", "id": "12"}

    def _post(url, **kwargs):
        posted["url"] = url
        posted["json"] = kwargs["json"]
        posted["auth"] = kwargs["auth"]
        return _Res()

    monkeypatch.setattr("src.config.JIRA_EMAIL", "ops@example.com")
    monkeypatch.setattr("src.config.JIRA_API_TOKEN", "secret-token")
    monkeypatch.setattr("src.config.JIRA_CLOUD_ID", "cloud-1")
    monkeypatch.setattr("src.support.jira_bugs.requests.post", _post)

    created = create_user_bug(
        summary="Fantasy: overlay eats click",
        description={"type": "doc", "version": 1, "content": []},
    )
    assert created["key"] == "SCORE-12"
    assert posted["auth"] == ("ops@example.com", "secret-token")
    assert posted["json"]["fields"]["issuetype"]["name"] == "Bug"
    assert posted["json"]["fields"]["labels"] == ["user-reported", "pickup"]
    assert "cloud-1" in posted["url"]
