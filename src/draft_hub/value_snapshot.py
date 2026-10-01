"""Durable valuation snapshots; never store viewer context or roster ownership."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
from pathlib import Path

from src.config import DRAFT_POOL_DIR
from src.core.artifact_revision import artifact_revision

SNAPSHOT_DIR = DRAFT_POOL_DIR / "value_snapshots"
SNAPSHOT_VERSION = "value-payload-v1"


class PoolSnapshotUnavailable(ValueError):
    pass


def source_revision(season: int) -> str:
    from src.draft_hub.draft_pool_cache import pool_fingerprint, DRAFT_POOL_DIR as pool_dir
    from src.integrations.roster_identity import identity_stamp
    return json.dumps([SNAPSHOT_VERSION, pool_fingerprint(),
                       artifact_revision(pool_dir / f"pool_{season}.parquet", pool_dir / f"pool_{season}.meta.json"),
                       identity_stamp(season)], sort_keys=True)


def snapshot_path(config_key: str) -> Path:
    return SNAPSHOT_DIR / (hashlib.sha256(config_key.encode()).hexdigest() + ".json")


def load_snapshot(config_key: str, revision: str) -> dict | None:
    try:
        saved = json.loads(snapshot_path(config_key).read_text(encoding="utf-8"))
        payload = saved.get("payload")
        if saved.get("revision") == revision and isinstance(payload, dict) and isinstance(payload.get("rows"), list):
            return payload
    except (OSError, ValueError, AttributeError):
        pass
    return None


def save_snapshot(config_key: str, revision: str, payload: dict) -> None:
    """Atomic publication: interrupted writers cannot replace a complete snapshot."""
    path = snapshot_path(config_key)
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as out:
            temporary = out.name
            json.dump({"revision": revision, "payload": payload}, out, allow_nan=False, separators=(",", ":"))
        os.replace(temporary, path)
    except (OSError, ValueError):
        logging.getLogger(__name__).warning("Could not publish Fantasy valuation snapshot", exc_info=True)
    finally:
        if temporary and os.path.exists(temporary):
            try:
                os.unlink(temporary)
            except OSError:
                logging.getLogger(__name__).warning("Could not remove temporary valuation snapshot", exc_info=True)
