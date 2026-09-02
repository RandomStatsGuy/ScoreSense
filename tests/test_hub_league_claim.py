"""Shareable league claim links — pick an unclaimed team without a matching email."""

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.league_claim import accept_claim_link, build_claim_preview, build_claim_url
from src.draft_hub.league_invites import create_invite
from src.draft_hub.presets import load_preset


def _client_for(sub: str, email: str = "mgr@example.com") -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {
        "sub": sub,
        "auth_type": "native",
        "email": email,
    }
    return TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.pop(require_hub_user, None)


def _seed(hub_db, *, sub: str = "claim-comm"):
    ws = storage.get_or_create_workspace(sub, season=2026)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(sub, "Text Group League", 2026, rules, workspace_id=ws["id"])
    storage.add_unclaimed_team(league["id"], "The Night Owls", rules.salary_cap)
    storage.add_unclaimed_team(league["id"], "Sunday Club", rules.salary_cap)
    return league, storage.get_league_claim_token(league["id"]), sub


def test_claim_url_uses_query_param():
    assert build_claim_url("abc123").endswith("/hub/draft?claim=abc123")


def test_preview_lists_unclaimed_teams(hub_db):
    league, token, _sub = _seed(hub_db)
    preview = build_claim_preview(token)
    assert preview["status"] == "open"
    assert preview["league_name"] == "Text Group League"
    names = {t["name"] for t in preview["unclaimed_teams"]}
    assert names == {"The Night Owls", "Sunday Club"}
    assert preview["already_member"] is False


def test_accept_claim_picks_named_team(hub_db):
    league, token, _comm = _seed(hub_db)
    night = next(t for t in storage.list_league_teams(league["id"]) if t["name"] == "The Night Owls")
    result = accept_claim_link(token, "ss:owl", team_id=night["id"])
    assert result["team"]["name"] == "The Night Owls"
    assert result["team"]["user_sub"] == "ss:owl"
    assert result["already_member"] is False

    preview = build_claim_preview(token, "ss:owl")
    assert preview["already_member"] is True
    assert preview["your_team"]["name"] == "The Night Owls"
    left = {t["name"] for t in preview["unclaimed_teams"]}
    assert left == {"Sunday Club"}


def test_accept_claim_rejects_taken_team(hub_db):
    league, token, _comm = _seed(hub_db)
    night = next(t for t in storage.list_league_teams(league["id"]) if t["name"] == "The Night Owls")
    accept_claim_link(token, "ss:owl", team_id=night["id"])
    try:
        accept_claim_link(token, "ss:other", team_id=night["id"])
        raise AssertionError("expected claimed team to reject")
    except ValueError as exc:
        assert "already claimed" in str(exc)


def test_join_league_claims_existing_name(hub_db):
    league, _token, _comm = _seed(hub_db)
    team = storage.join_league("ss:sunday", league["room_code"], "Sunday Club")
    assert team["name"] == "Sunday Club"
    assert team["user_sub"] == "ss:sunday"
    teams = storage.list_league_teams(league["id"])
    sunday = [t for t in teams if t["name"] == "Sunday Club"]
    assert len(sunday) == 1


def test_disabled_claim_link_rejects(hub_db):
    league, token, comm = _seed(hub_db)
    storage.update_league_settings(league["id"], claim_link_enabled=False)
    preview = build_claim_preview(token)
    assert preview["status"] == "disabled"
    night = next(t for t in storage.list_league_teams(league["id"]) if t["name"] == "The Night Owls")
    try:
        accept_claim_link(token, "ss:owl", team_id=night["id"])
        raise AssertionError("expected disabled link to reject")
    except ValueError as exc:
        assert "not accepting" in str(exc).lower()
    assert comm


def test_claim_api_preview_and_accept(hub_db):
    league, token, comm = _seed(hub_db)
    client = _client_for("ss:owl")
    preview = client.get(f"/api/hub/claim/{token}")
    assert preview.status_code == 200
    body = preview.json()
    night = next(t for t in body["unclaimed_teams"] if t["name"] == "The Night Owls")
    accepted = client.post(
        f"/api/hub/claim/{token}",
        json={"team_id": night["id"]},
    )
    assert accepted.status_code == 200
    data = accepted.json()
    assert data["team"]["name"] == "The Night Owls"
    assert data["hub_context"]["league_id"] == league["id"]

    rotate = _client_for(comm).post(f"/api/hub/league/{league['id']}/claim-link/rotate")
    assert rotate.status_code == 200
    new_url = rotate.json()["claim"]["url"]
    assert "claim=" in new_url
    stale = client.get(f"/api/hub/claim/{token}")
    assert stale.status_code == 404


def test_claim_link_skips_seats_with_pending_invite(hub_db):
    league, token, comm = _seed(hub_db)
    night = next(t for t in storage.list_league_teams(league["id"]) if t["name"] == "The Night Owls")
    create_invite(league["id"], "owl@example.com", "The Night Owls", comm)
    preview = build_claim_preview(token)
    names = {t["name"] for t in preview["unclaimed_teams"]}
    assert names == {"Sunday Club"}
    try:
        accept_claim_link(token, "ss:thief", team_id=night["id"])
        raise AssertionError("expected reserved seat to reject")
    except ValueError as exc:
        assert "reserved" in str(exc).lower()
    still = storage.get_team(night["id"])
    assert not still.get("user_sub")
    try:
        accept_claim_link(token, "ss:thief", team_name="The Night Owls")
        raise AssertionError("expected reserved name to reject")
    except ValueError as exc:
        assert "reserved" in str(exc).lower()
