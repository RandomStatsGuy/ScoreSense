"""Public K/DEF rank curves, prepared by jobs and read by every API process.

This source is independent of week, injury variant and league rules. Keeping it
separate from weekly QB/RB/WR facts avoids rebuilding or duplicating it for each
week. Readers never parse the full Sleeper catalog or run auction calculations.
"""
from __future__ import annotations

from src.ops.job_diagnostics import observe_job, annotate_job

from datetime import datetime, timezone
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import tempfile

from src.config import FANTASY_K_DEF_CONTEXT_PATH, GAMES_PER_SEASON
from src.core.artifact_revision import artifact_revision
from src.jobs.refresh_lock import RefreshBusy, refresh_lock

SCHEMA_VERSION = "fantasy-k-def-context-v1"


def source_revision() -> str:
    from src.integrations.sleeper import PLAYERS_CACHE
    from src.draft_hub.k_def_pool_cache import K_DEF_QUANTILE_METHOD, _PROJ_CURVE
    return json.dumps([SCHEMA_VERSION, K_DEF_QUANTILE_METHOD, _PROJ_CURVE,
                       GAMES_PER_SEASON, artifact_revision(PLAYERS_CACHE)], sort_keys=True)


@lru_cache(maxsize=4)
def _read_snapshot(path: str, mtime: int, size: int) -> dict | None:
    try:
        saved = json.loads(Path(path).read_text(encoding="utf-8"))
        if (saved["schema"] != SCHEMA_VERSION or not isinstance(saved["revision"], str)
                or not isinstance(saved["built_at"], str) or not isinstance(saved["index"], dict) or not saved["index"]):
            return None
        for pid, row in saved["index"].items():
            if not pid or not isinstance(row, dict) or row.get("position") not in ("K", "DEF"):
                return None
            if any(not isinstance(value, (str, int, float, bool, type(None))) for value in row.values()):
                return None
            for key in ("p10", "p50", "p90", "season_proj", "per_game"):
                value = row.get(key)
                if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
                    return None
            if not row["p10"] <= row["p50"] <= row["p90"]:
                return None
        return saved
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def _snapshot() -> dict | None:
    try:
        stat = FANTASY_K_DEF_CONTEXT_PATH.stat()
        return _read_snapshot(str(FANTASY_K_DEF_CONTEXT_PATH), stat.st_mtime_ns, stat.st_size)
    except OSError:
        return None


def load_k_def_context() -> dict[str, dict]:
    """Read the last complete lookup, including during a source refresh.

    The existing 30-second worker pass always checks this source, so readers need
    neither request hints nor a source revision check. A missing/corrupt file leaves
    estimates unavailable until preparation; it never falls back to live work.
    """
    saved = _snapshot()
    return {pid: dict(row) for pid, row in saved["index"].items()} if saved else {}


@observe_job("fantasy_specialists.prepare")
def prepare_k_def_context() -> dict:
    """Worker/job entry point: read saved public inputs and publish atomically."""
    from src.draft_hub.k_def_pool_cache import build_k_def_projection_index
    from src.integrations.sleeper import PLAYERS_CACHE, players_dataframe
    path = FANTASY_K_DEF_CONTEXT_PATH
    try:
        with refresh_lock(path.with_suffix(".lock")):
            revision = source_revision()
            annotate_job(input_revision=revision)
            previous = _snapshot()
            if previous and previous["revision"] == revision:
                return {"status": "current"}
            if not PLAYERS_CACHE.exists():
                return {"status": "missing_source"}
            # Data refresh jobs own upstream network access. Even startup and
            # ticker preparation consume the last saved catalog only.
            index = build_k_def_projection_index(players_dataframe(allow_refresh=False))
            previous_positions = {row["position"] for row in previous["index"].values()} if previous else set()
            positions = {row["position"] for row in index.values()}
            if revision != source_revision() or previous_positions - positions:
                return {"status": "sources_changing"}
            if not index:
                return {"status": "missing_source"}
            record = {"schema": SCHEMA_VERSION, "revision": revision,
                      "built_at": datetime.now(timezone.utc).isoformat(), "index": index}
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
                    temporary = Path(handle.name)
                    json.dump(record, handle, allow_nan=False, separators=(",", ":"))
                os.replace(temporary, path)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            return {"status": "prepared", "players": len(index)}
    except RefreshBusy:
        return {"status": "busy"}
