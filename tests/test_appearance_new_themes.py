"""Every Appearance theme offered in Account must persist through the prefs API."""

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub.league_atmosphere import ATMOSPHERE_THEMES


@pytest.fixture(autouse=True)
def _clear_hub_auth_override():
    yield
    app.dependency_overrides.pop(require_hub_user, None)


@pytest.mark.parametrize("theme", [t for t in ATMOSPHERE_THEMES if t != "none"])
def test_every_offered_theme_round_trips(hub_db, theme):
    app.dependency_overrides[require_hub_user] = lambda: {"sub": f"theme-{theme}", "auth_type": "dev"}
    client = TestClient(app)
    saved = client.patch("/api/hub/prefs", json={"atmosphere": theme})
    assert saved.status_code == 200
    assert saved.json()["prefs"]["atmosphere"] == theme
    assert client.get("/api/hub/prefs").json()["prefs"]["atmosphere"] == theme


def test_frontend_offers_exactly_the_backend_themes():
    from pathlib import Path
    import re

    root = Path(__file__).resolve().parents[1]
    catalog = (root / "frontend/src/DraftHub/atmosphereCatalog.js").read_text(encoding="utf-8")
    init = (root / "frontend/public/theme-init.js").read_text(encoding="utf-8")
    copy = (root / "frontend/src/themePresentation.js").read_text(encoding="utf-8")
    css = (root / "frontend/src/styles/appearance.css").read_text(encoding="utf-8")
    js_themes = set(re.search(r"ATMOSPHERE_THEMES = \[([^\]]+)\]", catalog).group(1).replace('"', "").replace(" ", "").split(","))
    init_themes = set(re.search(r"const themes = \[([^\]]+)\]", init).group(1).replace('"', "").replace(" ", "").split(","))
    assert js_themes == set(ATMOSPHERE_THEMES) == init_themes
    for theme in ATMOSPHERE_THEMES:
        assert f'id: "{theme}"' in copy, f"{theme} missing from the Account picker"
        assert f"{theme}: {{ light:" in init, f"{theme} missing a first-paint canvas"
        if theme != "none":
            assert f':root[data-experience-theme="{theme}"]' in css, f"{theme} has no palette"
