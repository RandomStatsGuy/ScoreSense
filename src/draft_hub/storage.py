"""SQLite persistence for Draft Hub — scoped by JWT sub."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator, Optional

from src.config import DRAFT_HUB_DB, DRAFT_HUB_DIR
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules

_GSIS_PLAYER_ID = re.compile(r"^00-\d{7}$")
_CAP_SKILL_POSITIONS = frozenset({"QB", "RB", "WR", "TE", "REC"})
# Stored in hub_workspace.active_league_id when user explicitly chose solo prep.
HUB_FOCUS_SOLO = "__solo__"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS hub_workspace (
    id TEXT PRIMARY KEY,
    user_sub TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'My League Prep',
    season INTEGER NOT NULL,
    rules_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_user ON hub_workspace(user_sub);

CREATE TABLE IF NOT EXISTS salary_range (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    player_name TEXT,
    team TEXT,
    position TEXT,
    min_sal REAL NOT NULL,
    max_sal REAL NOT NULL,
    source TEXT NOT NULL,
    UNIQUE(workspace_id, player_id)
);

CREATE TABLE IF NOT EXISTS roster_slot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    team_id TEXT,
    player_id TEXT NOT NULL,
    player_name TEXT,
    team TEXT,
    position TEXT NOT NULL,
    salary REAL NOT NULL,
    contract_years INTEGER NOT NULL DEFAULT 1,
    acquired_at TEXT NOT NULL,
    UNIQUE(workspace_id, player_id)
);

CREATE TABLE IF NOT EXISTS league (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    commissioner_sub TEXT NOT NULL,
    name TEXT NOT NULL,
    season INTEGER NOT NULL,
    rules_json TEXT NOT NULL,
    room_code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'setup',
    team_count INTEGER NOT NULL DEFAULT 12,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team (
    id TEXT PRIMARY KEY,
    league_id TEXT NOT NULL,
    user_sub TEXT,
    name TEXT NOT NULL,
    budget_remaining REAL NOT NULL,
    is_commissioner INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT
);

CREATE TABLE IF NOT EXISTS draft_session (
    id TEXT PRIMARY KEY,
    league_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'setup',
    current_nominee_json TEXT,
    high_bid REAL,
    high_bidder_team_id TEXT,
    nomination_deadline TEXT,
    bid_deadline TEXT,
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS draft_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_extension (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roster_slot_id INTEGER NOT NULL,
    extension_years INTEGER NOT NULL,
    new_salary REAL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id TEXT NOT NULL,
    team_a_id TEXT NOT NULL,
    team_b_id TEXT NOT NULL,
    send_a_json TEXT NOT NULL,
    send_b_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roster_workspace ON roster_slot(workspace_id);
CREATE INDEX IF NOT EXISTS idx_roster_team ON roster_slot(team_id);
CREATE INDEX IF NOT EXISTS idx_salary_workspace ON salary_range(workspace_id);
CREATE INDEX IF NOT EXISTS idx_draft_event_league ON draft_event(league_id);
"""


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_claim_token() -> str:
    import secrets

    return secrets.token_urlsafe(24)


GUEST_SUB_PREFIX = "guest:"


def is_guest_sub(user_sub: str | None) -> bool:
    return str(user_sub or "").startswith(GUEST_SUB_PREFIX)


def _is_guest_sub(user_sub: str | None) -> bool:
    return is_guest_sub(user_sub)


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def user_sub_from_patron(patron: dict | None) -> str:
    """Stable identity key for Draft Hub — Patreon id or ss:{uuid} for native accounts."""
    if patron and patron.get("sub"):
        return str(patron["sub"])
    return "dev"


def _ensure_db() -> Path:
    DRAFT_HUB_DIR.mkdir(parents=True, exist_ok=True)
    return DRAFT_HUB_DB


