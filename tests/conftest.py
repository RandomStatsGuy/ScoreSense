"""Shared pytest fixtures — test env flag, isolated hub DB, cache and process pool cleanup."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("TESTING", "1")
os.environ.setdefault("SCORESENSE_TESTING", "1")


@pytest.fixture(scope="session", autouse=True)
def _testing_env() -> None:
    """Mark the process as a test run for config guards and integrations."""
    os.environ["TESTING"] = "1"
    os.environ["SCORESENSE_TESTING"] = "1"


@pytest.fixture(autouse=True)
def _reset_hub_db_init_flag():
    """Schema init is gated by a module flag; reset so each test's tmp DB gets tables."""
    from src.draft_hub import storage

    storage._DB_INITIALIZED = False
    yield


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    """Isolated Draft Hub SQLite — never touches data/draft_hub/draft_hub.db."""
    from src.draft_hub import storage

    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    storage._DB_INITIALIZED = False
    return tmp_path


@pytest.fixture()
def auth_db(tmp_path, monkeypatch):
    """Isolated auth SQLite — never touches data/auth/users.db."""
    from src.auth import user_store

    monkeypatch.setattr(user_store, "AUTH_DB", tmp_path / "users.db")
    monkeypatch.setattr(user_store, "AUTH_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def _isolate_materialized_caches():
    from src.draft_hub import contract_sync, draft_pool_cache
    from src.draft_hub.value_sheet import invalidate_pool_payload_cache
    from src.projections import weekly_cache

    draft_pool_cache.invalidate_pool_cache()
    invalidate_pool_payload_cache()
    weekly_cache.invalidate_weekly_cache()
    contract_sync.clear_history_cache()
    yield
    draft_pool_cache.invalidate_pool_cache()
    invalidate_pool_payload_cache()
    weekly_cache.invalidate_weekly_cache()
    contract_sync.clear_history_cache()


@pytest.fixture(autouse=True)
def _process_pool_lifecycle():
    import app.process_pool as process_pool

    process_pool._executor = None
    yield
    process_pool.shutdown_process_executor(wait=False)
