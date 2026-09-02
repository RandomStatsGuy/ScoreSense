"""ScoreSense native account storage (email + password)."""

from __future__ import annotations

import re
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Generator

from src.config import AUTH_DB, AUTH_DIR, TERMS_VERSION

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS app_user (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    google_sub TEXT,
    has_password INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_app_user_email ON app_user(email);

CREATE TABLE IF NOT EXISTS auth_email_token (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    FOREIGN KEY (user_id) REFERENCES app_user(id)
);
CREATE INDEX IF NOT EXISTS idx_auth_email_token_user ON auth_email_token(user_id, purpose);
"""


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


def validate_email(email: str) -> None:
    if not _EMAIL_RE.match(normalize_email(email)):
        raise ValueError("Enter a valid email address")


def validate_password(password: str) -> None:
    if len(password or "") < 8:
        raise ValueError("Password must be at least 8 characters")


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def _migrate_schema(conn: sqlite3.Connection) -> None:
    added_verified_col = False
    if not _column_exists(conn, "app_user", "email_verified_at"):
        conn.execute("ALTER TABLE app_user ADD COLUMN email_verified_at TEXT")
        added_verified_col = True
    if not _column_exists(conn, "app_user", "terms_accepted_at"):
        conn.execute("ALTER TABLE app_user ADD COLUMN terms_accepted_at TEXT")
    if not _column_exists(conn, "app_user", "terms_version"):
        conn.execute("ALTER TABLE app_user ADD COLUMN terms_version TEXT")
    if not _column_exists(conn, "app_user", "google_sub"):
        conn.execute("ALTER TABLE app_user ADD COLUMN google_sub TEXT")
    if not _column_exists(conn, "app_user", "has_password"):
        conn.execute("ALTER TABLE app_user ADD COLUMN has_password INTEGER NOT NULL DEFAULT 1")
    conn.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_google_sub
           ON app_user(google_sub) WHERE google_sub IS NOT NULL"""
    )
    if added_verified_col:
        conn.execute(
            "UPDATE app_user SET email_verified_at = created_at WHERE email_verified_at IS NULL"
        )


@contextmanager
def get_conn() -> Generator[sqlite3.Connection, None, None]:
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(AUTH_DB)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(_SCHEMA)
        _migrate_schema(conn)
        yield conn
        conn.commit()
    finally:
        conn.close()


def _user_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "email_verified_at": row["email_verified_at"] if "email_verified_at" in row.keys() else None,
        "terms_accepted_at": row["terms_accepted_at"] if "terms_accepted_at" in row.keys() else None,
        "terms_version": row["terms_version"] if "terms_version" in row.keys() else None,
        "google_sub": row["google_sub"] if "google_sub" in row.keys() else None,
        "has_password": bool(row["has_password"]) if "has_password" in row.keys() else True,
    }


def is_email_verified(user: dict[str, Any] | None) -> bool:
    if not user:
        return False
    return bool(user.get("email_verified_at"))


def has_usable_password(user: dict[str, Any] | None) -> bool:
    if not user:
        return False
    return bool(user.get("has_password"))


def create_user(
    email: str,
    password_hash: str,
    display_name: str,
    *,
    terms_version: str | None = None,
) -> dict[str, Any]:
    validate_email(email)
    email_norm = normalize_email(email)
    name = str(display_name or "").strip() or email_norm.split("@")[0]
    user_id = str(uuid.uuid4())
    now = _utcnow()
    terms_ver = terms_version or TERMS_VERSION
    with get_conn() as conn:
        try:
            conn.execute(
                """INSERT INTO app_user (
                       id, email, password_hash, display_name,
                       created_at, updated_at,
                       email_verified_at, terms_accepted_at, terms_version
                   ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)""",
                (user_id, email_norm, password_hash, name, now, now, now, terms_ver),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("An account with that email already exists") from exc
        row = conn.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        return _user_dict(row)


def mark_email_verified(user_id: str) -> dict[str, Any] | None:
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "UPDATE app_user SET email_verified_at = ?, updated_at = ? WHERE id = ?",
            (now, now, user_id),
        )
        row = conn.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        return _user_dict(row) if row else None


def update_password(user_id: str, password_hash: str) -> None:
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "UPDATE app_user SET password_hash = ?, has_password = 1, updated_at = ? WHERE id = ?",
            (password_hash, now, user_id),
        )