@contextmanager
def get_conn() -> Generator[sqlite3.Connection, None, None]:
    path = _ensure_db()
    conn = sqlite3.connect(path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.row_factory = sqlite3.Row
    try:
        _init_db(conn)
        yield conn
        conn.commit()
    finally:
        conn.close()


def _safe_add_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    cols = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column in cols:
        return
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    except sqlite3.OperationalError as exc:
        if "duplicate column name" not in str(exc).lower():
            raise


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(hub_workspace)").fetchall()}
    additions = {
        "sleeper_league_id": "TEXT",
        "sleeper_roster_id": "TEXT",
        "sleeper_team_name": "TEXT",
        "sleeper_player_ids_json": "TEXT",
        "sleeper_synced_at": "TEXT",
        "sleeper_mapping_json": "TEXT",
    }
    for col, typ in additions.items():
        if col not in cols:
            conn.execute(f"ALTER TABLE hub_workspace ADD COLUMN {col} {typ}")
    _safe_add_column(conn, "hub_workspace", "active_league_id", "TEXT")

    roster_cols = {row[1] for row in conn.execute("PRAGMA table_info(roster_slot)").fetchall()}
    for col, typ in {
        "sleeper_player_id": "TEXT",
        "source": "TEXT DEFAULT 'manual'",
        "contract_json": "TEXT",
    }.items():
        if col not in roster_cols:
            conn.execute(f"ALTER TABLE roster_slot ADD COLUMN {col} {typ}")

    team_cols = {row[1] for row in conn.execute("PRAGMA table_info(team)").fetchall()}
    if "is_bot" not in team_cols:
        conn.execute("ALTER TABLE team ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0")
    for col, typ in {
        "sleeper_roster_id": "TEXT",
        "sleeper_team_name": "TEXT",
        "sleeper_player_ids_json": "TEXT",
        "sleeper_synced_at": "TEXT",
    }.items():
        if col not in team_cols:
            conn.execute(f"ALTER TABLE team ADD COLUMN {col} {typ}")

    league_cols = {row[1] for row in conn.execute("PRAGMA table_info(league)").fetchall()}
    if "test_mode" not in league_cols:
        conn.execute("ALTER TABLE league ADD COLUMN test_mode INTEGER NOT NULL DEFAULT 0")
    if "sleeper_league_id" not in league_cols:
        conn.execute("ALTER TABLE league ADD COLUMN sleeper_league_id TEXT")
    if "lock_team_claims" not in league_cols:
        conn.execute("ALTER TABLE league ADD COLUMN lock_team_claims INTEGER NOT NULL DEFAULT 1")
    if "draft_completed" not in league_cols:
        conn.execute("ALTER TABLE league ADD COLUMN draft_completed INTEGER NOT NULL DEFAULT 0")
    if "draft_contract_snapshot_json" not in league_cols:
        conn.execute("ALTER TABLE league ADD COLUMN draft_contract_snapshot_json TEXT")
    # SCORE-40: monotonic cache revisions for live roster vs historic snapshots.
    _safe_add_column(conn, "league", "live_roster_revision", "INTEGER NOT NULL DEFAULT 0")
    _safe_add_column(conn, "league", "historic_snapshot_revision", "INTEGER NOT NULL DEFAULT 0")
    _safe_add_column(conn, "league", "sandbox_baseline_json", "TEXT")
    _safe_add_column(conn, "league", "mock_saved", "INTEGER NOT NULL DEFAULT 0")

    roster_cols = {row[1] for row in conn.execute("PRAGMA table_info(roster_slot)").fetchall()}
    if "roster_status" not in roster_cols:
        conn.execute("ALTER TABLE roster_slot ADD COLUMN roster_status TEXT NOT NULL DEFAULT 'active'")

    session_cols = {row[1] for row in conn.execute("PRAGMA table_info(draft_session)").fetchall()}
    if "pool_mode" not in session_cols:
        conn.execute("ALTER TABLE draft_session ADD COLUMN pool_mode TEXT NOT NULL DEFAULT 'full'")
    _safe_add_column(conn, "draft_session", "last_bid_at", "TEXT")
    _safe_add_column(conn, "draft_session", "nominator_index", "INTEGER NOT NULL DEFAULT 0")
    _safe_add_column(conn, "draft_session", "nomination_order_json", "TEXT")
    _safe_add_column(conn, "league", "draft_starts_at", "TEXT")
    _safe_add_column(conn, "league", "draft_timezone", "TEXT")
    _safe_add_column(conn, "league", "claim_token", "TEXT")
    _safe_add_column(conn, "league", "claim_link_enabled", "INTEGER NOT NULL DEFAULT 1")
    missing_tokens = conn.execute(
        "SELECT id FROM league WHERE claim_token IS NULL OR TRIM(claim_token) = ''"
    ).fetchall()
    for row in missing_tokens:
        conn.execute(
            "UPDATE league SET claim_token = ? WHERE id = ?",
            (_new_claim_token(), row["id"]),
        )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_league_claim_token ON league(claim_token)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS draft_availability (
            id TEXT PRIMARY KEY,
            league_id TEXT NOT NULL,
            team_id TEXT NOT NULL,
            user_sub TEXT NOT NULL,
            slot_date TEXT NOT NULL,
            slot_hour INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(league_id, team_id, slot_date, slot_hour)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_draft_avail_league ON draft_availability(league_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_draft_avail_team ON draft_availability(team_id)"
    )
    _safe_add_column(conn, "draft_session", "paused", "INTEGER NOT NULL DEFAULT 0")
    _safe_add_column(conn, "draft_session", "paused_at", "TEXT")
    _safe_add_column(conn, "team", "nomination_queue_json", "TEXT")
    _safe_add_column(conn, "team", "autodraft", "INTEGER NOT NULL DEFAULT 0")
    _safe_add_column(conn, "team", "draft_slot", "INTEGER")
    _safe_add_column(conn, "league", "lobby_notified_at", "TEXT")

    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_invite (
            id TEXT PRIMARY KEY,
            league_id TEXT NOT NULL,
            email TEXT NOT NULL COLLATE NOCASE,
            team_name TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'pending',
            invited_by_sub TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            accepted_by_sub TEXT,
            accepted_at TEXT
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_league_invite_league ON league_invite(league_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_league_invite_token ON league_invite(token)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sleeper_scoring_cache (
            sleeper_league_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            synced_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sleeper_ownership_cache (
            sleeper_league_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            synced_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sleeper_live_scoring_cache (
            sleeper_league_id TEXT NOT NULL,
            week INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            synced_at TEXT NOT NULL,
            PRIMARY KEY (sleeper_league_id, week)
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS insights_cap_cache (
            league_id TEXT NOT NULL,
            season_key TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            built_at TEXT NOT NULL,
            source_version TEXT NOT NULL,
            PRIMARY KEY (league_id, season_key)
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS insights_scoring_derived (
            sleeper_league_id TEXT NOT NULL,
            season_key TEXT NOT NULL,
            awards_json TEXT NOT NULL,
            efficiency_json TEXT NOT NULL,
            built_at TEXT NOT NULL,
            PRIMARY KEY (sleeper_league_id, season_key)
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS insights_fair_values (
            league_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            player_id TEXT NOT NULL,
            fair_value REAL NOT NULL,
            pool_fingerprint TEXT NOT NULL,
            built_at TEXT NOT NULL,
            PRIMARY KEY (league_id, season, player_id)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_insights_fair_league ON insights_fair_values(league_id, season)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_legacy_import (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            season_year INTEGER NOT NULL,
            source_kind TEXT NOT NULL,
            source_path TEXT,
            imported_at TEXT NOT NULL,
            imported_by_sub TEXT,
            row_count INTEGER NOT NULL DEFAULT 0
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_legacy_import_league ON league_legacy_import(league_id, season_year)"
    )
    _safe_add_column(conn, "league_legacy_import", "snapshot_phase", "TEXT DEFAULT 'unknown'")
    _safe_add_column(conn, "league_legacy_import", "source_fingerprint", "TEXT")
    # SCORE-44: sourced checkpoint provenance (phase/as_of/ruleset).
    _safe_add_column(conn, "league_legacy_import", "as_of", "TEXT")
    _safe_add_column(conn, "league_legacy_import", "ruleset_version", "TEXT")
    _safe_add_column(conn, "league_legacy_import", "salary_cap", "REAL")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_contract_row (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            season_year INTEGER NOT NULL,
            owner_label TEXT NOT NULL,
            hub_team_name TEXT,
            player_name TEXT NOT NULL,
            player_id TEXT,
            position TEXT,
            base_salary REAL,
            cap_hit REAL,
            prior_salary REAL,
            original_draft_year INTEGER,
            roster_status TEXT NOT NULL DEFAULT 'active',
            contract_phase TEXT,
            acquisition_type TEXT,
            status_note TEXT,
            source_kind TEXT NOT NULL DEFAULT 'import',
            confidence TEXT NOT NULL DEFAULT 'imported',
            needs_review INTEGER NOT NULL DEFAULT 0,
            review_reason TEXT,
            sleeper_verified INTEGER NOT NULL DEFAULT 0,
            import_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"""
    )
    # SCORE-44: stable franchise id + ownership vs cap-obligation separation.
    _safe_add_column(conn, "league_contract_row", "franchise_id", "TEXT")
    _safe_add_column(conn, "league_contract_row", "obligation_kind", "TEXT DEFAULT 'ownership'")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_import_quarantine (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            season_year INTEGER,
            reason_code TEXT NOT NULL,
            message TEXT NOT NULL,
            owner_label TEXT,
            player_name TEXT,
            source_ref TEXT,
            detail_json TEXT,
            created_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_import_quarantine_league "
        "ON league_import_quarantine(league_id, season_year, reason_code)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_contract_row_league_season ON league_contract_row(league_id, season_year)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_contract_row_player ON league_contract_row(league_id, player_name)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_contract_row_edit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            row_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            edited_by_sub TEXT NOT NULL,
            edited_at TEXT NOT NULL,
            note TEXT
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_roster_edit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            roster_slot_id INTEGER,
            player_id TEXT NOT NULL,
            field_name TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            edited_by_sub TEXT NOT NULL,
            edited_at TEXT NOT NULL,
            note TEXT,
            live_revision INTEGER NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_league_roster_edit_league ON league_roster_edit(league_id, edited_at)"
    )
    # SCORE-43: immutable correction events (prior published state + new snapshot revision).
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_historic_correction (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            row_id INTEGER NOT NULL,
            season_year INTEGER NOT NULL,
            reason TEXT NOT NULL,
            mode TEXT NOT NULL,
            edited_by_sub TEXT NOT NULL,
            edited_at TEXT NOT NULL,
            before_json TEXT NOT NULL,
            after_json TEXT NOT NULL,
            historic_snapshot_revision INTEGER NOT NULL,
            live_applied INTEGER NOT NULL DEFAULT 0,
            live_before_json TEXT,
            live_after_json TEXT,
            live_roster_revision INTEGER
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_historic_correction_league "
        "ON league_historic_correction(league_id, season_year, edited_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_historic_correction_row "
        "ON league_historic_correction(row_id, edited_at)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_owner_season_map (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            season_year INTEGER NOT NULL,
            owner_label TEXT NOT NULL,
            hub_team_name TEXT NOT NULL,
            sleeper_user_id TEXT,
            source_kind TEXT NOT NULL DEFAULT 'manual',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(league_id, season_year, owner_label)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_owner_season_map_league ON league_owner_season_map(league_id, season_year)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_season_salary_cap (
            league_id TEXT NOT NULL,
            season_year INTEGER NOT NULL,
            salary_cap REAL NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (league_id, season_year)
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_player_name_alias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            alias_name TEXT NOT NULL,
            canonical_name TEXT NOT NULL,
            sleeper_player_id TEXT,
            position TEXT,
            source_kind TEXT NOT NULL DEFAULT 'manual',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(league_id, alias_name)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_player_name_alias_league ON league_player_name_alias(league_id)"
    )
    _safe_add_column(conn, "league_player_name_alias", "sleeper_player_id", "TEXT")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_player_movement (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            league_id TEXT NOT NULL,
            season_year INTEGER NOT NULL,
            week INTEGER,
            player_name TEXT NOT NULL,
            player_id TEXT,
            event_type TEXT NOT NULL,
            from_owner TEXT,
            to_owner TEXT,
            salary REAL,
            dead_cap REAL,
            source TEXT NOT NULL,
            confidence TEXT NOT NULL DEFAULT 'inferred',
            sleeper_transaction_id TEXT,
            payload_json TEXT,
            event_at TEXT,
            created_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_movement_league_season ON league_player_movement(league_id, season_year)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS trade_proposal (
            id TEXT PRIMARY KEY,
            league_id TEXT NOT NULL,
            created_by_sub TEXT NOT NULL,
            status TEXT NOT NULL,
            parties_json TEXT NOT NULL,
            dead_cap_assignments_json TEXT NOT NULL,
            acceptances_json TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_trade_proposal_league ON trade_proposal(league_id, status)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_roster_workspace ON roster_slot(workspace_id)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_roster_team ON roster_slot(team_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_salary_workspace ON salary_range(workspace_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_draft_event_league ON draft_event(league_id)"
    )

    _safe_add_column(conn, "league_invite", "co_commissioner", "INTEGER NOT NULL DEFAULT 0")

    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_chat_channel (
            id TEXT PRIMARY KEY,
            league_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(league_id, kind)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_channel_league ON league_chat_channel(league_id)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_chat_message (
            id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            author_sub TEXT NOT NULL,
            team_id TEXT,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_message_channel ON league_chat_message(channel_id, created_at)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS fa_bid (
            id TEXT PRIMARY KEY,
            league_id TEXT NOT NULL,
            team_id TEXT NOT NULL,
            player_id TEXT NOT NULL,
            player_name TEXT,
            nfl_team TEXT,
            position TEXT,
            bid_amount REAL NOT NULL,
            window_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            user_sub TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(league_id, team_id, player_id, window_id)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fa_bid_window ON fa_bid(league_id, window_id, status)"
    )
    _safe_add_column(conn, "hub_workspace", "prefs_json", "TEXT")
    _safe_add_column(conn, "team", "identity_json", "TEXT")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS hub_media (
            id TEXT PRIMARY KEY,
            owner_sub TEXT NOT NULL,
            league_id TEXT,
            team_id TEXT,
            kind TEXT NOT NULL,
            content_type TEXT NOT NULL,
            filename TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_hub_media_team ON hub_media(team_id, kind)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS week_poll (
            id TEXT PRIMARY KEY,
            league_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            poll_key TEXT NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(league_id, season, week, poll_key)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_week_poll_league ON week_poll(league_id, season, week)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS week_poll_vote (
            poll_id TEXT NOT NULL,
            voter_team_id TEXT NOT NULL,
            nominee_team_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (poll_id, voter_team_id)
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS matchup_emote (
            id TEXT PRIMARY KEY,
            league_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            from_team_id TEXT NOT NULL,
            to_team_id TEXT NOT NULL,
            emote_key TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(league_id, season, week, from_team_id, to_team_id)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_matchup_emote_week ON matchup_emote(league_id, season, week)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_week_matchup (
            league_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            matchup_id TEXT NOT NULL,
            home_team_id TEXT NOT NULL,
            away_team_id TEXT,
            PRIMARY KEY (league_id, season, week, matchup_id)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_week_matchup_league "
        "ON league_week_matchup(league_id, season, week)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_week_lineup (
            league_id TEXT NOT NULL,
            team_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            player_id TEXT NOT NULL,
            slot TEXT NOT NULL,
            lineup_role TEXT NOT NULL,
            player_name TEXT,
            nfl_team TEXT,
            position TEXT,
            locked INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (league_id, team_id, season, week, player_id)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_week_lineup_team "
        "ON league_week_lineup(league_id, team_id, season, week)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_player_week_score (
            league_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            player_id TEXT NOT NULL,
            team_id TEXT NOT NULL,
            slot TEXT,
            lineup_role TEXT,
            points REAL NOT NULL DEFAULT 0,
            stats_json TEXT,
            scored_at TEXT NOT NULL,
            PRIMARY KEY (league_id, season, week, player_id)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_player_week_score "
        "ON league_player_week_score(league_id, season, week)"
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS league_team_week_score (
            league_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            team_id TEXT NOT NULL,
            matchup_id TEXT,
            points REAL NOT NULL DEFAULT 0,
            scored_at TEXT NOT NULL,
            PRIMARY KEY (league_id, season, week, team_id)
        )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_team_week_score "
        "ON league_team_week_score(league_id, season, week)"
    )


_DB_INITIALIZED = False
_DB_INIT_LOCK = threading.Lock()


def _init_db(conn: sqlite3.Connection) -> None:
    global _DB_INITIALIZED
    if _DB_INITIALIZED:
        return
    with _DB_INIT_LOCK:
        if _DB_INITIALIZED:
            return
        conn.executescript(_SCHEMA)
        _migrate(conn)
        _DB_INITIALIZED = True


def _rules_to_json(rules: LeagueRules) -> str:
    return json.dumps(rules.model_dump())


def _rules_from_json(raw: str) -> LeagueRules:
    return LeagueRules.model_validate(json.loads(raw))


def current_nfl_season(now: datetime | None = None) -> int:
    """Calendar year of the regular season. Jan–Feb stay on the previous year."""
    dt = now or datetime.now(timezone.utc)
    if dt.month < 3:
        return dt.year - 1
    return dt.year


def get_or_create_workspace(user_sub: str, season: int | None = None) -> dict[str, Any]:
    if season is None:
        season = current_nfl_season()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM hub_workspace WHERE user_sub = ? ORDER BY updated_at DESC LIMIT 1",
            (user_sub,),
        ).fetchone()
        if row:
            return _workspace_dict(row)
        rules = load_preset("salary_cap_auction_v1")
        ws_id = str(uuid.uuid4())
        now = _utcnow()
        conn.execute(
            """INSERT INTO hub_workspace (id, user_sub, name, season, rules_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (ws_id, user_sub, "My League Prep", season, _rules_to_json(rules), now, now),
        )
        row = conn.execute("SELECT * FROM hub_workspace WHERE id = ?", (ws_id,)).fetchone()
        return _workspace_dict(row)


def get_workspace_by_id(workspace_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM hub_workspace WHERE id = ?", (workspace_id,)).fetchone()
        return _workspace_dict(row) if row else None


def update_workspace(user_sub: str, *, name: str | None = None, season: int | None = None,
                     rules: LeagueRules | None = None, preset_id: str | None = None) -> dict[str, Any]:
    ws = get_or_create_workspace(user_sub, season if season is not None else current_nfl_season())
    if preset_id:
        rules = load_preset(preset_id)
    updates: list[str] = []
    params: list[Any] = []
    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if season is not None:
        updates.append("season = ?")
        params.append(season)
    if rules is not None:
        updates.append("rules_json = ?")
        params.append(_rules_to_json(rules))
    if not updates:
        return ws
    updates.append("updated_at = ?")
    params.append(_utcnow())
    params.append(ws["id"])
    with get_conn() as conn:
        conn.execute(f"UPDATE hub_workspace SET {', '.join(updates)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM hub_workspace WHERE id = ?", (ws["id"],)).fetchone()
        return _workspace_dict(row)


def sleeper_link_from_workspace(ws: dict[str, Any]) -> dict[str, Any]:
    return {
        "sleeper_league_id": ws.get("sleeper_league_id"),
        "sleeper_roster_id": ws.get("sleeper_roster_id"),
        "sleeper_team_name": ws.get("sleeper_team_name"),
        "sleeper_player_ids": ws.get("sleeper_player_ids") or [],
        "sleeper_native_ids": ws.get("sleeper_native_ids") or [],
        "sleeper_mapping": ws.get("sleeper_mapping") or [],
        "sleeper_synced_at": ws.get("sleeper_synced_at"),
    }


def update_sleeper_link(
    user_sub: str,
    *,
    sleeper_league_id: str | None = None,
    sleeper_roster_id: str | None = None,
    sleeper_team_name: str | None = None,
    sleeper_player_ids: list[str] | None = None,
    sleeper_native_ids: list[str] | None = None,
    sleeper_mapping: list[dict[str, Any]] | None = None,
    clear: bool = False,
) -> dict[str, Any]:
    ws = get_or_create_workspace(user_sub)
    now = _utcnow()
    if clear:
        with get_conn() as conn:
            conn.execute(
                """UPDATE hub_workspace SET
                   sleeper_league_id = NULL, sleeper_roster_id = NULL,
                   sleeper_team_name = NULL, sleeper_player_ids_json = NULL,
                   sleeper_mapping_json = NULL,
                   sleeper_synced_at = NULL, updated_at = ?
                   WHERE id = ?""",
                (now, ws["id"]),
            )
            row = conn.execute("SELECT * FROM hub_workspace WHERE id = ?", (ws["id"],)).fetchone()
            return _workspace_dict(row)

    updates: list[str] = []
    params: list[Any] = []
    if sleeper_league_id is not None:
        updates.append("sleeper_league_id = ?")
        params.append(sleeper_league_id)
    if sleeper_roster_id is not None:
        updates.append("sleeper_roster_id = ?")
        params.append(sleeper_roster_id)
    if sleeper_team_name is not None:
        updates.append("sleeper_team_name = ?")
        params.append(sleeper_team_name)
    if sleeper_player_ids is not None:
        updates.append("sleeper_player_ids_json = ?")
        params.append(json.dumps(sleeper_player_ids))
        updates.append("sleeper_synced_at = ?")
        params.append(now)
    if sleeper_mapping is not None:
        updates.append("sleeper_mapping_json = ?")
        params.append(json.dumps(sleeper_mapping))
    if sleeper_native_ids is not None:
        pass  # stored inside mapping; kept for API clarity
    if not updates:
        return ws
    updates.append("updated_at = ?")
    params.append(now)
    params.append(ws["id"])
    with get_conn() as conn:
        conn.execute(f"UPDATE hub_workspace SET {', '.join(updates)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM hub_workspace WHERE id = ?", (ws["id"],)).fetchone()
        return _workspace_dict(row)


def _workspace_dict(row: sqlite3.Row) -> dict[str, Any]:
    player_ids: list[str] = []
    mapping: list[dict] = []
    keys = row.keys()
    raw = row["sleeper_player_ids_json"] if "sleeper_player_ids_json" in keys else None
    if raw:
        try:
            player_ids = json.loads(raw)
        except json.JSONDecodeError:
            player_ids = []
    raw_map = row["sleeper_mapping_json"] if "sleeper_mapping_json" in keys else None
    if raw_map:
        try:
            mapping = json.loads(raw_map)
        except json.JSONDecodeError:
            mapping = []
    native_ids = [m.get("sleeper_player_id") for m in mapping if m.get("sleeper_player_id")]
    return {
        "id": row["id"],
        "user_sub": row["user_sub"],
        "name": row["name"],
        "season": row["season"],
        "rules": _rules_from_json(row["rules_json"]).model_dump(),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "sleeper_league_id": row["sleeper_league_id"] if "sleeper_league_id" in keys else None,
        "sleeper_roster_id": row["sleeper_roster_id"] if "sleeper_roster_id" in keys else None,
        "sleeper_team_name": row["sleeper_team_name"] if "sleeper_team_name" in keys else None,
        "sleeper_player_ids": player_ids,
        "sleeper_native_ids": native_ids,
        "sleeper_mapping": mapping,
        "sleeper_synced_at": row["sleeper_synced_at"] if "sleeper_synced_at" in keys else None,
        "active_league_id": row["active_league_id"] if "active_league_id" in keys else None,
        "prefs": _prefs_from_row(row, keys),
    }


def _roster_dict(row: sqlite3.Row, *, default_step: float | None = None) -> dict[str, Any]:
    from src.draft_hub.contracts import repair_flat_deal_schedule

    d = dict(row)
    if d.get("contract_json"):
        try:
            step = default_step
            if step is None:
                ws_id = d.get("workspace_id")
                if ws_id:
                    with get_conn() as conn:
                        step = float(
                            _rules_for_roster_workspace(conn, str(ws_id)).contracts.extension_step_up
                        )
                else:
                    step = 5.0
            d["contract"] = repair_flat_deal_schedule(
                json.loads(d["contract_json"]),
                default_step=float(step),
            )
        except json.JSONDecodeError:
            d["contract"] = None
    else:
        d["contract"] = None
    if "roster_status" not in d or not d.get("roster_status"):
        d["roster_status"] = "active"
    return d


def _extension_step_for_workspace(conn: sqlite3.Connection, workspace_id: str) -> float:
    return float(_rules_for_roster_workspace(conn, workspace_id).contracts.extension_step_up)


def get_workspace_rules(user_sub: str) -> LeagueRules:
    ws = get_or_create_workspace(user_sub)
    return LeagueRules.model_validate(ws["rules"])


def _rules_for_roster_workspace(conn: sqlite3.Connection, workspace_id: str) -> LeagueRules:
    """League rules when the workspace is shared; otherwise personal workspace rules."""
    league = conn.execute(
        "SELECT rules_json FROM league WHERE workspace_id = ? LIMIT 1",
        (workspace_id,),
    ).fetchone()
    if league and league["rules_json"]:
        return _rules_from_json(league["rules_json"])
    ws = conn.execute(
        "SELECT rules_json FROM hub_workspace WHERE id = ?",
        (workspace_id,),
    ).fetchone()
    if ws and ws["rules_json"]:
        return _rules_from_json(ws["rules_json"])
    return LeagueRules()


def upsert_salary_ranges(workspace_id: str, rows: list[dict[str, Any]]) -> int:
    count = 0
    with get_conn() as conn:
        for r in rows:
            conn.execute(
                """INSERT INTO salary_range
                   (workspace_id, player_id, player_name, team, position, min_sal, max_sal, source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(workspace_id, player_id) DO UPDATE SET
                     player_name=excluded.player_name, team=excluded.team, position=excluded.position,
                     min_sal=excluded.min_sal, max_sal=excluded.max_sal, source=excluded.source""",
                (
                    workspace_id,
                    r["player_id"],
                    r.get("player_name"),
                    r.get("team"),
                    r.get("position"),
                    r["min_sal"],
                    r["max_sal"],
                    r.get("source", "import"),
                ),
            )
            count += 1
    return count


def list_salary_ranges(workspace_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM salary_range WHERE workspace_id = ?",
            (workspace_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def clear_model_salary_ranges(workspace_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM salary_range WHERE workspace_id = ? AND source = 'model'",
            (workspace_id,),
        )


def list_roster(workspace_id: str, team_id: str | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if team_id:
            rows = conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? AND team_id = ?",
                (workspace_id, team_id),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? AND (team_id IS NULL OR team_id = '')",
                (workspace_id,),
            ).fetchall()
        step = _extension_step_for_workspace(conn, workspace_id)
    return [_roster_dict(r, default_step=step) for r in rows]


def add_roster_slot(workspace_id: str, row: dict[str, Any], team_id: str | None = None) -> dict[str, Any]:
    contract = row.get("contract")
    contract_json = json.dumps(contract) if contract else None
    source = row.get("source") or "manual"
    roster_status = str(row.get("roster_status") or "active")
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO roster_slot
               (workspace_id, team_id, player_id, player_name, team, position, salary, contract_years,
                acquired_at, sleeper_player_id, source, contract_json, roster_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(workspace_id, player_id) DO UPDATE SET
                 team_id=excluded.team_id, player_name=excluded.player_name, team=excluded.team,
                 position=excluded.position, salary=excluded.salary, contract_years=excluded.contract_years,
                 sleeper_player_id=excluded.sleeper_player_id, source=excluded.source,
                 contract_json=excluded.contract_json, roster_status=excluded.roster_status""",
            (
                workspace_id,
                team_id,
                row["player_id"],
                row.get("player_name"),
                row.get("team"),
                row["position"],
                row["salary"],
                row.get("contract_years", 1),
                _utcnow(),
                row.get("sleeper_player_id"),
                source,
                contract_json,
                roster_status,
            ),
        )
        r = conn.execute(
            "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
            (workspace_id, row["player_id"]),
        ).fetchone()
        _bump_live_for_workspace_conn(conn, workspace_id)
        return _roster_dict(r)


def update_roster_slot(
    workspace_id: str,
    player_id: str,
    *,
    team_id: str | None = None,
    salary: float | None = None,
    contract_years: int | None = None,
    contract: dict[str, Any] | None = None,
    roster_status: str | None = None,
    any_team: bool = False,
    edited_by_sub: str | None = None,
    note: str | None = None,
    allow_zero_years: bool = False,
) -> dict[str, Any]:
    with get_conn() as conn:
        if any_team:
            row = conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
                (workspace_id, player_id),
            ).fetchone()
        elif team_id:
            row = conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ? AND team_id = ?",
                (workspace_id, player_id, team_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ? AND (team_id IS NULL OR team_id = '')",
                (workspace_id, player_id),
            ).fetchone()
        if not row:
            raise ValueError("Player not on roster")
        prior = _roster_dict(row)
        sal = float(salary) if salary is not None else float(row["salary"])
        yrs = int(contract_years) if contract_years is not None else int(row["contract_years"])
        # Use `is not None` so an empty dict still writes (truthy check would skip).
        if contract is not None:
            contract_json = json.dumps(contract)
            sal = float(contract.get("current_salary") or contract.get("base_salary") or sal)
            yrs = int(contract.get("years_remaining") if contract.get("years_remaining") is not None else yrs)
        else:
            contract_json = row["contract_json"]
        effective_status = str(
            roster_status if roster_status is not None else (prior.get("roster_status") or "active")
        )
        # SCORE-45: archived expired contracts may store years_remaining=0.
        zero_ok = allow_zero_years or effective_status == "expired"
        if yrs < 1 and not zero_ok:
            raise ValueError("Contract years must be at least 1")
        if yrs < 0:
            raise ValueError("Contract years cannot be negative")
        updates = ["salary = ?", "contract_years = ?", "contract_json = ?"]
        params: list[Any] = [sal, yrs, contract_json]
        if roster_status is not None:
            updates.append("roster_status = ?")
            params.append(roster_status)
        params.append(row["id"])
        conn.execute(
            f"UPDATE roster_slot SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        updated = conn.execute("SELECT * FROM roster_slot WHERE id = ?", (row["id"],)).fetchone()
        after = _roster_dict(updated)
        bumped = _bump_live_for_workspace_conn(conn, workspace_id)
        if edited_by_sub and bumped:
            changes: list[tuple[str, Any, Any]] = []
            if float(prior.get("salary") or 0) != float(after.get("salary") or 0):
                changes.append(("salary", prior.get("salary"), after.get("salary")))
            if int(prior.get("contract_years") or 0) != int(after.get("contract_years") or 0):
                changes.append(
                    ("contract_years", prior.get("contract_years"), after.get("contract_years"))
                )
            prior_ctype = (prior.get("contract") or {}).get("contract_type")
            after_ctype = (after.get("contract") or {}).get("contract_type")
            if prior_ctype != after_ctype:
                changes.append(("contract_type", prior_ctype, after_ctype))
            prior_sched = (prior.get("contract") or {}).get("salary_schedule")
            after_sched = (after.get("contract") or {}).get("salary_schedule")
            if prior_sched != after_sched:
                changes.append(("salary_schedule", prior_sched, after_sched))
            if str(prior.get("roster_status") or "") != str(after.get("roster_status") or ""):
                changes.append(
                    ("roster_status", prior.get("roster_status"), after.get("roster_status"))
                )
            if changes:
                for lid, rev in bumped:
                    _record_roster_edits_conn(
                        conn,
                        league_id=lid,
                        roster_slot_id=int(row["id"]),
                        player_id=str(player_id),
                        changes=changes,
                        edited_by_sub=edited_by_sub,
                        note=note,
                        live_revision=rev,
                    )
        return after


def set_roster_contract_type(
    workspace_id: str,
    player_id: str,
    contract_type: str,
    *,
    team_id: str | None = None,
    any_team: bool = False,
    manual: bool = True,
    pending_type: str | None = None,
    pending_by: str | None = None,
    edited_by_sub: str | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    """Set contract_type on a roster row by primary key (avoids duplicate-row races)."""
    from datetime import datetime, timezone

    with get_conn() as conn:
        row = None
        # Prefer the caller's team row when duplicates exist.
        if team_id:
            row = conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ? AND team_id = ?",
                (workspace_id, player_id, team_id),
            ).fetchone()
        if row is None and any_team:
            row = conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
                (workspace_id, player_id),
            ).fetchone()
        if row is None and not team_id:
            row = conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ? AND (team_id IS NULL OR team_id = '')",
                (workspace_id, player_id),
            ).fetchone()
        if row is None and not any_team:
            # Last resort for league edits when team_id was wrong/missing.
            row = conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
                (workspace_id, player_id),
            ).fetchone()
        if not row:
            raise ValueError("Player not on roster")

        prior: dict[str, Any] = {}
        if row["contract_json"]:
            try:
                prior = json.loads(row["contract_json"]) or {}
            except json.JSONDecodeError:
                prior = {}
        prior_type = prior.get("contract_type")

        if pending_type:
            contract = dict(prior)
            contract["pending_type"] = pending_type
            contract["pending_type_by"] = pending_by
            contract["pending_type_at"] = datetime.now(timezone.utc).isoformat()
            if "years_remaining" not in contract:
                contract["years_remaining"] = int(row["contract_years"] or 1)
            if "current_salary" not in contract:
                contract["current_salary"] = float(row["salary"] or 0)
        else:
            # Rebuild schedule for the new type (rookies flat; vets/extensions step).
            from src.draft_hub.contract_typing import apply_type_to_contract

            rules = _rules_for_roster_workspace(conn, workspace_id)
            row_dict = _roster_dict(row)
            contract = apply_type_to_contract(
                rules,
                row_dict,
                contract_type=str(contract_type),
                manual=manual,
                clear_pending=True,
            )

        contract_json = json.dumps(contract)
        yrs = int(contract.get("years_remaining") or row["contract_years"] or 1)
        sal = float(contract.get("current_salary") or row["salary"] or 0)
        conn.execute(
            "UPDATE roster_slot SET contract_json = ?, contract_years = ?, salary = ? WHERE id = ?",
            (contract_json, yrs, sal, row["id"]),
        )
        updated = conn.execute("SELECT * FROM roster_slot WHERE id = ?", (row["id"],)).fetchone()
        after = _roster_dict(updated)
        bumped = _bump_live_for_workspace_conn(conn, workspace_id)
        audit_sub = edited_by_sub or pending_by
        if audit_sub and bumped:
            field = "pending_type" if pending_type else "contract_type"
            new_val = pending_type or contract.get("contract_type")
            for lid, rev in bumped:
                _record_roster_edits_conn(
                    conn,
                    league_id=lid,
                    roster_slot_id=int(row["id"]),
                    player_id=str(player_id),
                    changes=[(field, prior_type, new_val)],
                    edited_by_sub=str(audit_sub),
                    note=note,
                    live_revision=rev,
                )
        return after


def remove_roster_by_source(workspace_id: str, source: str, team_id: str | None = None) -> int:
    with get_conn() as conn:
        if team_id:
            cur = conn.execute(
                "DELETE FROM roster_slot WHERE workspace_id = ? AND source = ? AND team_id = ?",
                (workspace_id, source, team_id),
            )
        else:
            cur = conn.execute(
                "DELETE FROM roster_slot WHERE workspace_id = ? AND source = ?",
                (workspace_id, source),
            )
        return cur.rowcount


def is_scoresense_player_id(player_id: str) -> bool:
    pid = str(player_id or "").strip()
    if _GSIS_PLAYER_ID.match(pid):
        return True
    return pid.startswith("sleeper-") and pid[8:].isdigit()


def prune_solo_roster_junk(workspace_id: str) -> int:
    """Remove polluted solo rows from bad Sleeper imports (numeric ids, DEF/K, etc.)."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, player_id, position, source FROM roster_slot
               WHERE workspace_id = ? AND (team_id IS NULL OR team_id = '')""",
            (workspace_id,),
        ).fetchall()
        drop_ids: list[int] = []
        for row in rows:
            pid = str(row["player_id"] or "")
            pos = str(row["position"] or "").upper()
            source = str(row["source"] or "manual")
            if not is_scoresense_player_id(pid):
                drop_ids.append(row["id"])
                continue
            if source in ("manual", "sleeper") and pos not in _CAP_SKILL_POSITIONS:
                drop_ids.append(row["id"])
        if not drop_ids:
            return 0
        placeholders = ",".join("?" * len(drop_ids))
        cur = conn.execute(
            f"DELETE FROM roster_slot WHERE id IN ({placeholders})",
            drop_ids,
        )
        return cur.rowcount


def remove_solo_placeholder_imports(
    workspace_id: str,
    *,
    preserve_sources: frozenset[str] = frozenset({"sheet"}),
    preserve_player_ids: set[str] | None = None,
) -> int:
    """Drop $1 placeholder solo rows from legacy bulk Sleeper imports."""
    keep_ids = preserve_player_ids or set()
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, player_id, salary, contract_years, source, contract_json FROM roster_slot
               WHERE workspace_id = ? AND (team_id IS NULL OR team_id = '')""",
            (workspace_id,),
        ).fetchall()
        drop_ids: list[int] = []
        for row in rows:
            source = str(row["source"] or "manual")
            if source in preserve_sources:
                continue
            pid = str(row["player_id"] or "")
            if pid in keep_ids:
                continue
            if float(row["salary"]) != 1.0:
                continue
            if int(row["contract_years"] or 1) != 1:
                continue
            if row["contract_json"]:
                continue
            drop_ids.append(row["id"])
        if not drop_ids:
            return 0
        placeholders = ",".join("?" * len(drop_ids))
        cur = conn.execute(
            f"DELETE FROM roster_slot WHERE id IN ({placeholders})",
            drop_ids,
        )
        return cur.rowcount


def remove_roster_slot(workspace_id: str, player_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
            (workspace_id, player_id),
        )
        return cur.rowcount > 0


def extend_contract(workspace_id: str, player_id: str, extension_years: int,
                    new_salary: float | None = None, contract: dict | None = None) -> dict[str, Any] | None:
    with get_conn() as conn:
        slot = conn.execute(
            "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
            (workspace_id, player_id),
        ).fetchone()
        if not slot:
            return None
        if contract:
            sal = float(contract.get("current_salary") or contract.get("base_salary") or slot["salary"])
            yrs = int(contract.get("years_remaining") or extension_years)
            conn.execute(
                "UPDATE roster_slot SET contract_years = ?, salary = ?, contract_json = ? WHERE id = ?",
                (yrs, sal, json.dumps(contract), slot["id"]),
            )
        else:
            new_years = int(slot["contract_years"]) + extension_years
            sal = new_salary if new_salary is not None else slot["salary"]
            conn.execute(
                "UPDATE roster_slot SET contract_years = ?, salary = ? WHERE id = ?",
                (new_years, sal, slot["id"]),
            )
        conn.execute(
            """INSERT INTO contract_extension (roster_slot_id, extension_years, new_salary, created_at)
               VALUES (?, ?, ?, ?)""",
            (slot["id"], extension_years, new_salary, _utcnow()),
        )
        r = conn.execute("SELECT * FROM roster_slot WHERE id = ?", (slot["id"],)).fetchone()
        return _roster_dict(r)


# --- Phase B: League / draft ---

def _gen_room_code(conn: sqlite3.Connection) -> str:
    import random
    import string
    for _ in range(50):
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        exists = conn.execute("SELECT 1 FROM league WHERE room_code = ?", (code,)).fetchone()
        if not exists:
            return code
    return str(uuid.uuid4())[:6].upper()


def create_league(commissioner_sub: str, name: str, season: int, rules: LeagueRules,
                  team_count: int = 12, workspace_id: str | None = None,
                  commissioner_team_name: str = "Commissioner",
                  *, test_mode: bool = False) -> dict[str, Any]:
    league_id = str(uuid.uuid4())
    now = _utcnow()
    comm_ws = None
    sleeper_league_id = None
    if test_mode:
        workspace_id = None
    elif workspace_id is None:
        comm_ws = get_or_create_workspace(commissioner_sub, season)
        workspace_id = comm_ws["id"]
        sleeper_league_id = comm_ws.get("sleeper_league_id")
    else:
        comm_ws = get_or_create_workspace(commissioner_sub, season)
        sleeper_league_id = comm_ws.get("sleeper_league_id")
    with get_conn() as conn:
        room_code = _gen_room_code(conn)
        claim_token = _new_claim_token()
        conn.execute(
            """INSERT INTO league (id, workspace_id, commissioner_sub, name, season, rules_json, room_code, status, team_count, created_at, sleeper_league_id, test_mode, claim_token, claim_link_enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'setup', ?, ?, ?, ?, ?, 1)""",
            (
                league_id,
                workspace_id,
                commissioner_sub,
                name,
                season,
                _rules_to_json(rules),
                room_code,
                team_count,
                now,
                sleeper_league_id,
                1 if test_mode else 0,
                claim_token,
            ),
        )
        team_id = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO team (id, league_id, user_sub, name, budget_remaining, is_commissioner, joined_at,
               sleeper_roster_id, sleeper_team_name, sleeper_player_ids_json, sleeper_synced_at)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)""",
            (
                team_id,
                league_id,
                commissioner_sub,
                commissioner_team_name,
                rules.salary_cap,
                now,
                None if test_mode else (comm_ws or {}).get("sleeper_roster_id"),
                None if test_mode else (comm_ws or {}).get("sleeper_team_name"),
                None if test_mode else (json.dumps((comm_ws or {}).get("sleeper_player_ids") or []) if comm_ws else None),
                None if test_mode else (comm_ws or {}).get("sleeper_synced_at"),
            ),
        )
        session_id = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO draft_session (id, league_id, status) VALUES (?, ?, 'setup')""",
            (session_id, league_id),
        )
        row = conn.execute("SELECT * FROM league WHERE id = ?", (league_id,)).fetchone()
        return _league_dict(row)


def join_league(user_sub: str, room_code: str, team_name: str) -> dict[str, Any]:
    clean_name = str(team_name or "").strip()
    if not clean_name:
        raise ValueError("Team name is required")
    with get_conn() as conn:
        league = conn.execute(
            "SELECT * FROM league WHERE room_code = ?",
            (room_code.upper(),),
        ).fetchone()
        if not league:
            raise ValueError("Invalid room code")
        if league["status"] not in ("setup",):
            raise ValueError("League draft already started")
        existing = conn.execute(
            "SELECT * FROM team WHERE league_id = ? AND user_sub = ?",
            (league["id"], user_sub),
        ).fetchone()
        if existing:
            return _team_dict(existing)
        named = conn.execute(
            """SELECT * FROM team
               WHERE league_id = ? AND LOWER(name) = LOWER(?)
                 AND COALESCE(is_bot, 0) = 0""",
            (league["id"], clean_name),
        ).fetchone()
        if named:
            if named["user_sub"] and str(named["user_sub"]) != str(user_sub):
                raise ValueError(f"Team '{named['name']}' is already claimed")
            now = _utcnow()
            conn.execute(
                """UPDATE team SET user_sub = ?, joined_at = COALESCE(joined_at, ?)
                   WHERE id = ?""",
                (user_sub, now, named["id"]),
            )
            row = conn.execute("SELECT * FROM team WHERE id = ?", (named["id"],)).fetchone()
            return _team_dict(row)
        team_count = conn.execute(
            "SELECT COUNT(*) AS c FROM team WHERE league_id = ?",
            (league["id"],),
        ).fetchone()["c"]
        if team_count >= league["team_count"]:
            raise ValueError("League is full")
        rules = _rules_from_json(league["rules_json"])
        team_id = str(uuid.uuid4())
        now = _utcnow()
        conn.execute(
            """INSERT INTO team (id, league_id, user_sub, name, budget_remaining, is_commissioner, joined_at)
               VALUES (?, ?, ?, ?, ?, 0, ?)""",
            (team_id, league["id"], user_sub, clean_name, rules.salary_cap, now),
        )
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(row)


def get_league(league_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM league WHERE id = ?", (league_id,)).fetchone()
        if not row:
            return None
        return _league_dict(row)


def get_league_by_room_code(room_code: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM league WHERE room_code = ?",
            (str(room_code).upper(),),
        ).fetchone()
        if not row:
            return None
        return _league_dict(row)


def list_league_teams(league_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM team WHERE league_id = ? ORDER BY joined_at", (league_id,)).fetchall()
    teams = [_team_dict(r) for r in rows]
    from src.draft_hub.owner_display import attach_owner_names_to_teams

    return attach_owner_names_to_teams(league_id, teams)


def get_draft_session(league_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM draft_session WHERE league_id = ?", (league_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        if d.get("current_nominee_json"):
            from src.draft_hub.jsonutil import json_safe

            d["current_nominee"] = json_safe(json.loads(d["current_nominee_json"]))
        else:
            d["current_nominee"] = None
        if not d.get("pool_mode"):
            d["pool_mode"] = "full"
        if d.get("nomination_order_json"):
            d["nomination_order"] = json.loads(d["nomination_order_json"])
        else:
            d["nomination_order"] = []
        d["paused"] = bool(int(d.get("paused") or 0))
        return d


def list_in_progress_draft_league_ids() -> list[str]:
    """League ids whose draft is nominating, bidding, or picking (for the server ticker)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT league_id FROM draft_session WHERE status IN ('nominating', 'bidding', 'picking')"
        ).fetchall()
    return [str(r["league_id"]) for r in rows]


def _draft_payload_dumps(payload: dict[str, Any] | None) -> str:
    from src.draft_hub.jsonutil import dumps

    return dumps(payload or {})


def append_draft_event(league_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO draft_event (league_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)",
            (league_id, event_type, _draft_payload_dumps(payload), now),
        )
        eid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute("SELECT * FROM draft_event WHERE id = ?", (eid,)).fetchone()
        d = dict(row)
        from src.draft_hub.jsonutil import json_safe

        d["payload"] = json_safe(json.loads(d["payload_json"]))
        return d


def list_draft_events(league_id: str, limit: int = 100) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM draft_event WHERE league_id = ? ORDER BY id DESC LIMIT ?",
            (league_id, limit),
        ).fetchall()
    out = []
    from src.draft_hub.jsonutil import json_safe

    for r in rows:
        d = dict(r)
        d["payload"] = json_safe(json.loads(d["payload_json"]))
        out.append(d)
    return list(reversed(out))


def list_draft_result_events(league_id: str) -> list[dict[str, Any]]:
    """Return the complete ordered pick/win history for reports and recaps.

    Live room event feeds are intentionally bounded, but a full auction creates
    several events per player and can exceed those limits. Post-draft totals
    must therefore query result events directly instead of reading a suffix of
    the general activity log.
    """
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM draft_event
               WHERE league_id = ? AND event_type IN ('win', 'pick')
               ORDER BY id ASC""",
            (league_id,),
        ).fetchall()
    out = []
    from src.draft_hub.jsonutil import json_safe

    for r in rows:
        d = dict(r)
        d["payload"] = json_safe(json.loads(d["payload_json"]))
        out.append(d)
    return out


def update_draft_session(league_id: str, **fields: Any) -> dict[str, Any]:
    allowed = {
        "status", "current_nominee_json", "high_bid", "high_bidder_team_id",
        "nomination_deadline", "bid_deadline", "started_at", "completed_at", "pool_mode",
        "last_bid_at", "nominator_index", "nomination_order_json",
        "paused", "paused_at",
    }
    parts = []
    params: list[Any] = []
    for k, v in fields.items():
        if k not in allowed:
            continue
        parts.append(f"{k} = ?")
        params.append(v)
    if not parts:
        return get_draft_session(league_id) or {}
    params.append(league_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE draft_session SET {', '.join(parts)} WHERE league_id = ?", params)
    return get_draft_session(league_id) or {}


def update_league_status(league_id: str, status: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE league SET status = ? WHERE id = ?", (status, league_id))


def update_team_budget(team_id: str, budget_remaining: float) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE team SET budget_remaining = ? WHERE id = ?", (budget_remaining, team_id))


def _nomination_queue_from_row(row: sqlite3.Row, keys: Any) -> list[str]:
    if "nomination_queue_json" not in keys:
        return []
    raw = row["nomination_queue_json"]
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [str(pid) for pid in parsed if str(pid or "").strip()]


def update_team_draft_prefs(
    team_id: str,
    *,
    nomination_queue: list[str] | None = None,
    autodraft: bool | None = None,
) -> dict[str, Any] | None:
    with get_conn() as conn:
        if nomination_queue is not None:
            conn.execute(
                "UPDATE team SET nomination_queue_json = ? WHERE id = ?",
                (json.dumps([str(pid) for pid in nomination_queue if str(pid or "").strip()]), team_id),
            )
        if autodraft is not None:
            conn.execute(
                "UPDATE team SET autodraft = ? WHERE id = ?",
                (1 if autodraft else 0, team_id),
            )
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(row) if row else None


def list_due_scheduled_drafts(now: datetime | None = None) -> list[tuple[str, str]]:
    """(league_id, commissioner_sub) for live rooms whose scheduled start is due."""
    clock = now or datetime.now(timezone.utc)
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT l.id, l.commissioner_sub, l.draft_starts_at
               FROM league l
               JOIN draft_session s ON s.league_id = l.id
               WHERE l.draft_starts_at IS NOT NULL AND TRIM(l.draft_starts_at) != ''
                 AND COALESCE(l.test_mode, 0) = 0
                 AND COALESCE(l.draft_completed, 0) = 0
                 AND LOWER(COALESCE(l.status, 'setup')) = 'setup'
                 AND LOWER(COALESCE(s.status, 'setup')) = 'setup'"""
        ).fetchall()
    due: list[tuple[str, str]] = []
    for row in rows:
        try:
            when = datetime.fromisoformat(str(row["draft_starts_at"]).replace("Z", "+00:00"))
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            if when.astimezone(timezone.utc) <= clock:
                due.append((str(row["id"]), str(row["commissioner_sub"])))
        except (TypeError, ValueError):
            continue
    return due


def get_team(team_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        team = _team_dict(row) if row else None
    if team and team.get("league_id"):
        from src.draft_hub.owner_display import attach_owner_names_to_teams

        attach_owner_names_to_teams(str(team["league_id"]), [team])
    return team


def get_team_by_user(league_id: str, user_sub: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM team WHERE league_id = ? AND user_sub = ?",
            (league_id, user_sub),
        ).fetchone()
        return _team_dict(row) if row else None


def verify_league_membership(user_sub: str, league_id: str) -> bool:
    """True when user_sub has a team row in the league."""
    if not get_league(league_id):
        return False
    return get_team_by_user(league_id, user_sub) is not None


def list_team_roster(league_id: str, team_id: str) -> list[dict[str, Any]]:
    league = get_league(league_id)
    if not league:
        return []
    ws = roster_workspace_for_league(league)
    return list_roster(ws, team_id)


def transfer_roster_players(
    workspace_id: str,
    player_ids: list[str],
    from_team_id: str,
    to_team_id: str,
) -> int:
    """Move players between teams in a shared workspace. Returns rows updated."""
    if not player_ids:
        return 0
    moved = 0
    with get_conn() as conn:
        for pid in player_ids:
            cur = conn.execute(
                """UPDATE roster_slot SET team_id = ? WHERE workspace_id = ? AND player_id = ? AND team_id = ?""",
                (to_team_id, workspace_id, pid, from_team_id),
            )
            moved += cur.rowcount
        if moved:
            _bump_live_for_workspace_conn(conn, workspace_id)
    return moved


def log_league_trade(
    league_id: str,
    *,
    team_a_id: str,
    team_b_id: str,
    send_a: list[str],
    send_b: list[str],
    proposal_id: str | None = None,
    parties: list[dict[str, Any]] | None = None,
    dead_cap_assignments: list[dict[str, Any]] | None = None,
) -> None:
    payload_extra = {
        "proposal_id": proposal_id,
        "parties": parties,
        "dead_cap_assignments": dead_cap_assignments,
    }
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO trade_log (league_id, team_a_id, team_b_id, send_a_json, send_b_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                league_id,
                team_a_id,
                team_b_id,
                json.dumps({"players": send_a, **({k: v for k, v in payload_extra.items() if v is not None})}),
                json.dumps(send_b),
                _utcnow(),
            ),
        )


def _proposal_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "league_id": row["league_id"],
        "created_by_sub": row["created_by_sub"],
        "status": row["status"],
        "parties": json.loads(row["parties_json"] or "[]"),
        "dead_cap_assignments": json.loads(row["dead_cap_assignments_json"] or "[]"),
        "acceptances": json.loads(row["acceptances_json"] or "{}"),
        "note": row["note"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def create_trade_proposal(
    league_id: str,
    *,
    created_by_sub: str,
    parties: list[dict[str, Any]],
    dead_cap_assignments: list[dict[str, Any]] | None = None,
    acceptances: dict[str, str] | None = None,
    note: str | None = None,
    status: str = "pending",
) -> dict[str, Any]:
    pid = str(uuid.uuid4())
    now = _utcnow()
    team_ids = [str(p["team_id"]) for p in parties]
    acc = dict(acceptances) if acceptances is not None else {tid: "pending" for tid in team_ids}
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO trade_proposal
               (id, league_id, created_by_sub, status, parties_json, dead_cap_assignments_json,
                acceptances_json, note, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                pid,
                league_id,
                created_by_sub,
                status,
                json.dumps(parties),
                json.dumps(dead_cap_assignments or []),
                json.dumps(acc),
                note,
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM trade_proposal WHERE id = ?", (pid,)).fetchone()
        return _proposal_dict(row)


def get_trade_proposal(proposal_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM trade_proposal WHERE id = ?", (proposal_id,)).fetchone()
        return _proposal_dict(row) if row else None


def list_trade_proposals(league_id: str, *, status: str | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if status:
            rows = conn.execute(
                """SELECT * FROM trade_proposal WHERE league_id = ? AND status = ?
                   ORDER BY created_at DESC""",
                (league_id, status),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM trade_proposal WHERE league_id = ?
                   ORDER BY created_at DESC LIMIT 100""",
                (league_id,),
            ).fetchall()
        return [_proposal_dict(r) for r in rows]


def update_trade_proposal(
    proposal_id: str,
    *,
    status: str | None = None,
    acceptances: dict[str, str] | None = None,
    parties: list[dict[str, Any]] | None = None,
    dead_cap_assignments: list[dict[str, Any]] | None = None,
    note: str | None = None,
) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM trade_proposal WHERE id = ?", (proposal_id,)).fetchone()
        if not row:
            return None
        updates: list[str] = ["updated_at = ?"]
        params: list[Any] = [_utcnow()]
        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if acceptances is not None:
            updates.append("acceptances_json = ?")
            params.append(json.dumps(acceptances))
        if parties is not None:
            updates.append("parties_json = ?")
            params.append(json.dumps(parties))
        if dead_cap_assignments is not None:
            updates.append("dead_cap_assignments_json = ?")
            params.append(json.dumps(dead_cap_assignments))
        if note is not None:
            updates.append("note = ?")
            params.append(note)
        params.append(proposal_id)
        conn.execute(f"UPDATE trade_proposal SET {', '.join(updates)} WHERE id = ?", params)
        updated = conn.execute("SELECT * FROM trade_proposal WHERE id = ?", (proposal_id,)).fetchone()
        return _proposal_dict(updated)


def _prefs_from_row(row: sqlite3.Row, keys: Any) -> dict[str, Any]:
    from src.draft_hub.league_atmosphere import merge_atmosphere_prefs

    raw = row["prefs_json"] if "prefs_json" in keys else None
    if not raw:
        return merge_atmosphere_prefs(None)
    try:
        return merge_atmosphere_prefs(json.loads(raw))
    except (TypeError, json.JSONDecodeError):
        return merge_atmosphere_prefs(None)


def _identity_from_row(row: sqlite3.Row, keys: Any) -> dict[str, Any]:
    from src.draft_hub.league_atmosphere import merge_team_identity

    raw = row["identity_json"] if "identity_json" in keys else None
    if not raw:
        return merge_team_identity(None)
    try:
        return merge_team_identity(json.loads(raw))
    except (TypeError, json.JSONDecodeError):
        return merge_team_identity(None)


def _team_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    player_ids: list[str] = []
    raw = row["sleeper_player_ids_json"] if "sleeper_player_ids_json" in keys else None
    if raw:
        try:
            player_ids = json.loads(raw)
        except json.JSONDecodeError:
            player_ids = []
    return {
        "id": row["id"],
        "league_id": row["league_id"],
        "user_sub": row["user_sub"],
        "name": row["name"],
        "budget_remaining": row["budget_remaining"],
        "is_commissioner": bool(row["is_commissioner"]),
        "is_bot": bool(row["is_bot"]) if "is_bot" in keys else False,
        "joined_at": row["joined_at"],
        "sleeper_roster_id": row["sleeper_roster_id"] if "sleeper_roster_id" in keys else None,
        "sleeper_team_name": row["sleeper_team_name"] if "sleeper_team_name" in keys else None,
        "sleeper_player_ids": player_ids,
        "sleeper_synced_at": row["sleeper_synced_at"] if "sleeper_synced_at" in keys else None,
        "nomination_queue": _nomination_queue_from_row(row, keys),
        "autodraft": bool(int(row["autodraft"] or 0)) if "autodraft" in keys else False,
        "draft_slot": _optional_int(row["draft_slot"]) if "draft_slot" in keys else None,
        "is_guest": _is_guest_sub(row["user_sub"] if "user_sub" in keys else None),
        "identity": _identity_from_row(row, keys),
    }


def get_league_membership(
    user_sub: str,
    league_id: str,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """League + team row when user_sub is on that league (includes test leagues)."""
    with get_conn() as conn:
        row = conn.execute(
            """SELECT l.*, t.id AS team_row_id
               FROM team t
               JOIN league l ON l.id = t.league_id
               WHERE t.user_sub = ? AND l.id = ?
                 AND (t.is_bot IS NULL OR t.is_bot = 0)""",
            (user_sub, league_id),
        ).fetchone()
        if not row:
            return None
        league = _league_dict(row)
        team_row = conn.execute("SELECT * FROM team WHERE id = ?", (row["team_row_id"],)).fetchone()
        return league, _team_dict(team_row)


def get_primary_league_membership(user_sub: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Most recently joined real league — practice/test rooms are excluded."""
    with get_conn() as conn:
        row = conn.execute(
            """SELECT l.*, t.id AS team_row_id
               FROM team t
               JOIN league l ON l.id = t.league_id
               WHERE t.user_sub = ? AND (t.is_bot IS NULL OR t.is_bot = 0)
                 AND (l.test_mode IS NULL OR l.test_mode = 0)
               ORDER BY t.joined_at DESC
               LIMIT 1""",
            (user_sub,),
        ).fetchone()
        if not row:
            return None
        league = _league_dict(row)
        team_row = conn.execute("SELECT * FROM team WHERE id = ?", (row["team_row_id"],)).fetchone()
        return league, _team_dict(team_row)


def get_hub_focus_league_id(user_sub: str) -> str | None:
    """active_league_id from workspace: None=auto, HUB_FOCUS_SOLO=solo, else league uuid."""
    ws = get_or_create_workspace(user_sub)
    return ws.get("active_league_id")


def set_hub_focus(user_sub: str, *, league_id: str | None = None, solo: bool = False) -> str | None:
    """Persist which league (or solo prep) the user is working in."""
    ws = get_or_create_workspace(user_sub)
    if solo:
        focus = HUB_FOCUS_SOLO
    elif league_id:
        focus = str(league_id)
    else:
        focus = None
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "UPDATE hub_workspace SET active_league_id = ?, updated_at = ? WHERE id = ?",
            (focus, now, ws["id"]),
        )
    return focus


def resolve_league_membership(user_sub: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Membership for hub context — honors saved focus, else most recent real league."""
    focus = get_hub_focus_league_id(user_sub)
    if focus == HUB_FOCUS_SOLO:
        return None
    if focus:
        membership = get_league_membership(user_sub, focus)
        if membership:
            league, _team = membership
            if not league.get("test_mode"):
                return membership
        set_hub_focus(user_sub, solo=False)
    return get_primary_league_membership(user_sub)


def list_live_memberships_for_sub(user_sub: str) -> list[dict[str, Any]]:
    """League memberships excluding bots and practice/test rooms."""
    out: list[dict[str, Any]] = []
    for row in list_memberships_for_sub(user_sub):
        if row.get("test_mode"):
            continue
        team = row.get("team") or {}
        if team.get("is_bot"):
            continue
        out.append(row)
    return out


def update_league_rules(league_id: str, rules: LeagueRules) -> dict[str, Any] | None:
    if getattr(rules, "relax_salary_roster_limits", False) and not league_test_mode(league_id):
        rules = rules.model_copy(update={"relax_salary_roster_limits": False})
    with get_conn() as conn:
        conn.execute(
            "UPDATE league SET rules_json = ? WHERE id = ?",
            (_rules_to_json(rules), league_id),
        )
        row = conn.execute("SELECT * FROM league WHERE id = ?", (league_id,)).fetchone()
        return _league_dict(row) if row else None


def update_league_season(league_id: str, season: int) -> dict[str, Any] | None:
    """Bump planning season. Advancing the year reopens pre-draft without rewinding contracts.

    Years left are owned by the draft-complete clock — advancing 2025→2026 must not
    reset everyone back to rookie defaults; keepers keep their post-tick lengths.
    """
    with get_conn() as conn:
        prior = conn.execute(
            "SELECT season, draft_completed FROM league WHERE id = ?",
            (league_id,),
        ).fetchone()
        if not prior:
            return None
        new_season = int(season)
        old_season = int(prior["season"] or 0)
        if new_season > old_season:
            conn.execute(
                "UPDATE league SET season = ?, draft_completed = 0 WHERE id = ?",
                (new_season, league_id),
            )
        else:
            conn.execute(
                "UPDATE league SET season = ? WHERE id = ?",
                (new_season, league_id),
            )
        row = conn.execute("SELECT * FROM league WHERE id = ?", (league_id,)).fetchone()
        return _league_dict(row) if row else None


def update_league_name(league_id: str, name: str) -> dict[str, Any] | None:
    clean = str(name or "").strip()
    if not clean:
        raise ValueError("League name is required")
    with get_conn() as conn:
        conn.execute("UPDATE league SET name = ? WHERE id = ?", (clean, league_id))
        row = conn.execute("SELECT * FROM league WHERE id = ?", (league_id,)).fetchone()
        return _league_dict(row) if row else None


def update_league_settings(
    league_id: str,
    *,
    lock_team_claims: bool | None = None,
    draft_completed: bool | None = None,
    draft_starts_at: str | None = None,
    draft_timezone: str | None = None,
    clear_draft_start: bool = False,
    claim_link_enabled: bool | None = None,
) -> dict[str, Any] | None:
    if (
        lock_team_claims is None
        and draft_completed is None
        and draft_starts_at is None
        and draft_timezone is None
        and not clear_draft_start
        and claim_link_enabled is None
    ):
        return get_league(league_id)
    with get_conn() as conn:
        if lock_team_claims is not None:
            conn.execute(
                "UPDATE league SET lock_team_claims = ? WHERE id = ?",
                (1 if lock_team_claims else 0, league_id),
            )
        if claim_link_enabled is not None:
            conn.execute(
                "UPDATE league SET claim_link_enabled = ? WHERE id = ?",
                (1 if claim_link_enabled else 0, league_id),
            )
        if draft_completed is not None:
            conn.execute(
                "UPDATE league SET draft_completed = ? WHERE id = ?",
                (1 if draft_completed else 0, league_id),
            )
        if clear_draft_start:
            conn.execute(
                "UPDATE league SET draft_starts_at = NULL WHERE id = ?",
                (league_id,),
            )
        else:
            if draft_starts_at is not None:
                conn.execute(
                    "UPDATE league SET draft_starts_at = ? WHERE id = ?",
                    (draft_starts_at, league_id),
                )
            if draft_timezone is not None:
                conn.execute(
                    "UPDATE league SET draft_timezone = ? WHERE id = ?",
                    (draft_timezone, league_id),
                )
        row = conn.execute("SELECT * FROM league WHERE id = ?", (league_id,)).fetchone()
        return _league_dict(row) if row else None


def release_team_claim(league_id: str, team_id: str) -> dict[str, Any]:
    """Commissioner clears a team's linked account so it can be re-invited."""
    team = get_team(team_id)
    if not team or team["league_id"] != league_id:
        raise ValueError("Team not found in this league")
    league = get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if str(team.get("user_sub") or "") == str(league.get("commissioner_sub") or ""):
        raise ValueError("Cannot release the primary commissioner team")
    with get_conn() as conn:
        conn.execute(
            """UPDATE team SET user_sub = NULL, joined_at = NULL, is_commissioner = 0
               WHERE id = ? AND league_id = ?""",
            (team_id, league_id),
        )
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(row)


def league_roster_overview(league_id: str) -> dict[str, Any]:
    """All teams, roster rows, and cap totals for commissioner view."""
    league = get_league(league_id)
    if not league:
        raise ValueError("League not found")
    teams = list_league_teams(league_id)
    cap = float(league["rules"]["salary_cap"])
    by_team = list_league_rosters_by_team(league_id)

    if any(len(rows) > 28 for rows in by_team.values()):
        from src.draft_hub.league_sleeper_sync import reconcile_league_roster_assignments

        reconcile_league_roster_assignments(league_id)
        by_team = list_league_rosters_by_team(league_id)

    from src.draft_hub.hub_context import filter_team_sleeper_roster

    team_blocks = []
    for team in teams:
        rows = filter_team_sleeper_roster(team, by_team.get(team["id"], []))
        total = sum(float(r.get("salary") or 0) for r in rows)
        team_blocks.append(
            {
                "team": team,
                "roster": rows,
                "player_count": len(rows),
                "total_salary": round(total, 2),
                "cap_remaining": round(cap - total, 2),
            }
        )
    return {
        "league": league,
        "teams": team_blocks,
        "salary_cap": cap,
    }


def update_team_display_name(team_id: str, name: str) -> dict[str, Any]:
    clean = str(name or "").strip()
    if not clean:
        raise ValueError("Team name is required")
    with get_conn() as conn:
        conn.execute("UPDATE team SET name = ? WHERE id = ?", (clean, team_id))
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(row) if row else {}


def get_workspace_prefs(user_sub: str) -> dict[str, Any]:
    ws = get_or_create_workspace(user_sub)
    return ws.get("prefs") or {}


def update_workspace_prefs(user_sub: str, prefs: dict[str, Any]) -> dict[str, Any]:
    from src.draft_hub.league_atmosphere import merge_atmosphere_prefs

    ws = get_or_create_workspace(user_sub)
    # Partial PATCH: lay incoming keys over stored prefs so toggling one
    # option never resets the others.
    existing = ws.get("prefs") or {}
    merged = merge_atmosphere_prefs({**existing, **(prefs or {})})
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "UPDATE hub_workspace SET prefs_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(merged), now, ws["id"]),
        )
    return merged


def list_league_identities(league_id: str) -> dict[str, dict[str, Any]]:
    return {str(team["id"]): team.get("identity") or {} for team in list_league_teams(league_id)}


def update_team_identity(team_id: str, identity: dict[str, Any]) -> dict[str, Any]:
    from src.draft_hub.league_atmosphere import merge_team_identity

    team = get_team(team_id)
    if not team:
        raise ValueError("Team not found")
    current = team.get("identity") or {}
    incoming = dict(identity or {})
    for key in ("photo_focus", "banner_focus"):
        if isinstance(incoming.get(key), dict):
            prior = current.get(key) if isinstance(current.get(key), dict) else {}
            incoming[key] = {**prior, **incoming[key]}
    merged = merge_team_identity({**current, **incoming})
    with get_conn() as conn:
        conn.execute(
            "UPDATE team SET identity_json = ? WHERE id = ?",
            (json.dumps(merged), team_id),
        )
    updated = get_team(team_id) or {}
    return updated.get("identity") or merged


def _media_dir() -> Path:
    path = DRAFT_HUB_DIR / "media"
    path.mkdir(parents=True, exist_ok=True)
    return path


def store_hub_media(
    *,
    owner_sub: str,
    league_id: str | None,
    team_id: str | None,
    kind: str,
    content_type: str,
    payload: bytes,
) -> dict[str, Any]:
    media_id = str(uuid.uuid4())
    filename = f"{media_id}.bin"
    dest = _media_dir() / filename
    dest.write_bytes(payload)
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO hub_media (
                   id, owner_sub, league_id, team_id, kind, content_type, filename, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (media_id, owner_sub, league_id, team_id, kind, content_type, filename, now),
        )
    return {
        "id": media_id,
        "owner_sub": owner_sub,
        "league_id": league_id,
        "team_id": team_id,
        "kind": kind,
        "content_type": content_type,
        "url": f"/api/hub/media/{media_id}",
        "created_at": now,
    }


def get_hub_media(media_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM hub_media WHERE id = ?", (media_id,)).fetchone()
    if not row:
        return None
    path = _media_dir() / str(row["filename"])
    if not path.exists():
        return None
    return {
        "id": row["id"],
        "owner_sub": row["owner_sub"],
        "league_id": row["league_id"],
        "team_id": row["team_id"],
        "kind": row["kind"],
        "content_type": row["content_type"],
        "path": path,
        "created_at": row["created_at"],
    }


def ensure_week_trophy_polls(league_id: str, season: int, week: int) -> list[dict[str, Any]]:
    from src.draft_hub.league_atmosphere import TROPHY_POLLS

    now = _utcnow()
    with get_conn() as conn:
        existing = conn.execute(
            """SELECT * FROM week_poll
               WHERE league_id = ? AND season = ? AND week = ?
               ORDER BY poll_key""",
            (league_id, int(season), int(week)),
        ).fetchall()
        have = {str(row["poll_key"]) for row in existing}
        for key, meta in TROPHY_POLLS.items():
            if key in have:
                continue
            conn.execute(
                """INSERT OR IGNORE INTO week_poll (id, league_id, season, week, poll_key, title, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (str(uuid.uuid4()), league_id, int(season), int(week), key, meta["title"], now),
            )
        rows = conn.execute(
            """SELECT * FROM week_poll
               WHERE league_id = ? AND season = ? AND week = ?
               ORDER BY poll_key""",
            (league_id, int(season), int(week)),
        ).fetchall()
    return [dict(row) for row in rows]


def get_week_poll(poll_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM week_poll WHERE id = ?", (poll_id,)).fetchone()
    return dict(row) if row else None


def list_week_poll_votes(poll_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM week_poll_vote WHERE poll_id = ?",
            (poll_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def cast_week_poll_vote(poll_id: str, voter_team_id: str, nominee_team_id: str) -> dict[str, Any]:
    now = _utcnow()
    with get_conn() as conn:
        poll = conn.execute("SELECT * FROM week_poll WHERE id = ?", (poll_id,)).fetchone()
        if not poll:
            raise ValueError("Poll not found")
        conn.execute(
            """INSERT INTO week_poll_vote (poll_id, voter_team_id, nominee_team_id, created_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(poll_id, voter_team_id) DO UPDATE SET
                   nominee_team_id = excluded.nominee_team_id,
                   created_at = excluded.created_at""",
            (poll_id, voter_team_id, nominee_team_id, now),
        )
    return {"poll_id": poll_id, "voter_team_id": voter_team_id, "nominee_team_id": nominee_team_id}


def list_week_emotes(league_id: str, season: int, week: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM matchup_emote
               WHERE league_id = ? AND season = ? AND week = ?
               ORDER BY created_at""",
            (league_id, int(season), int(week)),
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_matchup_emote(
    *,
    league_id: str,
    season: int,
    week: int,
    from_team_id: str,
    to_team_id: str,
    emote_key: str,
) -> dict[str, Any]:
    now = _utcnow()
    emote_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO matchup_emote (
                   id, league_id, season, week, from_team_id, to_team_id, emote_key, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(league_id, season, week, from_team_id, to_team_id) DO UPDATE SET
                   emote_key = excluded.emote_key,
                   created_at = excluded.created_at""",
            (emote_id, league_id, int(season), int(week), from_team_id, to_team_id, emote_key, now),
        )
        row = conn.execute(
            """SELECT * FROM matchup_emote
               WHERE league_id = ? AND season = ? AND week = ?
                 AND from_team_id = ? AND to_team_id = ?""",
            (league_id, int(season), int(week), from_team_id, to_team_id),
        ).fetchone()
    return dict(row) if row else {}


def _lineup_row_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["locked"] = bool(int(d.get("locked") or 0))
    d["season"] = int(d.get("season") or 0)
    d["week"] = int(d.get("week") or 0)
    return d


def list_week_matchups(league_id: str, season: int, week: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_week_matchup
               WHERE league_id = ? AND season = ? AND week = ?
               ORDER BY matchup_id""",
            (league_id, int(season), int(week)),
        ).fetchall()
    return [dict(row) for row in rows]


def replace_week_matchups(
    league_id: str,
    season: int,
    week: int,
    pairs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    with get_conn() as conn:
        conn.execute(
            """DELETE FROM league_week_matchup
               WHERE league_id = ? AND season = ? AND week = ?""",
            (league_id, int(season), int(week)),
        )
        for pair in pairs:
            conn.execute(
                """INSERT INTO league_week_matchup (
                       league_id, season, week, matchup_id, home_team_id, away_team_id
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    league_id,
                    int(season),
                    int(week),
                    str(pair["matchup_id"]),
                    str(pair["home_team_id"]),
                    pair.get("away_team_id"),
                ),
            )
    return list_week_matchups(league_id, season, week)


def list_season_matchups(league_id: str, season: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_week_matchup
               WHERE league_id = ? AND season = ?
               ORDER BY week, matchup_id""",
            (league_id, int(season)),
        ).fetchall()
    return [dict(row) for row in rows]


def list_team_lineup(
    league_id: str,
    team_id: str,
    season: int,
    week: int,
) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_week_lineup
               WHERE league_id = ? AND team_id = ? AND season = ? AND week = ?
               ORDER BY lineup_role DESC, slot, player_id""",
            (league_id, team_id, int(season), int(week)),
        ).fetchall()
    return [_lineup_row_dict(row) for row in rows]


def list_week_lineups(league_id: str, season: int, week: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_week_lineup
               WHERE league_id = ? AND season = ? AND week = ?
               ORDER BY team_id, lineup_role DESC, slot, player_id""",
            (league_id, int(season), int(week)),
        ).fetchall()
    return [_lineup_row_dict(row) for row in rows]


def replace_team_lineup(
    league_id: str,
    team_id: str,
    season: int,
    week: int,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            """DELETE FROM league_week_lineup
               WHERE league_id = ? AND team_id = ? AND season = ? AND week = ?""",
            (league_id, team_id, int(season), int(week)),
        )
        for entry in entries:
            conn.execute(
                """INSERT INTO league_week_lineup (
                       league_id, team_id, season, week, player_id, slot, lineup_role,
                       player_name, nfl_team, position, locked, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    league_id,
                    team_id,
                    int(season),
                    int(week),
                    str(entry["player_id"]),
                    str(entry.get("slot") or "BN"),
                    str(entry.get("lineup_role") or "bench"),
                    entry.get("player_name"),
                    entry.get("nfl_team") or entry.get("team"),
                    entry.get("position"),
                    1 if entry.get("locked") else 0,
                    now,
                ),
            )
    return list_team_lineup(league_id, team_id, season, week)


def lock_week_lineups(league_id: str, season: int, week: int) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE league_week_lineup SET locked = 1
               WHERE league_id = ? AND season = ? AND week = ?""",
            (league_id, int(season), int(week)),
        )
        return int(cur.rowcount or 0)


def replace_player_week_scores(
    league_id: str,
    season: int,
    week: int,
    rows: list[dict[str, Any]],
) -> None:
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            """DELETE FROM league_player_week_score
               WHERE league_id = ? AND season = ? AND week = ?""",
            (league_id, int(season), int(week)),
        )
        for row in rows:
            conn.execute(
                """INSERT INTO league_player_week_score (
                       league_id, season, week, player_id, team_id, slot, lineup_role,
                       points, stats_json, scored_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    league_id,
                    int(season),
                    int(week),
                    str(row["player_id"]),
                    str(row["team_id"]),
                    row.get("slot"),
                    row.get("lineup_role"),
                    float(row.get("points") or 0),
                    json.dumps(row.get("stats") or {}),
                    now,
                ),
            )


def list_player_week_scores(league_id: str, season: int, week: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_player_week_score
               WHERE league_id = ? AND season = ? AND week = ?
               ORDER BY team_id, player_id""",
            (league_id, int(season), int(week)),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        raw = item.pop("stats_json", None)
        try:
            item["stats"] = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            item["stats"] = {}
        item["points"] = float(item.get("points") or 0)
        out.append(item)
    return out


def replace_team_week_scores(
    league_id: str,
    season: int,
    week: int,
    rows: list[dict[str, Any]],
) -> None:
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            """DELETE FROM league_team_week_score
               WHERE league_id = ? AND season = ? AND week = ?""",
            (league_id, int(season), int(week)),
        )
        for row in rows:
            conn.execute(
                """INSERT INTO league_team_week_score (
                       league_id, season, week, team_id, matchup_id, points, scored_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    league_id,
                    int(season),
                    int(week),
                    str(row["team_id"]),
                    row.get("matchup_id"),
                    float(row.get("points") or 0),
                    now,
                ),
            )


def list_team_week_scores(league_id: str, season: int, week: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_team_week_score
               WHERE league_id = ? AND season = ? AND week = ?
               ORDER BY team_id""",
            (league_id, int(season), int(week)),
        ).fetchall()
    return [
        {**dict(row), "points": float(row["points"] or 0)}
        for row in rows
    ]


def list_season_team_scores(league_id: str, season: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_team_week_score
               WHERE league_id = ? AND season = ?
               ORDER BY week, team_id""",
            (league_id, int(season)),
        ).fetchall()
    return [
        {**dict(row), "points": float(row["points"] or 0), "week": int(row["week"])}
        for row in rows
    ]


def add_unclaimed_team(league_id: str, name: str, budget: float) -> dict[str, Any]:
    """Create an open human seat that a guest or member can claim later."""
    clean = str(name or "").strip() or "Open seat"
    team_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO team (id, league_id, user_sub, name, budget_remaining, is_commissioner, is_bot, joined_at)
               VALUES (?, ?, NULL, ?, ?, 0, 0, NULL)""",
            (team_id, league_id, clean, float(budget)),
        )
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(row) if row else {}


def update_league_team_count(league_id: str, team_count: int) -> dict[str, Any] | None:
    """Set configured seat count. Does not create or delete team rows."""
    n = int(team_count)
    if n < 2 or n > 20:
        raise ValueError("Team count must be between 2 and 20")
    with get_conn() as conn:
        conn.execute("UPDATE league SET team_count = ? WHERE id = ?", (n, league_id))
        row = conn.execute("SELECT * FROM league WHERE id = ?", (league_id,)).fetchone()
        return _league_dict(row) if row else None


def team_has_week_scores(league_id: str, team_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT 1 FROM league_team_week_score
               WHERE league_id = ? AND team_id = ? LIMIT 1""",
            (league_id, team_id),
        ).fetchone()
        return bool(row)


def cancel_open_fa_bids_for_team(league_id: str, team_id: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE fa_bid SET status = 'cancelled'
               WHERE league_id = ? AND team_id = ? AND status = 'open'""",
            (league_id, team_id),
        )
        return int(cur.rowcount or 0)


def delete_league_team(league_id: str, team_id: str) -> dict[str, Any]:
    """Remove a franchise row and its current roster slots. Historic scores stay."""
    team = get_team(team_id)
    if not team or str(team.get("league_id")) != str(league_id):
        raise ValueError("Team not found in this league")
    league = get_league(league_id)
    if not league:
        raise ValueError("League not found")
    ws = roster_workspace_for_league(league)
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM roster_slot WHERE workspace_id = ? AND team_id = ?",
            (ws, team_id),
        )
        _bump_live_for_workspace_conn(conn, ws)
        conn.execute("DELETE FROM team WHERE id = ? AND league_id = ?", (team_id, league_id))
    return {"deleted_team_id": team_id, "league_id": league_id}


def assign_team_user(
    team_id: str,
    user_sub: str,
    *,
    name: str | None = None,
) -> dict[str, Any]:
    """Claim an existing seat for a user. Sets joined_at if it was empty."""
    clean_sub = str(user_sub or "").strip()
    if not clean_sub:
        raise ValueError("User is required")
    now = _utcnow()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        if not row:
            raise ValueError("Team not found")
        if row["user_sub"] and row["user_sub"] != clean_sub:
            raise ValueError("Team is already claimed by another user")
        clean_name = str(name or row["name"] or "").strip() or str(row["name"] or "Manager")
        joined = row["joined_at"] or now
        conn.execute(
            """UPDATE team SET user_sub = ?, name = ?, joined_at = ?
               WHERE id = ?""",
            (clean_sub, clean_name, joined, team_id),
        )
        updated = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(updated) if updated else {}


def set_team_draft_slot(team_id: str, slot: int | None) -> dict[str, Any]:
    value = None if slot is None else int(slot)
    with get_conn() as conn:
        conn.execute("UPDATE team SET draft_slot = ? WHERE id = ?", (value, team_id))
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(row) if row else {}


def draft_slot_taken(league_id: str, slot: int, *, except_team_id: str | None = None) -> bool:
    with get_conn() as conn:
        if except_team_id:
            row = conn.execute(
                """SELECT id FROM team
                   WHERE league_id = ? AND draft_slot = ? AND id != ?""",
                (league_id, int(slot), except_team_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM team WHERE league_id = ? AND draft_slot = ?",
                (league_id, int(slot)),
            ).fetchone()
        return bool(row)


def set_lobby_notified_at(league_id: str, when: str | None = None) -> None:
    stamp = when or _utcnow()
    with get_conn() as conn:
        conn.execute(
            "UPDATE league SET lobby_notified_at = ? WHERE id = ?",
            (stamp, league_id),
        )


def update_league_sleeper_id(league_id: str, sleeper_league_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE league SET sleeper_league_id = ? WHERE id = ?",
            (sleeper_league_id, league_id),
        )


def set_league_workspace_id(league_id: str, workspace_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE league SET workspace_id = ? WHERE id = ?",
            (workspace_id, league_id),
        )


def update_team_sleeper_link(
    team_id: str,
    *,
    sleeper_roster_id: str | None = None,
    sleeper_team_name: str | None = None,
    sleeper_player_ids: list[str] | None = None,
    clear: bool = False,
) -> dict[str, Any]:
    now = _utcnow()
    with get_conn() as conn:
        if clear:
            conn.execute(
                """UPDATE team SET sleeper_roster_id = NULL, sleeper_team_name = NULL,
                   sleeper_player_ids_json = NULL, sleeper_synced_at = NULL WHERE id = ?""",
                (team_id,),
            )
        else:
            updates: list[str] = []
            params: list[Any] = []
            if sleeper_roster_id is not None:
                updates.append("sleeper_roster_id = ?")
                params.append(sleeper_roster_id)
            if sleeper_team_name is not None:
                updates.append("sleeper_team_name = ?")
                params.append(sleeper_team_name)
            if sleeper_player_ids is not None:
                updates.append("sleeper_player_ids_json = ?")
                params.append(json.dumps(sleeper_player_ids))
                updates.append("sleeper_synced_at = ?")
                params.append(now)
            if updates:
                params.append(team_id)
                conn.execute(f"UPDATE team SET {', '.join(updates)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(row)


def get_roster_slot(workspace_id: str, player_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
            (workspace_id, player_id),
        ).fetchone()
        return _roster_dict(row) if row else None


def list_league_roster(workspace_id: str) -> list[dict[str, Any]]:
    """All roster slots in a shared league workspace (every team)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM roster_slot WHERE workspace_id = ? AND team_id IS NOT NULL AND team_id != ''",
            (workspace_id,),
        ).fetchall()
        step = _extension_step_for_workspace(conn, workspace_id)
    return [_roster_dict(r, default_step=step) for r in rows]


def list_league_rosters_by_team(league_id: str) -> dict[str, list[dict[str, Any]]]:
    """All team rosters for a league in one query."""
    league = get_league(league_id)
    if not league:
        return {}
    workspace_id = roster_workspace_for_league(league)
    teams = list_league_teams(league_id)
    out = {str(t["id"]): [] for t in teams}
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM roster_slot WHERE workspace_id = ? AND team_id IS NOT NULL AND team_id != ''",
            (workspace_id,),
        ).fetchall()
        step = _extension_step_for_workspace(conn, workspace_id)
    for row in rows:
        tid = str(row["team_id"])
        if tid in out:
            out[tid].append(_roster_dict(row, default_step=step))
    return out


def roster_player_team_map(workspace_id: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for row in list_league_roster(workspace_id):
        tid = row.get("team_id")
        if tid:
            out[str(row["player_id"])] = str(tid)
    return out


def list_orphan_roster_slots(workspace_id: str) -> list[dict[str, Any]]:
    """Roster rows in a league workspace that are not assigned to a team."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM roster_slot
               WHERE workspace_id = ? AND (team_id IS NULL OR team_id = '')""",
            (workspace_id,),
        ).fetchall()
        step = _extension_step_for_workspace(conn, workspace_id)
    return [_roster_dict(r, default_step=step) for r in rows]


def move_roster_player(workspace_id: str, player_id: str, to_team_id: str) -> dict[str, Any] | None:
    """Move a player's contract to another hub team (Sleeper trade sync)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
            (workspace_id, player_id),
        ).fetchone()
        if not row:
            return None
        if str(row["team_id"] or "") == str(to_team_id):
            return _roster_dict(row)
        conn.execute(
            "UPDATE roster_slot SET team_id = ? WHERE id = ?",
            (to_team_id, row["id"]),
        )
        updated = conn.execute("SELECT * FROM roster_slot WHERE id = ?", (row["id"],)).fetchone()
        _bump_live_for_workspace_conn(conn, workspace_id)
        return _roster_dict(updated)


def update_roster_metadata(
    workspace_id: str,
    player_id: str,
    *,
    player_name: str | None = None,
    team: str | None = None,
    position: str | None = None,
    sleeper_player_id: str | None = None,
) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
            (workspace_id, player_id),
        ).fetchone()
        if not row:
            return None
        updates: list[str] = []
        params: list[Any] = []
        if player_name is not None and player_name != row["player_name"]:
            updates.append("player_name = ?")
            params.append(player_name)
        if team is not None and team != row["team"]:
            updates.append("team = ?")
            params.append(team)
        if position is not None and position != row["position"]:
            updates.append("position = ?")
            params.append(position)
        if sleeper_player_id is not None and sleeper_player_id != row["sleeper_player_id"]:
            updates.append("sleeper_player_id = ?")
            params.append(sleeper_player_id)
        if not updates:
            return _roster_dict(row)
        params.append(row["id"])
        conn.execute(f"UPDATE roster_slot SET {', '.join(updates)} WHERE id = ?", params)
        updated = conn.execute("SELECT * FROM roster_slot WHERE id = ?", (row["id"],)).fetchone()
        _bump_live_for_workspace_conn(conn, workspace_id)
        return _roster_dict(updated)


def _league_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    return {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "commissioner_sub": row["commissioner_sub"],
        "name": row["name"],
        "season": row["season"],
        "rules": _rules_from_json(row["rules_json"]).model_dump(),
        "room_code": row["room_code"],
        "status": row["status"],
        "team_count": row["team_count"],
        "test_mode": bool(row["test_mode"]) if "test_mode" in keys else False,
        "sleeper_league_id": row["sleeper_league_id"] if "sleeper_league_id" in keys else None,
        "lock_team_claims": bool(row["lock_team_claims"]) if "lock_team_claims" in keys else True,
        "draft_completed": bool(row["draft_completed"]) if "draft_completed" in keys else False,
        "draft_starts_at": row["draft_starts_at"] if "draft_starts_at" in keys else None,
        "draft_timezone": row["draft_timezone"] if "draft_timezone" in keys else None,
        "claim_link_enabled": bool(row["claim_link_enabled"]) if "claim_link_enabled" in keys else True,
        "live_roster_revision": int(row["live_roster_revision"] or 0)
        if "live_roster_revision" in keys
        else 0,
        "historic_snapshot_revision": int(row["historic_snapshot_revision"] or 0)
        if "historic_snapshot_revision" in keys
        else 0,
        "created_at": row["created_at"],
        "mock_saved": bool(row["mock_saved"]) if "mock_saved" in keys else False,
        "lobby_notified_at": row["lobby_notified_at"] if "lobby_notified_at" in keys else None,
    }


def save_draft_contract_snapshot(league_id: str, snapshot: dict[str, Any]) -> None:
    """Persist pre/post draft-complete contract snapshot JSON on the league row."""
    payload = dict(snapshot or {})
    payload.setdefault("captured_at", _utcnow())
    with get_conn() as conn:
        conn.execute(
            "UPDATE league SET draft_contract_snapshot_json = ? WHERE id = ?",
            (json.dumps(payload), league_id),
        )


def get_draft_contract_snapshot(league_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT draft_contract_snapshot_json FROM league WHERE id = ?",
            (league_id,),
        ).fetchone()
    if not row:
        return None
    raw = None
    try:
        raw = row["draft_contract_snapshot_json"]
    except (KeyError, IndexError):
        raw = None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def clear_draft_contract_snapshot(league_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE league SET draft_contract_snapshot_json = NULL WHERE id = ?",
            (league_id,),
        )


def save_sandbox_baseline(league_id: str, snapshot: dict[str, Any]) -> None:
    payload = dict(snapshot or {})
    payload.setdefault("captured_at", _utcnow())
    with get_conn() as conn:
        conn.execute(
            "UPDATE league SET sandbox_baseline_json = ? WHERE id = ?",
            (json.dumps(payload), league_id),
        )


def get_sandbox_baseline(league_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT sandbox_baseline_json FROM league WHERE id = ?",
            (league_id,),
        ).fetchone()
    if not row:
        return None
    try:
        raw = row["sandbox_baseline_json"]
    except (KeyError, IndexError):
        raw = None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def rekey_roster_player_id(
    workspace_id: str,
    old_player_id: str,
    new_player_id: str,
    *,
    contract: dict[str, Any] | None = None,
    roster_status: str | None = None,
) -> dict[str, Any]:
    """Change a roster row's player_id (used to park cut liabilities)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM roster_slot WHERE workspace_id = ? AND player_id = ?",
            (workspace_id, old_player_id),
        ).fetchone()
        if not row:
            raise ValueError("Player not on roster")
        updates = ["player_id = ?"]
        params: list[Any] = [new_player_id]
        if contract is not None:
            updates.append("contract_json = ?")
            params.append(json.dumps(contract))
        if roster_status is not None:
            updates.append("roster_status = ?")
            params.append(roster_status)
        params.append(row["id"])
        conn.execute(
            f"UPDATE roster_slot SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        updated = conn.execute("SELECT * FROM roster_slot WHERE id = ?", (row["id"],)).fetchone()
        _bump_live_for_workspace_conn(conn, workspace_id)
        return _roster_dict(updated)


def import_roster_snapshot(
    workspace_id: str,
    team_id: str | None,
    rows: list[dict[str, Any]],
    *,
    replace_source: str | None = None,
) -> int:
    if replace_source:
        remove_roster_by_source(workspace_id, replace_source)
    count = 0
    for row in rows:
        add_roster_slot(workspace_id, row, team_id=team_id)
        count += 1
    return count


def add_bot_team(
    league_id: str,
    team_id: str,
    name: str,
    budget: float,
    *,
    draft_slot: int | None = None,
) -> None:
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO team (
                   id, league_id, user_sub, name, budget_remaining,
                   is_commissioner, is_bot, joined_at, draft_slot
               )
               VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)""",
            (team_id, league_id, f"bot:{team_id}", name, budget, now, draft_slot),
        )


def update_league_test_mode(league_id: str, enabled: bool) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE league SET test_mode = ? WHERE id = ?", (1 if enabled else 0, league_id))


def league_test_mode(league_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute("SELECT test_mode FROM league WHERE id = ?", (league_id,)).fetchone()
        return bool(row and row["test_mode"])


def roster_workspace_for_league(league: dict[str, Any]) -> str:
    """Shared roster workspace for a league (explicit id or commissioner workspace)."""
    ws_id = league.get("workspace_id")
    if ws_id:
        return str(ws_id)
    # Mock/test rooms have no workspace: keep their rosters isolated under the
    # league id so draft picks never touch the commissioner's real hub roster.
    if league.get("test_mode"):
        return str(league["id"])
    comm = league.get("commissioner_sub")
    if comm:
        return str(get_or_create_workspace(str(comm))["id"])
    return str(league["id"])


def clear_league_draft_picks(league_id: str) -> int:
    """Remove current-auction awards for all teams in this league. Keepers stay."""
    from src.draft_hub.acquisition_semantics import CURRENT_AUCTION_SOURCES

    league = get_league(league_id)
    if not league:
        return 0
    teams = list_league_teams(league_id)
    team_ids = [str(t["id"]) for t in teams]
    if not team_ids:
        return 0
    ws = roster_workspace_for_league(league)
    team_ph = ",".join("?" * len(team_ids))
    src_list = sorted(CURRENT_AUCTION_SOURCES)
    src_ph = ",".join("?" * len(src_list))
    with get_conn() as conn:
        cur = conn.execute(
            f"""DELETE FROM roster_slot
                WHERE workspace_id = ?
                  AND lower(coalesce(source, '')) IN ({src_ph})
                  AND team_id IN ({team_ph})""",
            [ws, *src_list, *team_ids],
        )
        return int(cur.rowcount)


def clear_draft_events(league_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM draft_event WHERE league_id = ?", (league_id,))


def clear_league_team_rosters(league_id: str) -> int:
    league = get_league(league_id)
    if not league:
        return 0
    teams = list_league_teams(league_id)
    team_ids = [str(t["id"]) for t in teams]
    if not team_ids:
        return 0
    ws = roster_workspace_for_league(league)
    placeholders = ",".join("?" * len(team_ids))
    with get_conn() as conn:
        cur = conn.execute(
            f"DELETE FROM roster_slot WHERE workspace_id = ? AND team_id IN ({placeholders})",
            [ws, *team_ids],
        )
        return int(cur.rowcount)


def reset_league_team_budgets(league_id: str, cap: float) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE team SET budget_remaining = ? WHERE league_id = ?",
            (float(cap), league_id),
        )


# --- League invites ---


def _invite_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = set(row.keys())
    return {
        "id": row["id"],
        "league_id": row["league_id"],
        "email": row["email"],
        "team_name": row["team_name"],
        "token": row["token"],
        "status": row["status"],
        "invited_by_sub": row["invited_by_sub"],
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
        "accepted_by_sub": row["accepted_by_sub"],
        "accepted_at": row["accepted_at"],
        "co_commissioner": bool(row["co_commissioner"]) if "co_commissioner" in keys else False,
    }


def get_league_claim_token(league_id: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT claim_token, claim_link_enabled FROM league WHERE id = ?",
            (league_id,),
        ).fetchone()
        if not row:
            return None
        token = str(row["claim_token"] or "").strip()
        if token:
            return token
        token = _new_claim_token()
        conn.execute("UPDATE league SET claim_token = ? WHERE id = ?", (token, league_id))
        return token


def get_league_by_claim_token(token: str) -> dict[str, Any] | None:
    clean = str(token or "").strip()
    if not clean:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM league WHERE claim_token = ?",
            (clean,),
        ).fetchone()
    return _league_dict(row) if row else None


def rotate_league_claim_token(league_id: str) -> str:
    if not get_league(league_id):
        raise ValueError("League not found")
    token = _new_claim_token()
    with get_conn() as conn:
        conn.execute("UPDATE league SET claim_token = ? WHERE id = ?", (token, league_id))
    return token


def _availability_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "league_id": row["league_id"],
        "team_id": row["team_id"],
        "user_sub": row["user_sub"],
        "date": row["slot_date"],
        "hour": int(row["slot_hour"]),
        "created_at": row["created_at"],
    }


def list_draft_availability(league_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM draft_availability
               WHERE league_id = ?
               ORDER BY slot_date, slot_hour""",
            (league_id,),
        ).fetchall()
    return [_availability_dict(r) for r in rows]


def list_team_draft_availability(league_id: str, team_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM draft_availability
               WHERE league_id = ? AND team_id = ?
               ORDER BY slot_date, slot_hour""",
            (league_id, team_id),
        ).fetchall()
    return [_availability_dict(r) for r in rows]


def replace_team_draft_availability(
    league_id: str,
    team_id: str,
    user_sub: str,
    slots: list[tuple[str, int]],
) -> list[dict[str, Any]]:
    now = _utcnow()
    unique: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    for date, hour in slots:
        key = (str(date), int(hour))
        if key in seen:
            continue
        seen.add(key)
        unique.append(key)
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM draft_availability WHERE league_id = ? AND team_id = ?",
            (league_id, team_id),
        )
        for date, hour in unique:
            conn.execute(
                """INSERT INTO draft_availability
                   (id, league_id, team_id, user_sub, slot_date, slot_hour, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (str(uuid.uuid4()), league_id, team_id, user_sub, date, hour, now),
            )
    return list_team_draft_availability(league_id, team_id)


def get_or_create_league_team_by_name(league_id: str, name: str, budget: float) -> dict[str, Any]:
    """Find a league team by name or create an unclaimed stub for invite/sheet import."""
    clean = str(name or "").strip()
    if not clean:
        raise ValueError("Team name is required")
    for team in list_league_teams(league_id):
        if str(team["name"]).lower() == clean.lower():
            return team
    team_id = str(uuid.uuid4())
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO team (id, league_id, user_sub, name, budget_remaining, is_commissioner, joined_at)
               VALUES (?, ?, NULL, ?, ?, 0, NULL)""",
            (team_id, league_id, clean, budget),
        )
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(row)


def create_league_invite(
    league_id: str,
    email: str,
    team_name: str,
    invited_by_sub: str,
    *,
    token: str,
    expires_at: str,
    co_commissioner: bool = False,
) -> dict[str, Any]:
    from src.auth.user_store import normalize_email, validate_email

    validate_email(email)
    email_norm = normalize_email(email)
    league = get_league(league_id)
    if not league:
        raise ValueError("League not found")
    rules = LeagueRules.model_validate(league["rules"])
    team = get_or_create_league_team_by_name(league_id, team_name, rules.salary_cap)
    if team.get("user_sub"):
        raise ValueError(f"Team '{team['name']}' is already claimed")
    pending = get_pending_invite_for_team(league_id, team["id"])
    if pending:
        raise ValueError(f"An invite is already pending for '{team['name']}'")
    invite_id = str(uuid.uuid4())
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO league_invite
               (id, league_id, email, team_name, token, status, invited_by_sub, created_at, expires_at, co_commissioner)
               VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
            (
                invite_id,
                league_id,
                email_norm,
                team["name"],
                token,
                invited_by_sub,
                now,
                expires_at,
                1 if co_commissioner else 0,
            ),
        )
        row = conn.execute("SELECT * FROM league_invite WHERE id = ?", (invite_id,)).fetchone()
        invite = _invite_dict(row)
        invite["team_id"] = team["id"]
        return invite


def get_pending_invite_for_team(league_id: str, team_id: str) -> dict[str, Any] | None:
    teams = {t["id"]: t for t in list_league_teams(league_id)}
    team = teams.get(team_id)
    if not team:
        return None
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_invite
               WHERE league_id = ? AND status = 'pending' AND LOWER(team_name) = LOWER(?)""",
            (league_id, team["name"]),
        ).fetchall()
    return _invite_dict(rows[0]) if rows else None


def list_league_invites(league_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM league_invite WHERE league_id = ? ORDER BY created_at DESC",
            (league_id,),
        ).fetchall()
    return [_invite_dict(r) for r in rows]


def get_invite_by_token(token: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM league_invite WHERE token = ?", (token,)).fetchone()
        if not row:
            return None
        invite = _invite_dict(row)
        league = get_league(invite["league_id"])
        if league:
            invite["league_name"] = league["name"]
            invite["league_season"] = league["season"]
        return invite


def revoke_league_invite(league_id: str, invite_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE league_invite SET status = 'revoked'
               WHERE id = ? AND league_id = ? AND status = 'pending'""",
            (invite_id, league_id),
        )
        return cur.rowcount > 0


def accept_league_invite(token: str, user_sub: str, user_email: str) -> dict[str, Any]:
    from src.auth.user_store import normalize_email

    invite = get_invite_by_token(token)
    if not invite:
        raise ValueError("Invite not found")
    if invite["status"] != "pending":
        raise ValueError("This invite is no longer valid")
    if invite["expires_at"] < _utcnow():
        raise ValueError("This invite has expired")
    if normalize_email(user_email) != normalize_email(invite["email"]):
        raise ValueError("Sign in with the email address that received this invite")

    league_id = invite["league_id"]
    league = get_league(league_id)
    if not league:
        raise ValueError("League not found")
    existing = get_team_by_user(league_id, user_sub)
    if existing:
        raise ValueError("You are already on a team in this league")

    teams = list_league_teams(league_id)
    team = next((t for t in teams if t["name"].lower() == invite["team_name"].lower()), None)
    if not team:
        raise ValueError("Team no longer exists in this league")
    if team.get("user_sub") and team["user_sub"] != user_sub:
        raise ValueError("This team has already been claimed")

    make_staff = bool(invite.get("co_commissioner")) or str(league.get("commissioner_sub") or "") == str(user_sub)
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "UPDATE team SET user_sub = ?, joined_at = ?, is_commissioner = ? WHERE id = ?",
            (user_sub, now, 1 if make_staff else 0, team["id"]),
        )
        conn.execute(
            """UPDATE league_invite
               SET status = 'accepted', accepted_by_sub = ?, accepted_at = ?
               WHERE id = ?""",
            (user_sub, now, invite["id"]),
        )
    return {
        "league": get_league(league_id),
        "team": get_team(team["id"]),
        "invite": get_invite_by_token(token),
    }


def set_team_co_commissioner(
    league_id: str,
    team_id: str,
    *,
    enabled: bool,
    actor_sub: str,
) -> dict[str, Any]:
    """Promote or demote a claimed team as co-commissioner. Primary only."""
    league = get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if str(league.get("commissioner_sub") or "") != str(actor_sub):
        raise ValueError("Only the primary commissioner can change co-commissioner roles")
    team = get_team(team_id)
    if not team or team.get("league_id") != league_id:
        raise ValueError("Team not found in this league")
    if not team.get("user_sub"):
        raise ValueError("Team must be claimed before granting co-commissioner")
    if str(team.get("user_sub")) == str(league.get("commissioner_sub")):
        raise ValueError("Cannot change the primary commissioner's staff flag this way")
    with get_conn() as conn:
        conn.execute(
            "UPDATE team SET is_commissioner = ? WHERE id = ? AND league_id = ?",
            (1 if enabled else 0, team_id, league_id),
        )
    return get_team(team_id)


CHAT_KINDS = frozenset({"league", "office"})
CHAT_BODY_MAX = 2000


def _chat_channel_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "league_id": row["league_id"],
        "kind": row["kind"],
        "created_at": row["created_at"],
    }


def _chat_message_dict(row: sqlite3.Row, *, team_name: str | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "channel_id": row["channel_id"],
        "author_sub": row["author_sub"],
        "team_id": row["team_id"],
        "team_name": team_name,
        "body": row["body"],
        "created_at": row["created_at"],
    }


def ensure_chat_channels(league_id: str) -> dict[str, dict[str, Any]]:
    """Create league + office channels if missing; return kind → channel."""
    now = _utcnow()
    out: dict[str, dict[str, Any]] = {}
    with get_conn() as conn:
        for kind in ("league", "office"):
            row = conn.execute(
                "SELECT * FROM league_chat_channel WHERE league_id = ? AND kind = ?",
                (league_id, kind),
            ).fetchone()
            if not row:
                channel_id = str(uuid.uuid4())
                conn.execute(
                    """INSERT INTO league_chat_channel (id, league_id, kind, created_at)
                       VALUES (?, ?, ?, ?)""",
                    (channel_id, league_id, kind, now),
                )
                row = conn.execute(
                    "SELECT * FROM league_chat_channel WHERE id = ?",
                    (channel_id,),
                ).fetchone()
            out[kind] = _chat_channel_dict(row)
    return out


def list_chat_messages(
    league_id: str,
    kind: str,
    *,
    before: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    if kind not in CHAT_KINDS:
        raise ValueError("Invalid chat channel")
    channels = ensure_chat_channels(league_id)
    channel = channels[kind]
    lim = max(1, min(int(limit or 50), 100))
    with get_conn() as conn:
        if before:
            rows = conn.execute(
                """SELECT * FROM league_chat_message
                   WHERE channel_id = ? AND created_at < ?
                   ORDER BY created_at DESC LIMIT ?""",
                (channel["id"], before, lim),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM league_chat_message
                   WHERE channel_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (channel["id"], lim),
            ).fetchall()
    team_names = {t["id"]: t.get("name") for t in list_league_teams(league_id)}
    messages = [
        _chat_message_dict(r, team_name=team_names.get(r["team_id"]))
        for r in rows
    ]
    messages.reverse()
    return messages


def post_chat_message(
    league_id: str,
    kind: str,
    *,
    author_sub: str,
    team_id: str | None,
    body: str,
) -> dict[str, Any]:
    if kind not in CHAT_KINDS:
        raise ValueError("Invalid chat channel")
    text = str(body or "").strip()
    if not text:
        raise ValueError("Message cannot be empty")
    if len(text) > CHAT_BODY_MAX:
        raise ValueError(f"Message too long (max {CHAT_BODY_MAX} characters)")
    channels = ensure_chat_channels(league_id)
    channel = channels[kind]
    msg_id = str(uuid.uuid4())
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO league_chat_message
               (id, channel_id, author_sub, team_id, body, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (msg_id, channel["id"], author_sub, team_id, text, now),
        )
        row = conn.execute(
            "SELECT * FROM league_chat_message WHERE id = ?",
            (msg_id,),
        ).fetchone()
    team_name = None
    if team_id:
        team = get_team(team_id)
        team_name = team.get("name") if team else None
    return _chat_message_dict(row, team_name=team_name)


def clear_chat_messages(league_id: str, kind: str) -> dict[str, Any]:
    """Delete all messages in one chat channel (league or office)."""
    if kind not in CHAT_KINDS:
        raise ValueError("Invalid chat channel")
    channels = ensure_chat_channels(league_id)
    channel = channels[kind]
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM league_chat_message WHERE channel_id = ?",
            (channel["id"],),
        )
        deleted = int(cur.rowcount or 0)
    return {"kind": kind, "deleted": deleted, "channel_id": channel["id"]}


def import_commissioner_league_sheet(
    league_id: str,
    workspace_id: str,
    rows: list[dict[str, Any]],
    rules: LeagueRules,
    *,
    replace_existing: bool = True,
) -> dict[str, Any]:
    """Import all manager blocks from a league spreadsheet into shared team rosters."""
    if replace_existing:
        remove_roster_by_source(workspace_id, "sheet")
    team_ids: dict[str, str] = {}
    by_team: dict[str, int] = {}
    pending: list[tuple[str, dict[str, Any]]] = []
    for row in rows:
        mgr = str(row.get("manager_team") or "").strip()
        if not mgr:
            continue
        key = mgr.lower()
        if key not in team_ids:
            team = get_or_create_league_team_by_name(league_id, mgr, rules.salary_cap)
            team_ids[key] = team["id"]
        tid = team_ids[key]
        payload = {k: v for k, v in row.items() if k != "manager_team"}
        payload.setdefault("source", "sheet")
        pending.append((tid, payload))
        by_team[mgr] = by_team.get(mgr, 0) + 1

    now = _utcnow()
    with get_conn() as conn:
        for tid, payload in pending:
            contract = payload.get("contract")
            contract_json = json.dumps(contract) if contract else None
            source = payload.get("source") or "manual"
            conn.execute(
                """INSERT INTO roster_slot
                   (workspace_id, team_id, player_id, player_name, team, position, salary, contract_years,
                    acquired_at, sleeper_player_id, source, contract_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(workspace_id, player_id) DO UPDATE SET
                     team_id=excluded.team_id, player_name=excluded.player_name, team=excluded.team,
                     position=excluded.position, salary=excluded.salary, contract_years=excluded.contract_years,
                     sleeper_player_id=excluded.sleeper_player_id, source=excluded.source,
                     contract_json=excluded.contract_json""",
                (
                    workspace_id,
                    tid,
                    payload["player_id"],
                    payload.get("player_name"),
                    payload.get("team"),
                    payload["position"],
                    payload["salary"],
                    payload.get("contract_years", 1),
                    now,
                    payload.get("sleeper_player_id"),
                    source,
                    contract_json,
                ),
            )
    return {"imported": sum(by_team.values()), "by_team": by_team, "teams": list(by_team.keys())}


def upsert_sleeper_scoring_cache(sleeper_league_id: str, payload: dict[str, Any]) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO sleeper_scoring_cache (sleeper_league_id, payload_json, synced_at)
               VALUES (?, ?, ?)
               ON CONFLICT(sleeper_league_id) DO UPDATE SET
                 payload_json = excluded.payload_json,
                 synced_at = excluded.synced_at""",
            (str(sleeper_league_id), json.dumps(payload), _utcnow()),
        )


def get_sleeper_scoring_cache(sleeper_league_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload_json, synced_at FROM sleeper_scoring_cache WHERE sleeper_league_id = ?",
            (str(sleeper_league_id),),
        ).fetchone()
    if not row:
        return None
    try:
        payload = json.loads(row["payload_json"])
    except json.JSONDecodeError:
        return None
    return {"payload": payload, "synced_at": row["synced_at"]}


def roster_source_version(league_id: str) -> str:
    """Fingerprint league roster rows for commissioner Teams tab cache keys."""
    import hashlib

    league = get_league(league_id)
    if not league:
        return "0"
    live_rev = int(league.get("live_roster_revision") or 0)
    ws_id = roster_workspace_for_league(league)
    with get_conn() as conn:
        row = conn.execute(
            """SELECT COUNT(*) AS n,
                      COALESCE(SUM(salary), 0) AS sal,
                      COALESCE(SUM(contract_years), 0) AS yrs
               FROM roster_slot
               WHERE workspace_id = ? AND team_id IS NOT NULL AND team_id != ''""",
            (str(ws_id),),
        ).fetchone()
    raw = f"live={live_rev}:{row['n']}:{row['sal']}:{row['yrs']}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def league_cache_revisions(league_id: str) -> dict[str, int]:
    """Return monotonic live + historic cache revisions for a league."""
    league = get_league(league_id)
    if not league:
        return {"live_roster_revision": 0, "historic_snapshot_revision": 0}
    return {
        "live_roster_revision": int(league.get("live_roster_revision") or 0),
        "historic_snapshot_revision": int(league.get("historic_snapshot_revision") or 0),
    }


def _league_ids_for_roster_workspace(conn: sqlite3.Connection, workspace_id: str) -> list[str]:
    """Resolve league id(s) that store rosters in this workspace."""
    rows = conn.execute(
        "SELECT id FROM league WHERE workspace_id = ?",
        (str(workspace_id),),
    ).fetchall()
    if rows:
        return [str(r["id"]) for r in rows]
    # test_mode / isolated rooms use league id as the roster workspace.
    row = conn.execute(
        "SELECT id FROM league WHERE id = ?",
        (str(workspace_id),),
    ).fetchone()
    return [str(row["id"])] if row else []


def _bump_revision_conn(
    conn: sqlite3.Connection,
    league_id: str,
    column: str,
) -> int:
    if column not in {"live_roster_revision", "historic_snapshot_revision"}:
        raise ValueError(f"Unknown revision column: {column}")
    conn.execute(
        f"UPDATE league SET {column} = COALESCE({column}, 0) + 1 WHERE id = ?",
        (str(league_id),),
    )
    row = conn.execute(
        f"SELECT {column} AS rev FROM league WHERE id = ?",
        (str(league_id),),
    ).fetchone()
    return int(row["rev"] or 0) if row else 0


def bump_live_roster_revision(league_id: str) -> int:
    """Advance live roster revision (Insights / league-rosters cache keys)."""
    with get_conn() as conn:
        return _bump_revision_conn(conn, league_id, "live_roster_revision")


def bump_historic_snapshot_revision(league_id: str) -> int:
    """Advance historic snapshot revision (Insights / salary-sheet cache keys)."""
    with get_conn() as conn:
        return _bump_revision_conn(conn, league_id, "historic_snapshot_revision")


def insert_historic_correction(
    league_id: str,
    *,
    row_id: int,
    season_year: int,
    reason: str,
    mode: str,
    edited_by_sub: str,
    before_json: dict[str, Any],
    after_json: dict[str, Any],
    historic_snapshot_revision: int,
    live_applied: bool = False,
    live_before_json: dict[str, Any] | None = None,
    live_after_json: dict[str, Any] | None = None,
    live_roster_revision: int | None = None,
) -> int:
    """Persist a SCORE-43 historic correction event (keeps prior published state)."""
    import json

    now = _utcnow()
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO league_historic_correction (
                league_id, row_id, season_year, reason, mode, edited_by_sub, edited_at,
                before_json, after_json, historic_snapshot_revision,
                live_applied, live_before_json, live_after_json, live_roster_revision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(league_id),
                int(row_id),
                int(season_year),
                str(reason),
                str(mode),
                str(edited_by_sub),
                now,
                json.dumps(before_json, default=str),
                json.dumps(after_json, default=str),
                int(historic_snapshot_revision),
                1 if live_applied else 0,
                json.dumps(live_before_json, default=str) if live_before_json is not None else None,
                json.dumps(live_after_json, default=str) if live_after_json is not None else None,
                int(live_roster_revision) if live_roster_revision is not None else None,
            ),
        )
        return int(cur.lastrowid)


def get_historic_correction(correction_id: int) -> dict[str, Any] | None:
    import json

    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM league_historic_correction WHERE id = ?",
            (int(correction_id),),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["live_applied"] = bool(d.get("live_applied"))
    for key in ("before_json", "after_json", "live_before_json", "live_after_json"):
        raw = d.get(key)
        if raw:
            try:
                d[key.replace("_json", "")] = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                d[key.replace("_json", "")] = None
        else:
            d[key.replace("_json", "")] = None
    return d


def list_historic_corrections(
    league_id: str,
    *,
    season_year: int | None = None,
    row_id: int | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses = ["league_id = ?"]
    params: list[Any] = [str(league_id)]
    if season_year is not None:
        clauses.append("season_year = ?")
        params.append(int(season_year))
    if row_id is not None:
        clauses.append("row_id = ?")
        params.append(int(row_id))
    params.append(max(1, min(int(limit), 500)))
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT id, league_id, row_id, season_year, reason, mode, edited_by_sub,
                       edited_at, historic_snapshot_revision, live_applied, live_roster_revision
                FROM league_historic_correction
                WHERE {' AND '.join(clauses)}
                ORDER BY id DESC
                LIMIT ?""",
            params,
        ).fetchall()
    return [
        {
            **dict(r),
            "live_applied": bool(r["live_applied"]),
        }
        for r in rows
    ]


def _bump_live_for_workspace_conn(conn: sqlite3.Connection, workspace_id: str) -> list[tuple[str, int]]:
    bumped: list[tuple[str, int]] = []
    for lid in _league_ids_for_roster_workspace(conn, workspace_id):
        bumped.append((lid, _bump_revision_conn(conn, lid, "live_roster_revision")))
    return bumped


def _record_roster_edits_conn(
    conn: sqlite3.Connection,
    *,
    league_id: str,
    roster_slot_id: int | None,
    player_id: str,
    changes: list[tuple[str, Any, Any]],
    edited_by_sub: str,
    note: str | None,
    live_revision: int,
) -> None:
    now = _utcnow()
    for field_name, old_val, new_val in changes:
        conn.execute(
            """INSERT INTO league_roster_edit
               (league_id, roster_slot_id, player_id, field_name, old_value, new_value,
                edited_by_sub, edited_at, note, live_revision)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(league_id),
                roster_slot_id,
                str(player_id),
                str(field_name),
                None if old_val is None else str(old_val),
                None if new_val is None else str(new_val),
                str(edited_by_sub),
                now,
                note,
                int(live_revision),
            ),
        )


def insights_source_version(league_id: str) -> str:
    """Fingerprint roster/historic revisions plus import and owner-map metadata."""
    import hashlib

    with get_conn() as conn:
        league_row = conn.execute(
            "SELECT * FROM league WHERE id = ?",
            (str(league_id),),
        ).fetchone()
        live_rev = 0
        hist_rev = 0
        roster_slots = 0
        if league_row:
            league = dict(league_row)
            live_rev = int(league.get("live_roster_revision") or 0)
            hist_rev = int(league.get("historic_snapshot_revision") or 0)
            ws_id = roster_workspace_for_league(league)
            roster_slots = conn.execute(
                "SELECT COUNT(*) AS n FROM roster_slot WHERE workspace_id = ?",
                (str(ws_id),),
            ).fetchone()["n"]
        contract_rows = conn.execute(
            "SELECT COUNT(*) AS n FROM league_contract_row WHERE league_id = ?",
            (str(league_id),),
        ).fetchone()["n"]
        manual_rows = conn.execute(
            """SELECT COUNT(*) AS n FROM league_contract_row
               WHERE league_id = ? AND source_kind = 'manual'""",
            (str(league_id),),
        ).fetchone()["n"]
        import_rev = conn.execute(
            """SELECT COALESCE(MAX(imported_at), '') AS rev
               FROM league_legacy_import WHERE league_id = ?""",
            (str(league_id),),
        ).fetchone()["rev"]
        import_fp = conn.execute(
            """SELECT COALESCE(GROUP_CONCAT(source_fingerprint), '') AS fps
               FROM (
                   SELECT source_fingerprint FROM league_legacy_import
                   WHERE league_id = ? AND source_fingerprint IS NOT NULL
                   ORDER BY imported_at DESC
               )""",
            (str(league_id),),
        ).fetchone()["fps"]
        osm = conn.execute(
            """SELECT COALESCE(MAX(updated_at), '') AS rev
               FROM league_owner_season_map WHERE league_id = ?""",
            (str(league_id),),
        ).fetchone()["rev"]
    raw = (
        f"formula=owner_avg_pct_v1:live={live_rev}:hist={hist_rev}:"
        f"{roster_slots}:{contract_rows}:{manual_rows}:{import_rev}:{import_fp}:{osm}"
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def get_insights_cap_cache(league_id: str, season_key: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT payload_json, built_at, source_version
               FROM insights_cap_cache
               WHERE league_id = ? AND season_key = ?""",
            (str(league_id), str(season_key)),
        ).fetchone()
    if not row:
        return None
    try:
        payload = json.loads(row["payload_json"])
    except json.JSONDecodeError:
        return None
    return {
        "payload": payload,
        "built_at": row["built_at"],
        "source_version": row["source_version"],
    }


def upsert_insights_cap_cache(
    league_id: str,
    season_key: str,
    payload: dict[str, Any],
    *,
    source_version: str,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO insights_cap_cache
               (league_id, season_key, payload_json, built_at, source_version)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(league_id, season_key) DO UPDATE SET
                 payload_json = excluded.payload_json,
                 built_at = excluded.built_at,
                 source_version = excluded.source_version""",
            (
                str(league_id),
                str(season_key),
                json.dumps(payload),
                _utcnow(),
                str(source_version),
            ),
        )


def delete_insights_cap_cache(league_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM insights_cap_cache WHERE league_id = ?",
            (str(league_id),),
        )


def get_insights_scoring_derived(
    sleeper_league_id: str,
    season_key: str,
) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT awards_json, efficiency_json, built_at
               FROM insights_scoring_derived
               WHERE sleeper_league_id = ? AND season_key = ?""",
            (str(sleeper_league_id), str(season_key)),
        ).fetchone()
    if not row:
        return None
    try:
        awards = json.loads(row["awards_json"])
        efficiency = json.loads(row["efficiency_json"])
    except json.JSONDecodeError:
        return None
    return {
        "awards": awards,
        "efficiency": efficiency,
        "built_at": row["built_at"],
    }


def upsert_insights_scoring_derived(
    sleeper_league_id: str,
    season_key: str,
    *,
    awards: list[dict[str, Any]],
    efficiency: dict[str, Any],
) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO insights_scoring_derived
               (sleeper_league_id, season_key, awards_json, efficiency_json, built_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(sleeper_league_id, season_key) DO UPDATE SET
                 awards_json = excluded.awards_json,
                 efficiency_json = excluded.efficiency_json,
                 built_at = excluded.built_at""",
            (
                str(sleeper_league_id),
                str(season_key),
                json.dumps(awards),
                json.dumps(efficiency),
                _utcnow(),
            ),
        )


def get_insights_fair_values(
    league_id: str,
    season: int,
    pool_fingerprint: str,
) -> dict[str, float] | None:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT player_id, fair_value, pool_fingerprint
               FROM insights_fair_values
               WHERE league_id = ? AND season = ?""",
            (str(league_id), int(season)),
        ).fetchall()
    if not rows:
        return None
    if str(rows[0]["pool_fingerprint"]) != str(pool_fingerprint):
        return None
    return {str(r["player_id"]): float(r["fair_value"]) for r in rows}


def upsert_insights_fair_values(
    league_id: str,
    season: int,
    fair_map: dict[str, float],
    *,
    pool_fingerprint: str,
) -> None:
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM insights_fair_values WHERE league_id = ? AND season = ?",
            (str(league_id), int(season)),
        )
        conn.executemany(
            """INSERT INTO insights_fair_values
               (league_id, season, player_id, fair_value, pool_fingerprint, built_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (
                    str(league_id),
                    int(season),
                    str(pid),
                    float(val),
                    str(pool_fingerprint),
                    now,
                )
                for pid, val in fair_map.items()
                if pid and val
            ],
        )


def upsert_sleeper_live_scoring_cache(
    sleeper_league_id: str,
    week: int,
    payload: dict[str, Any],
) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO sleeper_live_scoring_cache
               (sleeper_league_id, week, payload_json, synced_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(sleeper_league_id, week) DO UPDATE SET
                 payload_json = excluded.payload_json,
                 synced_at = excluded.synced_at""",
            (str(sleeper_league_id), int(week), json.dumps(payload), _utcnow()),
        )


def get_sleeper_live_scoring_cache(
    sleeper_league_id: str,
    week: int,
) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT payload_json, synced_at FROM sleeper_live_scoring_cache
               WHERE sleeper_league_id = ? AND week = ?""",
            (str(sleeper_league_id), int(week)),
        ).fetchone()
    if not row:
        return None
    try:
        payload = json.loads(row["payload_json"])
    except json.JSONDecodeError:
        return None
    return {"payload": payload, "synced_at": row["synced_at"]}


def upsert_sleeper_ownership_cache(sleeper_league_id: str, payload: dict[str, Any]) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO sleeper_ownership_cache (sleeper_league_id, payload_json, synced_at)
               VALUES (?, ?, ?)
               ON CONFLICT(sleeper_league_id) DO UPDATE SET
                 payload_json = excluded.payload_json,
                 synced_at = excluded.synced_at""",
            (str(sleeper_league_id), json.dumps(payload), _utcnow()),
        )


def get_sleeper_ownership_cache(sleeper_league_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload_json, synced_at FROM sleeper_ownership_cache WHERE sleeper_league_id = ?",
            (str(sleeper_league_id),),
        ).fetchone()
    if not row:
        return None
    try:
        payload = json.loads(row["payload_json"])
    except json.JSONDecodeError:
        return None
    return {"payload": payload, "synced_at": row["synced_at"]}


def list_leagues_admin(*, include_test: bool = True, limit: int = 200) -> list[dict[str, Any]]:
    """All leagues with team membership summary for admin console."""
    with get_conn() as conn:
        if include_test:
            rows = conn.execute(
                "SELECT * FROM league ORDER BY created_at DESC LIMIT ?",
                (max(1, min(int(limit), 500)),),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM league
                   WHERE test_mode IS NULL OR test_mode = 0
                   ORDER BY created_at DESC LIMIT ?""",
                (max(1, min(int(limit), 500)),),
            ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        league = _league_dict(row)
        teams = list_league_teams(league["id"])
        league["teams"] = teams
        league["member_count"] = sum(1 for t in teams if t.get("user_sub"))
        league["team_rows"] = len(teams)
        out.append(league)
    return out


def list_memberships_for_sub(user_sub: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT t.*, l.name AS league_name, l.room_code, l.season AS league_season,
                      l.test_mode, l.commissioner_sub
               FROM team t
               JOIN league l ON l.id = t.league_id
               WHERE t.user_sub = ?
               ORDER BY t.joined_at DESC""",
            (user_sub,),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        team = _team_dict(row)
        out.append(
            {
                "team": team,
                "league_id": row["league_id"],
                "league_name": row["league_name"],
                "room_code": row["room_code"],
                "league_season": row["league_season"],
                "test_mode": bool(row["test_mode"]) if row["test_mode"] is not None else False,
                "is_commissioner": (
                    str(row["commissioner_sub"]) == str(user_sub)
                    or bool(team.get("is_commissioner"))
                ),
                "is_primary_commissioner": str(row["commissioner_sub"]) == str(user_sub),
            }
        )
    return out


MAX_SAVED_MOCKS = 6
MAX_UNSAVED_COMPLETED_MOCKS = 1
MAX_UNSAVED_IN_PROGRESS_MOCKS = 1


def _mock_session_is_complete(draft_completed: bool, session_status: str | None, league_status: str | None) -> bool:
    if draft_completed:
        return True
    status = str(session_status or league_status or "").lower()
    return status in ("complete", "completed")


def prune_unsaved_mock_drafts(
    user_sub: str,
    keep_league_id: str | None = None,
    *,
    drop_stale_in_progress: bool = False,
) -> list[str]:
    """Drop throwaway practice rooms so SQL does not keep every mock.

    Saved favorites are never deleted here. Unsaved completed rooms keep the
    newest recap. Extra unsaved in-progress rooms are dropped, keeping one
    current throwaway. Starting a new mock drops other unsaved in-progress rooms.
    """
    sub = str(user_sub or "").strip()
    if not sub:
        return []
    keep = {str(keep_league_id)} if keep_league_id else set()
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT l.id, COALESCE(l.draft_completed, 0) AS draft_completed,
                      l.status AS league_status, s.status AS session_status
               FROM league l
               LEFT JOIN draft_session s ON s.league_id = l.id
               WHERE COALESCE(l.test_mode, 0) = 1
                 AND l.commissioner_sub = ?
                 AND COALESCE(l.mock_saved, 0) = 0
               ORDER BY l.created_at DESC""",
            (sub,),
        ).fetchall()
    completed: list[str] = []
    in_progress: list[str] = []
    for row in rows:
        league_id = str(row["id"])
        if league_id in keep:
            continue
        if _mock_session_is_complete(
            bool(row["draft_completed"]),
            row["session_status"],
            row["league_status"],
        ):
            completed.append(league_id)
        else:
            in_progress.append(league_id)
    to_delete = completed[MAX_UNSAVED_COMPLETED_MOCKS:]
    if drop_stale_in_progress:
        to_delete.extend(in_progress)
    else:
        to_delete.extend(in_progress[MAX_UNSAVED_IN_PROGRESS_MOCKS:])
    deleted: list[str] = []
    for league_id in to_delete:
        try:
            delete_league(league_id)
            deleted.append(league_id)
        except ValueError:
            continue
    return deleted


def count_saved_mocks_for_sub(user_sub: str) -> int:
    sub = str(user_sub or "").strip()
    if not sub:
        return 0
    with get_conn() as conn:
        row = conn.execute(
            """SELECT COUNT(*) AS n FROM league
               WHERE commissioner_sub = ?
                 AND COALESCE(test_mode, 0) = 1
                 AND COALESCE(mock_saved, 0) = 1""",
            (sub,),
        ).fetchone()
    return int(row["n"] if row else 0)


def set_mock_saved(league_id: str, saved: bool) -> dict[str, Any]:
    league = get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if not league.get("test_mode"):
        raise ValueError("Only practice rooms can be saved")
    want = bool(saved)
    if want and not league.get("mock_saved"):
        n = count_saved_mocks_for_sub(str(league.get("commissioner_sub") or ""))
        if n >= MAX_SAVED_MOCKS:
            raise ValueError(
                f"You can keep up to {MAX_SAVED_MOCKS} favorite mocks. Unpin one first."
            )
    with get_conn() as conn:
        conn.execute(
            "UPDATE league SET mock_saved = ? WHERE id = ?",
            (1 if want else 0, league_id),
        )
    updated = get_league(league_id)
    if not updated:
        raise ValueError("League not found")
    return updated


def list_mock_drafts_for_sub(user_sub: str, limit: int = 8) -> list[dict[str, Any]]:
    """Saved favorites plus the latest unsaved practice rooms (newest first)."""
    prune_unsaved_mock_drafts(user_sub, drop_stale_in_progress=False)
    cap = max(1, min(int(limit), 24))
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT l.id, l.name, l.season, l.status, l.draft_completed, l.team_count,
                      l.created_at, l.rules_json, l.room_code,
                      COALESCE(l.mock_saved, 0) AS mock_saved
               FROM league l
               JOIN team t ON t.league_id = l.id
               WHERE t.user_sub = ?
                 AND COALESCE(l.test_mode, 0) = 1
                 AND (t.is_bot IS NULL OR t.is_bot = 0)
               ORDER BY COALESCE(l.mock_saved, 0) DESC, l.created_at DESC
               LIMIT ?""",
            (user_sub, cap),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        try:
            rules = json.loads(row["rules_json"] or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            rules = {}
        if not isinstance(rules, dict):
            rules = {}
        completed = bool(row["draft_completed"]) if "draft_completed" in row.keys() else False
        status = "completed" if completed else str(row["status"] or "setup")
        out.append(
            {
                "league_id": row["id"],
                "name": row["name"],
                "season": row["season"],
                "status": status,
                "draft_completed": completed,
                "team_count": row["team_count"],
                "created_at": row["created_at"],
                "draft_type": str(rules.get("draft_type") or "auction"),
                "saved": bool(row["mock_saved"]),
                "room_code": row["room_code"] if "room_code" in row.keys() else None,
            }
        )
    return out


def list_distinct_hub_subs() -> list[str]:
    """All user_sub values seen in workspaces or team claims."""
    subs: set[str] = set()
    with get_conn() as conn:
        for row in conn.execute(
            "SELECT DISTINCT user_sub FROM hub_workspace WHERE user_sub IS NOT NULL AND user_sub != ''"
        ).fetchall():
            subs.add(str(row["user_sub"]))
        for row in conn.execute(
            "SELECT DISTINCT user_sub FROM team WHERE user_sub IS NOT NULL AND user_sub != ''"
        ).fetchall():
            subs.add(str(row["user_sub"]))
        for row in conn.execute(
            "SELECT DISTINCT commissioner_sub FROM league WHERE commissioner_sub IS NOT NULL"
        ).fetchall():
            subs.add(str(row["commissioner_sub"]))
    return sorted(subs)


def admin_transfer_commissioner(league_id: str, new_commissioner_sub: str) -> dict[str, Any]:
    """Move league commissioner to another registered/native account."""
    league = get_league(league_id)
    if not league:
        raise ValueError("League not found")
    new_sub = str(new_commissioner_sub).strip()
    if not new_sub:
        raise ValueError("commissioner_sub required")
    old_sub = str(league.get("commissioner_sub") or "")
    if old_sub == new_sub:
        return {"league": league, "unchanged": True}

    teams = list_league_teams(league_id)
    comm_team = next((t for t in teams if t.get("is_commissioner")), None)
    if not comm_team:
        raise ValueError("League has no commissioner team row")
    new_user_team = next((t for t in teams if t.get("user_sub") == new_sub and t["id"] != comm_team["id"]), None)
    now = _utcnow()

    with get_conn() as conn:
        conn.execute(
            "UPDATE league SET commissioner_sub = ? WHERE id = ?",
            (new_sub, league_id),
        )
        conn.execute(
            "UPDATE team SET is_commissioner = 0 WHERE league_id = ?",
            (league_id,),
        )
        conn.execute(
            """UPDATE team SET user_sub = ?, is_commissioner = 1,
               joined_at = COALESCE(joined_at, ?) WHERE id = ? AND league_id = ?""",
            (new_sub, now, comm_team["id"], league_id),
        )
        if new_user_team:
            conn.execute(
                "UPDATE team SET user_sub = NULL, joined_at = NULL WHERE id = ? AND league_id = ?",
                (new_user_team["id"], league_id),
            )
            if old_sub and old_sub != new_sub:
                conn.execute(
                    "UPDATE team SET user_sub = ?, joined_at = ? WHERE id = ? AND league_id = ?",
                    (old_sub, now, new_user_team["id"], league_id),
                )

    return {
        "league": get_league(league_id),
        "commissioner_team": get_team(comm_team["id"]),
        "previous_commissioner_sub": old_sub,
    }


def admin_assign_team_user(league_id: str, team_id: str, user_sub: str) -> dict[str, Any]:
    """Attach an existing account to a franchise. Bypasses claim-link and draft-status gates."""
    team = get_team(team_id)
    if not team or str(team.get("league_id")) != str(league_id):
        raise ValueError("Team not found in this league")
    if team.get("is_bot"):
        raise ValueError("Cannot link a bot seat")
    clean_sub = str(user_sub or "").strip()
    if not clean_sub:
        raise ValueError("User is required")
    existing_owner = str(team.get("user_sub") or "").strip()
    if existing_owner and existing_owner != clean_sub:
        raise ValueError("Team is already claimed by another account")
    other = get_team_by_user(league_id, clean_sub)
    if other and str(other.get("id")) != str(team_id):
        other_name = str(other.get("name") or "another team")
        raise ValueError(f"That account already owns {other_name} in this league")
    if existing_owner == clean_sub:
        set_hub_focus(clean_sub, league_id=league_id)
        return {"team": get_team(team_id) or team, "already_member": True}
    claimed = assign_team_user(team_id, clean_sub)
    pending = get_pending_invite_for_team(league_id, team_id)
    if pending:
        revoke_league_invite(league_id, str(pending["id"]))
    set_hub_focus(clean_sub, league_id=league_id)
    return {"team": get_team(team_id) or claimed, "already_member": False}


def admin_release_team_claim(league_id: str, team_id: str, *, allow_commissioner: bool = False) -> dict[str, Any]:
    team = get_team(team_id)
    if not team or team["league_id"] != league_id:
        raise ValueError("Team not found in this league")
    if team.get("is_commissioner") and not allow_commissioner:
        raise ValueError("Commissioner team cannot be unlinked without force")
    with get_conn() as conn:
        conn.execute(
            "UPDATE team SET user_sub = NULL, joined_at = NULL WHERE id = ? AND league_id = ?",
            (team_id, league_id),
        )
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
        return _team_dict(row)


def delete_league(league_id: str) -> dict[str, Any]:
    league = get_league(league_id)
    if not league:
        raise ValueError("League not found")
    team_ids = [str(t["id"]) for t in list_league_teams(league_id)]
    ws_id = roster_workspace_for_league(league)
    with get_conn() as conn:
        if team_ids:
            placeholders = ",".join("?" * len(team_ids))
            conn.execute(
                f"DELETE FROM roster_slot WHERE team_id IN ({placeholders})",
                team_ids,
            )
        # Practice rooms isolate rosters under the league id — wipe that workspace too.
        if league.get("test_mode") and ws_id:
            conn.execute("DELETE FROM roster_slot WHERE workspace_id = ?", (ws_id,))
        conn.execute("DELETE FROM draft_event WHERE league_id = ?", (league_id,))
        conn.execute("DELETE FROM draft_session WHERE league_id = ?", (league_id,))
        conn.execute("DELETE FROM trade_log WHERE league_id = ?", (league_id,))
        conn.execute("DELETE FROM league_invite WHERE league_id = ?", (league_id,))
        channel_ids = [
            str(r["id"])
            for r in conn.execute(
                "SELECT id FROM league_chat_channel WHERE league_id = ?",
                (league_id,),
            ).fetchall()
        ]
        if channel_ids:
            placeholders = ",".join("?" * len(channel_ids))
            conn.execute(
                f"DELETE FROM league_chat_message WHERE channel_id IN ({placeholders})",
                channel_ids,
            )
        conn.execute("DELETE FROM league_chat_channel WHERE league_id = ?", (league_id,))
        conn.execute("DELETE FROM team WHERE league_id = ?", (league_id,))
        conn.execute("DELETE FROM league WHERE id = ?", (league_id,))
    return {
        "deleted_league_id": league_id,
        "league_name": league.get("name"),
        "room_code": league.get("room_code"),
        "workspace_id": ws_id,
        "teams_removed": len(team_ids),
    }


def _contract_row_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["needs_review"] = bool(d.get("needs_review"))
    d["sleeper_verified"] = bool(d.get("sleeper_verified"))
    return d


def record_legacy_import(
    league_id: str,
    season_year: int,
    *,
    source_kind: str,
    source_path: str | None,
    imported_by_sub: str | None,
    row_count: int,
) -> int:
    now = _utcnow()
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO league_legacy_import
               (league_id, season_year, source_kind, source_path, imported_at, imported_by_sub, row_count)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (league_id, int(season_year), source_kind, source_path, now, imported_by_sub, int(row_count)),
        )
        _bump_revision_conn(conn, league_id, "historic_snapshot_revision")
        return int(cur.lastrowid)


def list_legacy_imports(league_id: str) -> list[dict[str, Any]]:
    """Latest import record per season (most recent imported_at)."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_legacy_import
               WHERE league_id = ?
               ORDER BY season_year, imported_at DESC""",
            (str(league_id),),
        ).fetchall()
    best: dict[int, dict[str, Any]] = {}
    for row in rows:
        yr = int(row["season_year"])
        if yr not in best:
            best[yr] = dict(row)
    return sorted(best.values(), key=lambda r: int(r["season_year"]))


def update_legacy_import_metadata(
    league_id: str,
    season_year: int,
    *,
    snapshot_phase: str | None = None,
    source_fingerprint: str | None = None,
    as_of: str | None = None,
    ruleset_version: str | None = None,
    salary_cap: float | None = None,
) -> None:
    """Update metadata on the most recent import row for a season."""
    with get_conn() as conn:
        row = conn.execute(
            """SELECT id FROM league_legacy_import
               WHERE league_id = ? AND season_year = ?
               ORDER BY imported_at DESC LIMIT 1""",
            (str(league_id), int(season_year)),
        ).fetchone()
        if not row:
            return
        sets: list[str] = []
        params: list[Any] = []
        if snapshot_phase is not None:
            sets.append("snapshot_phase = ?")
            params.append(snapshot_phase)
        if source_fingerprint is not None:
            sets.append("source_fingerprint = ?")
            params.append(source_fingerprint)
        if as_of is not None:
            sets.append("as_of = ?")
            params.append(as_of)
        if ruleset_version is not None:
            sets.append("ruleset_version = ?")
            params.append(ruleset_version)
        if salary_cap is not None:
            sets.append("salary_cap = ?")
            params.append(float(salary_cap))
        if not sets:
            return
        params.append(int(row["id"]))
        conn.execute(
            f"UPDATE league_legacy_import SET {', '.join(sets)} WHERE id = ?",
            params,
        )


def replace_league_import_quarantine(
    league_id: str,
    items: list[dict[str, Any]],
) -> int:
    """Replace block/row quarantine inventory for a league (SCORE-44)."""
    import json

    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM league_import_quarantine WHERE league_id = ?",
            (str(league_id),),
        )
        count = 0
        for item in items:
            conn.execute(
                """INSERT INTO league_import_quarantine (
                    league_id, season_year, reason_code, message,
                    owner_label, player_name, source_ref, detail_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(league_id),
                    item.get("season_year"),
                    str(item.get("reason_code") or "unknown"),
                    str(item.get("message") or ""),
                    item.get("owner_label"),
                    item.get("player_name"),
                    item.get("source_ref"),
                    json.dumps(item.get("detail") or {}, sort_keys=True),
                    now,
                ),
            )
            count += 1
    return count


def list_league_import_quarantine(
    league_id: str,
    *,
    season_year: int | None = None,
) -> list[dict[str, Any]]:
    import json

    with get_conn() as conn:
        if season_year is None:
            rows = conn.execute(
                """SELECT * FROM league_import_quarantine
                   WHERE league_id = ?
                   ORDER BY season_year, reason_code, id""",
                (str(league_id),),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM league_import_quarantine
                   WHERE league_id = ? AND season_year = ?
                   ORDER BY reason_code, id""",
                (str(league_id), int(season_year)),
            ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        d = dict(row)
        raw = d.pop("detail_json", None)
        try:
            d["detail"] = json.loads(raw) if raw else {}
        except (TypeError, ValueError, json.JSONDecodeError):
            d["detail"] = {}
        out.append(d)
    return out


def replace_league_contract_season(
    league_id: str,
    season_year: int,
    rows: list[dict[str, Any]],
    *,
    import_id: int | None = None,
) -> int:
    """Replace imported contract rows for one season (manual edits preserved via re-apply if needed)."""
    return replace_league_contract_season_source(
        league_id,
        season_year,
        rows,
        source_kind="import",
        import_id=import_id,
    )


def replace_league_contract_season_source(
    league_id: str,
    season_year: int,
    rows: list[dict[str, Any]],
    *,
    source_kind: str = "import",
    import_id: int | None = None,
) -> int:
    """Replace contract rows for one season + source_kind (manual / other sources preserved)."""
    now = _utcnow()
    kind = str(source_kind or "import")
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM league_contract_row WHERE league_id = ? AND season_year = ? AND source_kind = ?",
            (league_id, int(season_year), kind),
        )
        count = 0
        for r in rows:
            conn.execute(
                """INSERT INTO league_contract_row (
                    league_id, season_year, owner_label, hub_team_name, player_name, player_id,
                    position, base_salary, cap_hit, prior_salary, original_draft_year,
                    roster_status, contract_phase, acquisition_type, status_note,
                    source_kind, confidence, needs_review, review_reason, sleeper_verified,
                    import_id, franchise_id, obligation_kind, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    league_id,
                    int(season_year),
                    r["owner_label"],
                    r.get("hub_team_name"),
                    r["player_name"],
                    r.get("player_id"),
                    r.get("position"),
                    r.get("base_salary"),
                    r.get("cap_hit"),
                    r.get("prior_salary"),
                    r.get("original_draft_year"),
                    r.get("roster_status") or "active",
                    r.get("contract_phase"),
                    r.get("acquisition_type"),
                    r.get("status_note"),
                    r.get("source_kind") or kind,
                    r.get("confidence") or ("imported" if kind == "import" else kind),
                    1 if r.get("needs_review") else 0,
                    r.get("review_reason"),
                    1 if r.get("sleeper_verified") else 0,
                    import_id,
                    r.get("franchise_id"),
                    r.get("obligation_kind") or "ownership",
                    now,
                    now,
                ),
            )
            count += 1
        _bump_revision_conn(conn, league_id, "historic_snapshot_revision")
    return count


def list_league_contract_seasons(league_id: str) -> list[int]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT season_year FROM league_contract_row
               WHERE league_id = ? ORDER BY season_year DESC""",
            (league_id,),
        ).fetchall()
    return [int(r["season_year"]) for r in rows]


def list_league_contract_rows(
    league_id: str,
    *,
    season_year: int | None = None,
    owner_label: str | None = None,
    needs_review: bool | None = None,
) -> list[dict[str, Any]]:
    clauses = ["league_id = ?"]
    params: list[Any] = [league_id]
    if season_year is not None:
        clauses.append("season_year = ?")
        params.append(int(season_year))
    if owner_label:
        clauses.append("owner_label = ?")
        params.append(owner_label)
    if needs_review is not None:
        clauses.append("needs_review = ?")
        params.append(1 if needs_review else 0)
    sql = f"SELECT * FROM league_contract_row WHERE {' AND '.join(clauses)} ORDER BY owner_label, player_name"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_contract_row_dict(r) for r in rows]


def get_league_contract_row(row_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM league_contract_row WHERE id = ?", (int(row_id),)).fetchone()
    return _contract_row_dict(row) if row else None


def update_league_contract_row(
    row_id: int,
    updates: dict[str, Any],
    *,
    edited_by_sub: str,
    note: str | None = None,
) -> dict[str, Any]:
    allowed = {
        "owner_label", "hub_team_name", "player_name", "player_id", "position",
        "base_salary", "cap_hit", "prior_salary", "original_draft_year",
        "roster_status", "contract_phase", "acquisition_type", "status_note",
        "confidence", "needs_review", "review_reason", "sleeper_verified",
        "franchise_id", "obligation_kind",
    }
    row = get_league_contract_row(row_id)
    if not row:
        raise ValueError("Contract row not found")
    original_kind = str(row.get("source_kind") or "")
    sets: list[str] = []
    params: list[Any] = []
    now = _utcnow()
    with get_conn() as conn:
        for key, val in updates.items():
            if key not in allowed:
                continue
            old = row.get(key)
            if old == val:
                continue
            sets.append(f"{key} = ?")
            if key == "needs_review":
                params.append(1 if val else 0)
            elif key == "sleeper_verified":
                params.append(1 if val else 0)
            else:
                params.append(val)
            conn.execute(
                """INSERT INTO league_contract_row_edit
                   (row_id, field_name, old_value, new_value, edited_by_sub, edited_at, note)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (row_id, key, str(old) if old is not None else None, str(val) if val is not None else None, edited_by_sub, now, note),
            )
        if not sets:
            return row
        sets.append("source_kind = ?")
        params.append("manual")
        sets.append("updated_at = ?")
        params.append(now)
        params.append(row_id)
        conn.execute(
            f"UPDATE league_contract_row SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        _bump_revision_conn(conn, str(row["league_id"]), "historic_snapshot_revision")
    updated = get_league_contract_row(row_id)
    # SCORE-39: editing a Sleeper sheet row must not remove it from the Sleeper
    # membership base. Re-seed the pre-edit Sleeper row so later sync can merge
    # manuals on top instead of dropping corrections when Sleeper rows remain.
    if updated and original_kind in {"week1_sleeper", "pre_draft_sleeper"}:
        from src.draft_hub.sheet_roster_sync import preserve_sleeper_base_after_manual_edit

        preserve_sleeper_base_after_manual_edit(
            str(row["league_id"]),
            season_year=int(row["season_year"]),
            original_row={**row, "source_kind": original_kind},
        )
    return updated or row


def delete_league_contract_row(row_id: int, league_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM league_contract_row WHERE id = ? AND league_id = ?",
            (int(row_id), league_id),
        )
        if cur.rowcount > 0:
            _bump_revision_conn(conn, league_id, "historic_snapshot_revision")
        return cur.rowcount > 0


def insert_league_contract_row(
    league_id: str,
    season_year: int,
    row: dict[str, Any],
) -> dict[str, Any]:
    """Insert a commissioner-authored contract snapshot row."""
    now = _utcnow()
    cap_hit = row.get("cap_hit")
    base_salary = row.get("base_salary", cap_hit)
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO league_contract_row (
                league_id, season_year, owner_label, hub_team_name, player_name, player_id,
                position, base_salary, cap_hit, prior_salary, original_draft_year,
                roster_status, contract_phase, acquisition_type, status_note,
                source_kind, confidence, needs_review, review_reason, sleeper_verified,
                import_id, franchise_id, obligation_kind, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                league_id,
                int(season_year),
                row["owner_label"],
                row.get("hub_team_name"),
                row["player_name"],
                row.get("player_id"),
                row.get("position"),
                base_salary,
                cap_hit,
                row.get("prior_salary"),
                row.get("original_draft_year"),
                row.get("roster_status") or "active",
                row.get("contract_phase"),
                row.get("acquisition_type"),
                row.get("status_note"),
                row.get("source_kind") or "manual",
                row.get("confidence") or "manual",
                1 if row.get("needs_review") else 0,
                row.get("review_reason"),
                1 if row.get("sleeper_verified") else 0,
                row.get("import_id"),
                row.get("franchise_id"),
                row.get("obligation_kind") or "ownership",
                now,
                now,
            ),
        )
        row_id = int(cur.lastrowid)
        _bump_revision_conn(conn, league_id, "historic_snapshot_revision")
    created = get_league_contract_row(row_id)
    if not created:
        raise ValueError("Failed to create contract row")
    return created


def _owner_season_map_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def get_owner_season_map_row(
    league_id: str,
    season_year: int,
    owner_label: str,
) -> dict[str, Any] | None:
    owner = str(owner_label or "").strip()
    if not owner:
        return None
    with get_conn() as conn:
        row = conn.execute(
            """SELECT * FROM league_owner_season_map
               WHERE league_id = ? AND season_year = ? AND owner_label = ?""",
            (league_id, int(season_year), owner),
        ).fetchone()
    return _owner_season_map_dict(row) if row else None


def retarget_owner_season_map_team_name(
    league_id: str,
    season_year: int,
    old_name: str,
    new_name: str,
) -> int:
    """Follow a Hub team rename so owner maps keep pointing at the same franchise."""
    old = str(old_name or "").strip()
    new = str(new_name or "").strip()
    if not old or not new or old == new:
        return 0
    now = _utcnow()
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE league_owner_season_map
               SET hub_team_name = ?, source_kind = 'sleeper_rename', updated_at = ?
               WHERE league_id = ? AND season_year = ? AND hub_team_name = ?""",
            (new, now, league_id, int(season_year), old),
        )
        return int(cur.rowcount or 0)


def list_owner_season_map(
    league_id: str,
    *,
    season_year: int | None = None,
) -> list[dict[str, Any]]:
    ensure_owner_season_map_seeded(league_id)
    clauses = ["league_id = ?"]
    params: list[Any] = [league_id]
    if season_year is not None:
        clauses.append("season_year = ?")
        params.append(int(season_year))
    sql = (
        f"SELECT * FROM league_owner_season_map WHERE {' AND '.join(clauses)} "
        "ORDER BY season_year DESC, owner_label"
    )
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_owner_season_map_dict(r) for r in rows]


def upsert_owner_season_map(
    league_id: str,
    season_year: int,
    owner_label: str,
    hub_team_name: str,
    *,
    sleeper_user_id: str | None = None,
    source_kind: str = "manual",
) -> dict[str, Any]:
    now = _utcnow()
    owner = str(owner_label or "").strip()
    team = str(hub_team_name or "").strip()
    if not owner or not team:
        raise ValueError("owner_label and hub_team_name are required")
    with get_conn() as conn:
        prior = conn.execute(
            """SELECT hub_team_name, sleeper_user_id, source_kind FROM league_owner_season_map
               WHERE league_id = ? AND season_year = ? AND owner_label = ?""",
            (league_id, int(season_year), owner),
        ).fetchone()
        conn.execute(
            """INSERT INTO league_owner_season_map (
                league_id, season_year, owner_label, hub_team_name, sleeper_user_id,
                source_kind, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(league_id, season_year, owner_label) DO UPDATE SET
                hub_team_name = excluded.hub_team_name,
                sleeper_user_id = COALESCE(excluded.sleeper_user_id, league_owner_season_map.sleeper_user_id),
                source_kind = excluded.source_kind,
                updated_at = excluded.updated_at""",
            (
                league_id,
                int(season_year),
                owner,
                team,
                sleeper_user_id,
                source_kind,
                now,
                now,
            ),
        )
        row = conn.execute(
            """SELECT * FROM league_owner_season_map
               WHERE league_id = ? AND season_year = ? AND owner_label = ?""",
            (league_id, int(season_year), owner),
        ).fetchone()
        # One-time seeds must not bump historic revisions. Listing teams (or
        # previewing a correction) can seed the map as a read side-effect.
        changed = prior is None or (
            str(prior["hub_team_name"] or "") != team
            or (sleeper_user_id is not None and str(prior["sleeper_user_id"] or "") != str(sleeper_user_id))
            or str(prior["source_kind"] or "") != str(source_kind)
        )
        if changed and source_kind not in {"yaml_seed", "contract_seed"}:
            _bump_revision_conn(conn, league_id, "historic_snapshot_revision")
    return _owner_season_map_dict(row) if row else {}


def delete_owner_season_map(map_id: int, league_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM league_owner_season_map WHERE id = ? AND league_id = ?",
            (int(map_id), league_id),
        )
        if cur.rowcount > 0:
            _bump_revision_conn(conn, league_id, "historic_snapshot_revision")
        return cur.rowcount > 0


def list_season_salary_caps(league_id: str) -> dict[int, float]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT season_year, salary_cap FROM league_season_salary_cap
               WHERE league_id = ? ORDER BY season_year""",
            (league_id,),
        ).fetchall()
    return {int(r["season_year"]): float(r["salary_cap"]) for r in rows}


def upsert_season_salary_cap(
    league_id: str,
    season_year: int,
    salary_cap: float,
) -> dict[str, Any]:
    cap = float(salary_cap)
    if cap < 0:
        raise ValueError("salary_cap must be non-negative")
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO league_season_salary_cap (
                league_id, season_year, salary_cap, updated_at
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(league_id, season_year) DO UPDATE SET
                salary_cap = excluded.salary_cap,
                updated_at = excluded.updated_at""",
            (league_id, int(season_year), cap, now),
        )
        row = conn.execute(
            """SELECT * FROM league_season_salary_cap
               WHERE league_id = ? AND season_year = ?""",
            (league_id, int(season_year)),
        ).fetchone()
    if not row:
        raise ValueError("Failed to save season salary cap")
    return dict(row)


def resolve_salary_cap_for_season(
    league_id: str,
    season_year: int,
    default_cap: float,
    *,
    caps: dict[int, float] | None = None,
) -> float:
    season_caps = caps if caps is not None else list_season_salary_caps(league_id)
    return float(season_caps.get(int(season_year), float(default_cap)))


def resolve_hub_team_name(
    league_id: str,
    season_year: int,
    owner_label: str,
) -> str | None:
    owner = str(owner_label or "").strip()
    if not owner:
        return None
    ensure_owner_season_map_seeded(league_id)
    with get_conn() as conn:
        row = conn.execute(
            """SELECT hub_team_name FROM league_owner_season_map
               WHERE league_id = ? AND season_year = ? AND owner_label = ?""",
            (league_id, int(season_year), owner),
        ).fetchone()
        if row and row["hub_team_name"]:
            return str(row["hub_team_name"])
        has_custom_map = conn.execute(
            "SELECT 1 FROM league_owner_season_map WHERE league_id = ? LIMIT 1",
            (league_id,),
        ).fetchone()
    if has_custom_map:
        return None
    from src.draft_hub.legacy_contract_import import load_owner_team_map

    return load_owner_team_map().get(owner)


def ensure_owner_season_map_seeded(league_id: str) -> None:
    """One-time seed from contract rows, then yaml, for each imported season."""
    with get_conn() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM league_owner_season_map WHERE league_id = ?",
            (league_id,),
        ).fetchone()["n"]
    if count:
        return
    from src.draft_hub.legacy_contract_import import TEAM_OWNERS, load_owner_team_map

    yaml_map = load_owner_team_map()
    seasons = list_league_contract_seasons(league_id)
    if not seasons:
        return
    for yr in seasons:
        by_owner: dict[str, str] = {}
        for row in list_league_contract_rows(league_id, season_year=yr):
            owner = str(row.get("owner_label") or "").strip()
            team = str(row.get("hub_team_name") or "").strip()
            if owner and team:
                by_owner[owner] = team
        owners = list(dict.fromkeys([*by_owner.keys(), *TEAM_OWNERS]))
        for owner in owners:
            team = by_owner.get(owner) or yaml_map.get(owner)
            if not team:
                continue
            upsert_owner_season_map(
                league_id,
                yr,
                owner,
                team,
                source_kind="contract_seed" if owner in by_owner else "yaml_seed",
            )


def replace_league_movements(league_id: str, season_year: int, events: list[dict[str, Any]]) -> int:
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM league_player_movement WHERE league_id = ? AND season_year = ? AND source != 'manual'",
            (league_id, int(season_year)),
        )
        count = 0
        for ev in events:
            conn.execute(
                """INSERT INTO league_player_movement (
                    league_id, season_year, week, player_name, player_id, event_type,
                    from_owner, to_owner, salary, dead_cap, source, confidence,
                    sleeper_transaction_id, payload_json, event_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    league_id,
                    int(season_year),
                    ev.get("week"),
                    ev["player_name"],
                    ev.get("player_id"),
                    ev.get("event_type"),
                    ev.get("from_owner"),
                    ev.get("to_owner"),
                    ev.get("salary"),
                    ev.get("dead_cap"),
                    ev.get("source") or "inferred",
                    ev.get("confidence") or "inferred",
                    ev.get("sleeper_transaction_id"),
                    json.dumps(ev.get("payload")) if ev.get("payload") is not None else None,
                    ev.get("event_at"),
                    now,
                ),
            )
            count += 1
    return count


def get_league_movement(movement_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM league_player_movement WHERE id = ?",
            (int(movement_id),),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    if d.get("payload_json"):
        try:
            d["payload"] = json.loads(d["payload_json"])
        except json.JSONDecodeError:
            d["payload"] = None
    return d


def update_league_movement(movement_id: int, updates: dict[str, Any]) -> dict[str, Any] | None:
    allowed = {"event_type", "from_owner", "to_owner", "salary", "dead_cap", "confidence", "week"}
    sets: list[str] = []
    params: list[Any] = []
    for key, val in updates.items():
        if key not in allowed:
            continue
        sets.append(f"{key} = ?")
        params.append(val)
    if not sets:
        return get_league_movement(movement_id)
    params.append(int(movement_id))
    with get_conn() as conn:
        conn.execute(
            f"UPDATE league_player_movement SET {', '.join(sets)} WHERE id = ?",
            params,
        )
    return get_league_movement(movement_id)


def list_league_movements(
    league_id: str,
    *,
    season_year: int | None = None,
) -> list[dict[str, Any]]:
    clauses = ["league_id = ?"]
    params: list[Any] = [league_id]
    if season_year is not None:
        clauses.append("season_year = ?")
        params.append(int(season_year))
    sql = f"SELECT * FROM league_player_movement WHERE {' AND '.join(clauses)} ORDER BY season_year, id"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        if d.get("payload_json"):
            try:
                d["payload"] = json.loads(d["payload_json"])
            except json.JSONDecodeError:
                d["payload"] = None
        out.append(d)
    return out


def _player_name_alias_dict(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return dict(row)


def list_player_name_aliases(league_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM league_player_name_alias
               WHERE league_id = ? ORDER BY alias_name COLLATE NOCASE""",
            (league_id,),
        ).fetchall()
    return [_player_name_alias_dict(r) for r in rows]


def upsert_player_name_alias(
    league_id: str,
    alias_name: str,
    canonical_name: str,
    *,
    position: str | None = None,
    sleeper_player_id: str | None = None,
    source_kind: str = "manual",
) -> dict[str, Any]:
    now = _utcnow()
    alias = str(alias_name or "").strip()
    canonical = str(canonical_name or "").strip()
    if not alias or not canonical:
        raise ValueError("alias_name and canonical_name are required")
    pos = str(position or "").strip().upper() or None
    if pos in {"DST", "D"}:
        pos = "DEF"
    sid = str(sleeper_player_id or "").strip() or None
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO league_player_name_alias (
                league_id, alias_name, canonical_name, sleeper_player_id, position,
                source_kind, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(league_id, alias_name) DO UPDATE SET
                canonical_name = excluded.canonical_name,
                sleeper_player_id = COALESCE(excluded.sleeper_player_id, league_player_name_alias.sleeper_player_id),
                position = COALESCE(excluded.position, league_player_name_alias.position),
                source_kind = excluded.source_kind,
                updated_at = excluded.updated_at""",
            (league_id, alias, canonical, sid, pos, source_kind, now, now),
        )
        row = conn.execute(
            """SELECT * FROM league_player_name_alias
               WHERE league_id = ? AND alias_name = ?""",
            (league_id, alias),
        ).fetchone()
    if not row:
        raise RuntimeError("Failed to upsert player name alias")
    return _player_name_alias_dict(row)


def delete_player_name_alias(alias_id: int, league_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM league_player_name_alias WHERE id = ? AND league_id = ?",
            (int(alias_id), league_id),
        )
    return cur.rowcount > 0


def _fa_bid_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    return {
        "id": row["id"],
        "league_id": row["league_id"],
        "team_id": row["team_id"],
        "player_id": row["player_id"],
        "player_name": row["player_name"],
        "nfl_team": row["nfl_team"] if "nfl_team" in keys else None,
        "position": row["position"],
        "bid_amount": float(row["bid_amount"]),
        "window_id": row["window_id"],
        "status": row["status"],
        "user_sub": row["user_sub"] if "user_sub" in keys else None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def upsert_fa_bid(
    *,
    league_id: str,
    team_id: str,
    player_id: str,
    player_name: str | None,
    nfl_team: str | None,
    position: str | None,
    bid_amount: float,
    window_id: str,
    user_sub: str | None,
) -> dict[str, Any]:
    now = _utcnow()
    bid_id = str(uuid.uuid4())
    with get_conn() as conn:
        existing = conn.execute(
            """SELECT id FROM fa_bid
               WHERE league_id = ? AND team_id = ? AND player_id = ? AND window_id = ?""",
            (league_id, team_id, player_id, window_id),
        ).fetchone()
        if existing:
            conn.execute(
                """UPDATE fa_bid
                   SET player_name = ?, nfl_team = ?, position = ?, bid_amount = ?,
                       status = 'open', user_sub = ?, updated_at = ?
                   WHERE id = ?""",
                (
                    player_name,
                    nfl_team,
                    position,
                    float(bid_amount),
                    user_sub,
                    now,
                    existing["id"],
                ),
            )
            row = conn.execute(
                "SELECT * FROM fa_bid WHERE id = ?", (existing["id"],)
            ).fetchone()
        else:
            conn.execute(
                """INSERT INTO fa_bid (
                    id, league_id, team_id, player_id, player_name, nfl_team, position,
                    bid_amount, window_id, status, user_sub, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)""",
                (
                    bid_id,
                    league_id,
                    team_id,
                    player_id,
                    player_name,
                    nfl_team,
                    position,
                    float(bid_amount),
                    window_id,
                    user_sub,
                    now,
                    now,
                ),
            )
            row = conn.execute("SELECT * FROM fa_bid WHERE id = ?", (bid_id,)).fetchone()
    return _fa_bid_dict(row)


def list_fa_bids(
    league_id: str,
    *,
    window_id: str | None = None,
    player_id: str | None = None,
    status: str | None = "open",
) -> list[dict[str, Any]]:
    sql = "SELECT * FROM fa_bid WHERE league_id = ?"
    params: list[Any] = [league_id]
    if window_id:
        sql += " AND window_id = ?"
        params.append(window_id)
    if player_id:
        sql += " AND player_id = ?"
        params.append(player_id)
    if status:
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY bid_amount DESC, created_at ASC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_fa_bid_dict(r) for r in rows]


def list_open_fa_window_ids(league_id: str) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT window_id FROM fa_bid
               WHERE league_id = ? AND status = 'open'""",
            (league_id,),
        ).fetchall()
    return [str(r["window_id"]) for r in rows]


def close_fa_bids_for_player(
    league_id: str,
    window_id: str,
    player_id: str,
    *,
    winner_id: str | None,
) -> None:
    now = _utcnow()
    with get_conn() as conn:
        if winner_id:
            conn.execute(
                """UPDATE fa_bid SET status = 'won', updated_at = ?
                   WHERE id = ? AND league_id = ?""",
                (now, winner_id, league_id),
            )
            conn.execute(
                """UPDATE fa_bid SET status = 'lost', updated_at = ?
                   WHERE league_id = ? AND window_id = ? AND player_id = ?
                     AND id != ? AND status = 'open'""",
                (now, league_id, window_id, player_id, winner_id),
            )
        else:
            conn.execute(
                """UPDATE fa_bid SET status = 'cancelled', updated_at = ?
                   WHERE league_id = ? AND window_id = ? AND player_id = ?
                     AND status = 'open'""",
                (now, league_id, window_id, player_id),
            )
