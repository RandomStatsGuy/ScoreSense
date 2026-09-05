"""API coverage for Fantasy atmosphere, team identity, and week trophies."""

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.presets import load_preset


@pytest.fixture(autouse=True)
def _clear_hub_auth_override():
    yield
    app.dependency_overrides.pop(require_hub_user, None)


def _client_for(sub: str) -> TestClient:
    """Bind hub auth for this request. Shared TestClient overrides are process-global."""
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _seed_league(hub_db):
    comm = "atm-api-comm"
    member = "atm-api-member"
    ws = storage.get_or_create_workspace(comm, season=2026)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Culture League", 2026, rules, workspace_id=ws["id"])
    storage.join_league(member, league["room_code"], "Visitor")
    return comm, member, league


def test_prefs_round_trip(hub_db):
    client = _client_for("atm-pref-user")
    empty = client.get("/api/hub/prefs")
    assert empty.status_code == 200
    assert empty.json()["prefs"]["atmosphere"] == "none"

    saved = client.patch("/api/hub/prefs", json={"atmosphere": "snow"})
    assert saved.status_code == 200
    assert saved.json()["prefs"]["atmosphere"] == "snow"
    assert client.get("/api/hub/prefs").json()["prefs"]["atmosphere"] == "snow"


def test_prefs_partial_patch_preserves_other_options(hub_db):
    """Toggling one tailoring option must not reset the theme or the others."""
    client = _client_for("atm-pref-tailor")
    client.patch("/api/hub/prefs", json={"atmosphere": "cozy", "atmosphere_intensity": "lively"})

    toggled = client.patch("/api/hub/prefs", json={"atmosphere_motion": False})
    assert toggled.status_code == 200
    prefs = toggled.json()["prefs"]
    assert prefs["atmosphere"] == "cozy"
    assert prefs["atmosphere_motion"] is False
    assert prefs["atmosphere_intensity"] == "lively"
    assert prefs["atmosphere_pile"] is True

    stored = client.get("/api/hub/prefs").json()["prefs"]
    assert stored["atmosphere"] == "cozy"
    assert stored["atmosphere_motion"] is False
    assert stored["atmosphere_intensity"] == "lively"


def test_team_identity_owner_can_edit_member_cannot(hub_db):
    comm, member, league = _seed_league(hub_db)
    comm_team = storage.get_team_by_user(league["id"], comm)
    member_team = storage.get_team_by_user(league["id"], member)

    ok = _client_for(comm).patch(
        f"/api/hub/league/{league['id']}/teams/{comm_team['id']}/identity",
        json={"photo_preset": "storm", "room_theme": "locker"},
    )
    assert ok.status_code == 200
    assert ok.json()["identity"]["photo_preset"] == "storm"

    blocked = _client_for(member).patch(
        f"/api/hub/league/{league['id']}/teams/{comm_team['id']}/identity",
        json={"photo_preset": "night"},
    )
    assert blocked.status_code == 403

    own = _client_for(member).patch(
        f"/api/hub/league/{league['id']}/teams/{member_team['id']}/identity",
        json={"banner_preset": "amber_edge"},
    )
    assert own.status_code == 200
    listed = _client_for(member).get(f"/api/hub/league/{league['id']}/identities")
    assert listed.status_code == 200
    assert listed.json()["identities"][member_team["id"]]["banner_preset"] == "amber_edge"


def test_week_trophy_vote_and_emote_requires_win(hub_db):
    comm, member, league = _seed_league(hub_db)
    member_team = storage.get_team_by_user(league["id"], member)
    client = _client_for(comm)
    culture = client.get(f"/api/hub/league/{league['id']}/week-culture?week=2&season=2026")
    assert culture.status_code == 200
    payload = culture.json()
    assert len(payload["polls"]) == 4
    poll_id = payload["polls"][0]["id"]

    voted = client.post(
        f"/api/hub/league/{league['id']}/week-culture/polls/{poll_id}/vote",
        json={"nominee_team_id": member_team["id"]},
    )
    assert voted.status_code == 200
    first = next(p for p in voted.json()["polls"] if p["id"] == poll_id)
    assert first["viewer_vote"] == member_team["id"]
    assert first["total_votes"] == 1

    denied = client.post(
        f"/api/hub/league/{league['id']}/week-culture/emotes",
        json={"to_team_id": member_team["id"], "emote_key": "flex", "week": 2, "season": 2026},
    )
    assert denied.status_code == 400


def test_week_trophy_vote_rejects_foreign_poll(hub_db):
    comm, member, league_a = _seed_league(hub_db)
    rules = load_preset("salary_cap_auction_v1")
    other = storage.create_league("atm-other-comm", "Other League", 2026, rules)
    other_polls = storage.ensure_week_trophy_polls(other["id"], 2026, 2)
    foreign_poll_id = other_polls[0]["id"]
    member_team = storage.get_team_by_user(league_a["id"], member)

    blocked = _client_for(comm).post(
        f"/api/hub/league/{league_a['id']}/week-culture/polls/{foreign_poll_id}/vote",
        json={"nominee_team_id": member_team["id"]},
    )
    assert blocked.status_code == 404
    assert storage.list_week_poll_votes(foreign_poll_id) == []


