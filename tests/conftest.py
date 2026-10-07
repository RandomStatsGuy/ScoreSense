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
def _reset_hub_db_init_flag(tmp_path, monkeypatch):
    """Isolate default paths too, including API startup's spawned workers."""
    from src import config
    from src.draft_hub import storage
    from src.auth import user_store

    database_root = tmp_path / "databases"
    monkeypatch.setenv("SCORESENSE_TEST_DATABASE_ROOT", str(database_root))
    diagnostics_path = tmp_path / "job_diagnostics.sqlite3"
    monkeypatch.setenv("JOB_DIAGNOSTICS_PATH", str(diagnostics_path))
    monkeypatch.setenv("JOB_DIAGNOSTICS_ENABLED", "false")
    monkeypatch.setattr(config, "JOB_DIAGNOSTICS_PATH", diagnostics_path)
    monkeypatch.setattr(config, "JOB_DIAGNOSTICS_ENABLED", False)
    for module, prefix, dirname, filename in (
        (config, "DRAFT_HUB", "draft_hub", "draft_hub.db"),
        (storage, "DRAFT_HUB", "draft_hub", "draft_hub.db"),
        (config, "AUTH", "auth", "users.db"),
        (user_store, "AUTH", "auth", "users.db"),
        (config, "ADMIN_OPS", "admin_ops", "admin_ops.db"),
    ):
        monkeypatch.setattr(module, prefix + "_DIR", database_root / dirname)
        monkeypatch.setattr(module, prefix + "_DB", database_root / dirname / filename)

    from src.ops import admin_store
    admin_store._invalidate_cache()
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
def diagnostics_enabled(tmp_path, monkeypatch):
    """Only explicit diagnostics tests write observations, always to a temp file."""
    from src import config
    from src.ops import job_diagnostics
    path = tmp_path / "job_diagnostics.sqlite3"
    monkeypatch.setattr(config, "JOB_DIAGNOSTICS_ENABLED", True)
    monkeypatch.setattr(config, "JOB_DIAGNOSTICS_PATH", path)
    # Spawned worker tests read configuration from their inherited environment.
    monkeypatch.setenv("JOB_DIAGNOSTICS_ENABLED", "true")
    monkeypatch.setenv("JOB_DIAGNOSTICS_PATH", str(path))
    job_diagnostics._READY.discard(str(path.resolve()))
    return path


@pytest.fixture()
def auth_db(tmp_path, monkeypatch):
    """Isolated auth SQLite — never touches data/auth/users.db."""
    from src.auth import user_store

    monkeypatch.setattr(user_store, "AUTH_DB", tmp_path / "users.db")
    monkeypatch.setattr(user_store, "AUTH_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def prepare_weekly_context():
    """Publish mocked weekly source data before a payload or HTTP read."""
    from unittest.mock import patch
    from src.draft_hub.prepared_week_context import prepare_week_context
    def prepare(season=2026, week=1):
        with patch("src.draft_hub.weekly_command_center._load_prior_ppg_index", return_value={}), \
             patch("src.draft_hub.weekly_command_center._load_def_vs_pos", return_value={}), \
             patch("src.draft_hub.weekly_command_center._load_vegas_teams", return_value={}):
            return prepare_week_context(season, week)
    return prepare


@pytest.fixture(autouse=True)
def _isolate_materialized_caches(tmp_path, monkeypatch):
    from src.jobs import season_refresh
    monkeypatch.setattr(season_refresh, "STATUS_PATH", tmp_path / "season_refresh.json")
    from src.draft_hub import value_snapshot
    monkeypatch.setattr(value_snapshot, "SNAPSHOT_DIR", tmp_path / "value_snapshots")
    from src.draft_hub import prepared_week_context
    monkeypatch.setattr(prepared_week_context, "FANTASY_WEEK_CONTEXT_DIR", tmp_path / "fantasy_week_context")
    from src.draft_hub import prepared_k_def_context
    monkeypatch.setattr(prepared_k_def_context, "FANTASY_K_DEF_CONTEXT_PATH", tmp_path / "fantasy_week_context" / "k_def.json")
    from src.draft_hub.weekly_command_center import invalidate_weekly_context_cache
    from src.draft_hub import contract_sync, draft_pool_cache
    from src.draft_hub.value_sheet import invalidate_pool_payload_cache
    from src.projections import weekly_cache

    draft_pool_cache.invalidate_pool_cache()
    invalidate_pool_payload_cache()
    weekly_cache.invalidate_weekly_cache()
    invalidate_weekly_context_cache()
    contract_sync.clear_history_cache()
    yield
    draft_pool_cache.invalidate_pool_cache()
    invalidate_pool_payload_cache()
    weekly_cache.invalidate_weekly_cache()
    invalidate_weekly_context_cache()
    contract_sync.clear_history_cache()


@pytest.fixture(autouse=True)
def _process_pool_lifecycle():
    import app.process_pool as process_pool

    process_pool._executor = None
    yield
    process_pool.shutdown_process_executor(wait=False)


@pytest.fixture
def before_nfl_week_one(monkeypatch):
    """Keep prospective 2026 Week 1 lineup tests independent of today's date."""
    from datetime import datetime, timezone

    monkeypatch.setattr(
        "src.draft_hub.hub_scoring._utcnow",
        lambda: datetime(2026, 9, 1, tzinfo=timezone.utc),
    )
