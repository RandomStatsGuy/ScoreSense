"""Registered service credentials. Secrets never appear in admin responses.

Keep both admin_ops.db and connections.key in server backups. The independent
encryption key survives account/session-secret rotation and container rebuilds.
New integrations register their fields here and read them with connection_values.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import closing
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from src import config
from src.auth.user_store import validate_email
from src.ops import admin_store

# Config names are deliberately registered, never accepted from an admin form.
# Service hosts/project identifiers remain deployment configuration.
CONNECTIONS = {
    "jira": {
        "label": "Jira",
        "purpose": "Receives reports sent from Report a bug.",
        "fields": {
            "email": {"label": "Account email", "secret": False, "config": "JIRA_EMAIL"},
            "api_token": {"label": "API token", "secret": True, "config": "JIRA_API_TOKEN"},
        },
    },
}

_SCHEMA = """CREATE TABLE IF NOT EXISTS service_connection (
 id TEXT PRIMARY KEY, encrypted_values BLOB NOT NULL,
 updated_at REAL NOT NULL, updated_by TEXT NOT NULL
)"""


class ConnectionStoreError(RuntimeError):
    pass


def connection_spec(connection_id: str) -> dict:
    if connection_id not in CONNECTIONS:
        raise KeyError(connection_id)
    return CONNECTIONS[connection_id]


def _connect():
    conn = admin_store._connect()
    conn.execute(_SCHEMA)
    return conn


def _cipher(*, create: bool = False) -> Fernet:
    path = Path(config.ADMIN_OPS_DIR) / "connections.key"
    try:
        if create and not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            # Saves hold SQLite's write lock, including first-key creation.
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                stream.write(Fernet.generate_key())
        return Fernet(path.read_bytes())
    except (OSError, ValueError):
        raise ConnectionStoreError("Saved connection keys are unavailable. Restore the server connection-key backup.") from None


def _decode(row) -> dict:
    if row is None:
        return {}
    try:
        return json.loads(_cipher().decrypt(row["encrypted_values"]))
    except (InvalidToken, ValueError, TypeError):
        raise ConnectionStoreError("Saved connection keys cannot be read. Restore the server connection-key backup.") from None


def _effective(spec: dict, saved: dict) -> dict[str, str]:
    return {key: saved.get(key, str(getattr(config, field["config"], "") or ""))
            for key, field in spec["fields"].items()}


def connection_values(connection_id: str) -> dict[str, str]:
    """Server-only read; no process cache, so saves apply across workers immediately."""
    spec = connection_spec(connection_id)
    with closing(_connect()) as conn:
        row = conn.execute("SELECT * FROM service_connection WHERE id = ?", (connection_id,)).fetchone()
    return _effective(spec, _decode(row))


def connection_status(connection_id: str) -> dict:
    spec = connection_spec(connection_id)
    with closing(_connect()) as conn:
        row = conn.execute("SELECT * FROM service_connection WHERE id = ?", (connection_id,)).fetchone()
    error = ""
    try:
        saved = _decode(row)
        values = _effective(spec, saved)
    except ConnectionStoreError as exc:
        saved, values, error = {}, {}, str(exc)
    fields = []
    for key, field in spec["fields"].items():
        value = values.get(key, "")
        fields.append({"id": key, "label": field["label"], "secret": field["secret"],
                       "configured": bool(value), "value": "" if field["secret"] else value,
                       "source": "saved" if key in saved else "server" if value else "missing"})
    return {"id": connection_id, "label": spec["label"], "purpose": spec["purpose"],
            "configured": bool(values) and all(values.values()), "fields": fields,
            "updated_at": row["updated_at"] if row else None, "error": error,
            "can_check": connection_id == "jira"}


def list_connections() -> list[dict]:
    return [connection_status(key) for key in CONNECTIONS]


def save_connection(connection_id: str, submitted: dict, *, actor: str) -> dict:
    spec = connection_spec(connection_id)
    if not isinstance(submitted, dict) or set(submitted) - set(spec["fields"]):
        raise ValueError("Use the fields shown for this connection.")
    updates = {}
    for key, raw in submitted.items():
        if not isinstance(raw, str) or len(raw) > 8192 or any(ord(c) < 32 for c in raw):
            raise ValueError("Connection values must be text without line breaks, up to 8192 characters.")
        value = raw.strip()
        if value:
            updates[key] = value
    if not updates:
        raise ValueError("Enter a connection value to save.")
    with closing(_connect()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM service_connection WHERE id = ?", (connection_id,)).fetchone()
        saved = _decode(row)
        saved.update(updates)
        effective = _effective(spec, saved)
        if not all(effective.values()):
            raise ValueError("Fill in every required connection field.")
        if connection_id == "jira":
            validate_email(effective["email"])
        encoded = _cipher(create=True).encrypt(json.dumps(saved).encode())
        conn.execute("INSERT INTO service_connection VALUES (?, ?, ?, ?) "
                     "ON CONFLICT(id) DO UPDATE SET encrypted_values=excluded.encrypted_values, "
                     "updated_at=excluded.updated_at, updated_by=excluded.updated_by",
                     (connection_id, encoded, time.time(), actor))
        # Audit only the action, never fields, values, fingerprints or token suffixes.
        conn.execute("INSERT INTO admin_activity(at, actor, kind, summary) VALUES (?, ?, ?, ?)",
                     (time.time(), actor, "connection", f"Updated {spec['label']} connection"))
    return connection_status(connection_id)


def reset_connection(connection_id: str, *, actor: str) -> dict:
    spec = connection_spec(connection_id)
    with closing(_connect()) as conn, conn:
        conn.execute("DELETE FROM service_connection WHERE id = ?", (connection_id,))
        conn.execute("INSERT INTO admin_activity(at, actor, kind, summary) VALUES (?, ?, ?, ?)",
                     (time.time(), actor, "connection", f"Restored {spec['label']} server defaults"))
    return connection_status(connection_id)
