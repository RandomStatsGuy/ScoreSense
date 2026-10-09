"""Shared pytest fixtures — test env flag, isolated hub DB, cache and process pool cleanup."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("TESTING", "1")
os.environ.setdefault("SCORESENSE_TESTING", "1")


@pytest.fixture(scope="session")
def posix_shell():
    from shell_support import PosixShell

    return PosixShell()


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
    from src.projections import projection_movement
    monkeypatch.setattr(projection_movement, "WEEKLY_PROJECTION_CHANGES_DIR", tmp_path / "weekly_projection_changes")
    from src.draft_hub import native_stats, native_participation
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path / "native_scores")
    native_stats.clear_native_stats_cache()
    native_participation.clear_participation_cache()
    def no_participation_network(_url):
        raise RuntimeError("Historical participation requests require an explicit provider fixture.")
    monkeypatch.setattr(native_participation, "_fetch_json", no_participation_network)
    from src.jobs import season_refresh
    monkeypatch.setattr(season_refresh, "STATUS_PATH", tmp_path / "season_refresh.json")
    from src.draft_hub import value_snapshot
    monkeypatch.setattr(value_snapshot, "SNAPSHOT_DIR", tmp_path / "value_snapshots")
    from src.draft_hub import prepared_week_context
    monkeypatch.setattr(prepared_week_context, "FANTASY_WEEK_CONTEXT_DIR", tmp_path / "fantasy_week_context")
    monkeypatch.setattr(prepared_week_context, "_RETRY", {})
    monkeypatch.setattr(prepared_week_context, "_HISTORY_DUE_AT", [0.0])
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
    native_participation.clear_participation_cache()
    native_stats.clear_native_stats_cache()
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


@pytest.fixture()
def trusted_native_catalog(tmp_path, monkeypatch):
    """Explicit trusted player records for synthetic acquisition/lineup fixtures."""
    import json
    import re

    from src.draft_hub import player_identity
    from src.integrations import sleeper

    path = tmp_path / "trusted_sleeper_players.json"
    records = {}
    path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(sleeper, "PLAYERS_CACHE", path)
    monkeypatch.setattr(player_identity, "DRAFT_POOL_DIR", tmp_path / "draft_pool")
    player_identity.clear_player_identity_cache()

    def register(player_id, *, name=None, team="KC", position="WR",
                 sleeper_player_id=None, gsis_id=None):
        pid = str(player_id)
        sid = str(sleeper_player_id or pid.removeprefix("sleeper-"))
        gsis = gsis_id or (pid if re.fullmatch(r"00-\d{7}", pid) else None)
        if sid not in records:
            records[sid] = {"full_name": name or f"Player {pid}", "team": team,
                            "position": position, "gsis_id": gsis}
            path.write_text(json.dumps(records), encoding="utf-8")
            player_identity.clear_player_identity_cache()
        return records[sid]

    yield register
    player_identity.clear_player_identity_cache()


@pytest.fixture()
def trusted_native_roster_rows(trusted_native_catalog, monkeypatch):
    """Treat explicitly seeded DB rows as trusted test catalog entries."""
    from src.draft_hub import storage

    original_add = storage.add_roster_slot

    def add(workspace_id, row, *args, **kwargs):
        trusted_native_catalog(row["player_id"], name=row.get("player_name"),
                               team=row.get("team") or row.get("nfl_team") or "KC",
                               position=row.get("position") or "WR",
                               sleeper_player_id=row.get("sleeper_player_id"))
        return original_add(workspace_id, row, *args, **kwargs)

    monkeypatch.setattr(storage, "add_roster_slot", add)
    return trusted_native_catalog