def update_display_name(user_id: str, display_name: str) -> dict[str, Any] | None:
    name = str(display_name or "").strip()
    if not name:
        raise ValueError("Display name is required")
    now = _utcnow()
    with get_conn() as conn:
        conn.execute(
            "UPDATE app_user SET display_name = ?, updated_at = ? WHERE id = ?",
            (name, now, user_id),
        )
        row = conn.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        return _user_dict(row) if row else None


def accept_terms(user_id: str, terms_version: str | None = None) -> dict[str, Any] | None:
    now = _utcnow()
    ver = terms_version or TERMS_VERSION
    with get_conn() as conn:
        conn.execute(
            """UPDATE app_user SET terms_accepted_at = ?, terms_version = ?, updated_at = ?
               WHERE id = ?""",
            (now, ver, now, user_id),
        )
        row = conn.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        return _user_dict(row) if row else None


def delete_user(user_id: str) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM auth_email_token WHERE user_id = ?", (user_id,))
        cur = conn.execute("DELETE FROM app_user WHERE id = ?", (user_id,))
        return cur.rowcount > 0


def create_email_token(user_id: str, purpose: str, *, hours: int = 24) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM auth_email_token WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
            (user_id, purpose),
        )
        conn.execute(
            """INSERT INTO auth_email_token (token, user_id, purpose, expires_at, used_at)
               VALUES (?, ?, ?, ?, NULL)""",
            (token, user_id, purpose, expires),
        )
    return token


def consume_email_token(token: str, purpose: str) -> dict[str, Any] | None:
    now = _utcnow()
    with get_conn() as conn:
        row = conn.execute(
            """SELECT t.*, u.email, u.display_name
               FROM auth_email_token t
               JOIN app_user u ON u.id = t.user_id
               WHERE t.token = ? AND t.purpose = ? AND t.used_at IS NULL""",
            (token, purpose),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] < now:
            return None
        conn.execute(
            "UPDATE auth_email_token SET used_at = ? WHERE token = ?",
            (now, token),
        )
        user = _user_dict(conn.execute("SELECT * FROM app_user WHERE id = ?", (row["user_id"],)).fetchone())
        return user


def create_google_user(
    email: str,
    password_hash: str,
    display_name: str,
    google_sub: str,
    *,
    terms_version: str | None = None,
) -> dict[str, Any]:
    """Create a Google-linked account. Email is already verified by Google."""
    validate_email(email)
    email_norm = normalize_email(email)
    sub = str(google_sub or "").strip()
    if not sub:
        raise ValueError("Google account is missing an id")
    name = str(display_name or "").strip() or email_norm.split("@")[0]
    user_id = str(uuid.uuid4())
    now = _utcnow()
    terms_ver = terms_version or TERMS_VERSION
    with get_conn() as conn:
        try:
            conn.execute(
                """INSERT INTO app_user (
                       id, email, password_hash, display_name,
                       created_at, updated_at,
                       email_verified_at, terms_accepted_at, terms_version,
                       google_sub, has_password
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
                (user_id, email_norm, password_hash, name, now, now, now, now, terms_ver, sub),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("An account with that email already exists") from exc
        row = conn.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        return _user_dict(row)


def link_google_sub(user_id: str, google_sub: str) -> dict[str, Any] | None:
    sub = str(google_sub or "").strip()
    if not sub:
        raise ValueError("Google account is missing an id")
    now = _utcnow()
    with get_conn() as conn:
        try:
            conn.execute(
                """UPDATE app_user
                   SET google_sub = ?,
                       has_password = CASE WHEN email_verified_at IS NULL THEN 0 ELSE has_password END,
                       email_verified_at = COALESCE(email_verified_at, ?),
                       updated_at = ?
                   WHERE id = ?""",
                (sub, now, now, user_id),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("That Google account is already linked") from exc
        row = conn.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        return _user_dict(row) if row else None


def get_user_by_google_sub(google_sub: str) -> dict[str, Any] | None:
    sub = str(google_sub or "").strip()
    if not sub:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM app_user WHERE google_sub = ?", (sub,)).fetchone()
        if not row:
            return None
        d = _user_dict(row)
        d["password_hash"] = row["password_hash"]
        return d


def get_user_by_email(email: str) -> dict[str, Any] | None:
    email_norm = normalize_email(email)
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM app_user WHERE email = ?", (email_norm,)).fetchone()
        if not row:
            return None
        d = _user_dict(row)
        d["password_hash"] = row["password_hash"]
        return d


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
        return _user_dict(row) if row else None


def list_users(*, limit: int = 500) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM app_user ORDER BY created_at DESC LIMIT ?",
            (max(1, min(int(limit), 2000)),),
        ).fetchall()
    return [_user_dict(r) for r in rows]
