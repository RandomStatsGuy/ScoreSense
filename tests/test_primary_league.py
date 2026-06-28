"""Primary league membership excludes practice rooms."""

import pytest

from src.draft_hub import storage
from src.draft_hub.hub_context import resolve_hub_context
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_practice_league_does_not_replace_primary(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("user-a")
    real = storage.create_league("user-a", "Real League", 2025, rules, workspace_id=ws["id"])
    practice = storage.create_league(
        "user-a",
        "Practice",
        2025,
        rules,
        test_mode=True,
    )

    ctx = resolve_hub_context("user-a")
    assert ctx["league_id"] == real["id"]
    assert ctx["league_id"] != practice["id"]