def test_identity_media_upload_rejects_non_image(hub_db):
    comm, _member, league = _seed_league(hub_db)
    comm_team = storage.get_team_by_user(league["id"], comm)
    client = _client_for(comm)
    bad = client.post(
        f"/api/hub/league/{league['id']}/teams/{comm_team['id']}/identity/media?kind=photo",
        files={"file": ("note.txt", b"not-an-image", "text/plain")},
    )
    assert bad.status_code == 400

    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
    ok = client.post(
        f"/api/hub/league/{league['id']}/teams/{comm_team['id']}/identity/media?kind=photo",
        files={"file": ("team.jpg", jpeg, "image/jpeg")},
    )
    assert ok.status_code == 200
    media_id = ok.json()["media"]["id"]
    fetched = client.get(f"/api/hub/media/{media_id}")
    assert fetched.status_code == 200
    assert fetched.content[:3] == b"\xff\xd8\xff"

    from src.draft_hub.league_atmosphere import MAX_MEDIA_BYTES

    too_big = client.post(
        f"/api/hub/league/{league['id']}/teams/{comm_team['id']}/identity/media?kind=photo",
        files={"file": ("huge.jpg", b"\xff\xd8\xff" + b"\x00" * MAX_MEDIA_BYTES, "image/jpeg")},
    )
    assert too_big.status_code == 400


def test_identity_media_can_stage_then_crop_and_clear(hub_db):
    comm, _member, league = _seed_league(hub_db)
    comm_team = storage.get_team_by_user(league["id"], comm)
    client = _client_for(comm)
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 32
    staged = client.post(
        f"/api/hub/league/{league['id']}/teams/{comm_team['id']}/identity/media?kind=photo&attach=false",
        files={"file": ("team.jpg", jpeg, "image/jpeg")},
    )
    assert staged.status_code == 200
    media_id = staged.json()["media"]["id"]
    assert staged.json()["identity"]["photo_media_id"] is None

    saved = client.patch(
        f"/api/hub/league/{league['id']}/teams/{comm_team['id']}/identity",
        json={
            "photo_media_id": media_id,
            "photo_focus": {"x": 22, "y": 70, "zoom": 1.5},
            "banner_focus": {"x": 80},
        },
    )
    assert saved.status_code == 200
    identity = saved.json()["identity"]
    assert identity["photo_media_id"] == media_id
    assert identity["photo_focus"] == {"x": 22.0, "y": 70.0, "zoom": 1.5}
    assert identity["banner_focus"]["x"] == 80.0
    assert identity["banner_focus"]["y"] == 50.0

    cleared = client.patch(
        f"/api/hub/league/{league['id']}/teams/{comm_team['id']}/identity",
        json={"photo_media_id": None, "photo_focus": {"x": 10}},
    )
    assert cleared.status_code == 200
    assert cleared.json()["identity"]["photo_media_id"] is None
    assert cleared.json()["identity"]["photo_focus"]["x"] == 10.0
    assert cleared.json()["identity"]["photo_focus"]["y"] == 70.0


def test_identity_media_serves_snapped_webp_variant(hub_db):
    from io import BytesIO

    from PIL import Image

    comm, _member, league = _seed_league(hub_db)
    comm_team = storage.get_team_by_user(league["id"], comm)
    client = _client_for(comm)
    buf = BytesIO()
    Image.new("RGB", (1600, 1138), (30, 50, 90)).save(buf, format="PNG")
    uploaded = client.post(
        f"/api/hub/league/{league['id']}/teams/{comm_team['id']}/identity/media?kind=photo",
        files={"file": ("logo.png", buf.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 200
    media_id = uploaded.json()["media"]["id"]

    original = client.get(f"/api/hub/media/{media_id}")
    assert original.status_code == 200
    assert original.headers["content-type"].startswith("image/png")

    variant = client.get(f"/api/hub/media/{media_id}?w=84")
    assert variant.status_code == 200
    assert variant.headers["content-type"] == "image/webp"
    assert "max-age=" in variant.headers.get("cache-control", "")
    assert len(variant.content) < len(original.content) / 4
    with Image.open(BytesIO(variant.content)) as img:
        assert img.size[0] == 96

        same = client.get(f"/api/hub/media/{media_id}?w=96")
        assert same.status_code == 200
        assert same.content == variant.content
        tiny = client.get(f"/api/hub/media/{media_id}?w=22")
        assert tiny.status_code == 200
        assert tiny.headers["content-type"] == "image/webp"
        with Image.open(BytesIO(tiny.content)) as img:
            assert img.size[0] == 48
