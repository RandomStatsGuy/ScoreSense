"""Coherent prediction publication and context validation.

New artifacts carry their authoritative metadata inside the parquet file. One
atomic rename therefore publishes both together; JSON remains a compatibility
sidecar for older operational tooling. Legacy parquet/JSON pairs remain readable.
"""
from __future__ import annotations

import json
import logging
import os
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd

from src.core.artifact_revision import artifact_revision

logger = logging.getLogger(__name__)
METADATA_ATTR = "_scoresense_prediction_artifact"
ARTIFACT_VERSION = 1
_SOURCE_CUTOFF_CACHE: dict[tuple[str, tuple], dict[str, Any]] = {}


def prediction_identity_revision(season: int) -> str:
    """Match production's semantic forecast identity inputs, without polling.

    Overlay caches still use mtimes to reload changed source bytes. Forecast
    publication freshness follows identity content, so routine identical polls
    and Sleeper availability updates do not falsely invalidate a saved forecast.
    """
    from hashlib import sha256
    from src.projections.roster_coverage import roster_input_revisions

    revisions = ["identity:v2", str(int(season)), *roster_input_revisions()]
    return sha256("|".join(revisions).encode()).hexdigest()


def feature_source_cutoff(position: str, source_dir: Path) -> dict[str, Any]:
    """Producer-only source facts; a rebuild timestamp is not source freshness.

    Training features are a filtered derivative, so this describes their row
    cutoff only. It deliberately makes no assertion about recorded-game or
    participant completeness, or the unknown source ingestion timestamp.
    """
    path = source_dir / f"{position.lower()}_mlready.parquet"
    if not path.exists():
        path = source_dir / f"{position.lower()}_mlready.csv"
    stamp = artifact_revision(path)
    cache_key = (str(path.resolve()), stamp)
    cached = _SOURCE_CUTOFF_CACHE.get(cache_key)
    if cached is not None:
        return cached.copy()
    result: dict[str, Any] = {"source": "training_features", "file": path.name, "ingested_at": None, "status": "missing"}
    if path.exists():
        try:
            frame = pd.read_parquet(path, columns=["season", "week"]) if path.suffix == ".parquet" else pd.read_csv(path, usecols=["season", "week"])
            seasons = pd.to_numeric(frame["season"], errors="coerce")
            weeks = pd.to_numeric(frame["week"], errors="coerce")
            regular = frame.loc[seasons.notna() & weeks.between(1, 18)].copy()
            if not regular.empty:
                latest_season = int(pd.to_numeric(regular["season"]).max())
                latest_week = int(pd.to_numeric(regular.loc[pd.to_numeric(regular["season"]).eq(latest_season), "week"]).max())
                result.update(status="available", season=latest_season, through_week=latest_week, rows=len(frame))
            else:
                result.update(status="unavailable", reason="no_regular_season_feature_rows")
            result["file_modified_at"] = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
        except (OSError, ValueError, KeyError, TypeError):
            result.update(status="unavailable", reason="feature_source_unreadable")
    if len(_SOURCE_CUTOFF_CACHE) >= 32:
        _SOURCE_CUTOFF_CACHE.clear()
    _SOURCE_CUTOFF_CACHE[cache_key] = result.copy()
    return result


def validate_prediction_frame(frame: pd.DataFrame, meta: dict[str, Any]) -> None:
    """Reject wrong-period and duplicate-player forecasts before publication."""
    if frame.empty:
        raise ValueError("artifact_empty")
    if meta.get("artifact_version") == ARTIFACT_VERSION and "player_id" not in frame.columns:
        raise ValueError("artifact_missing_player_id_column")
    if meta.get("artifact_version") == ARTIFACT_VERSION:
        headline_columns = {"weekly": {"Projected Points"}, "ros": {"ROS P50", "Season P50"}, "draft_pool": {"Season Proj"}}.get(meta.get("artifact_kind"))
        if headline_columns is None:
            raise ValueError("artifact_kind_invalid")
        if not headline_columns.issubset(frame.columns):
            raise ValueError("artifact_missing_headline_columns")
    context = [("Season", meta["season"])]
    if meta.get("artifact_kind") != "draft_pool":
        context.extend((("Week", meta["week"]), ("From Week", meta["week"])))
    for column, expected in context:
        if column in frame.columns:
            values = pd.to_numeric(frame[column], errors="coerce")
            if values.isna().any() or not values.eq(int(expected)).all():
                raise ValueError(f"artifact_context_mismatch:{column}")
    if "player_id" in frame.columns:
        ids = frame["player_id"].astype("string").str.strip()
        if ids.isna().any() or ids.eq("").any():
            raise ValueError("artifact_missing_player_id")
        if ids.duplicated().any():
            raise ValueError("artifact_duplicate_player_id")
    if int(meta.get("rows", -1)) != len(frame):
        raise ValueError("artifact_row_count_mismatch")
    for column in ("Projected Points", "Next Week P50", "ROS P50", "Season P50", "Season Proj"):
        if column in frame.columns:
            values = pd.to_numeric(frame[column], errors="coerce")
            if not values.map(lambda value: pd.notna(value) and math.isfinite(float(value))).all():
                raise ValueError(f"artifact_invalid_forecast:{column}")


def publish_prediction_artifact(
    parquet_path: Path, meta_path: Path, frame: pd.DataFrame, meta: dict[str, Any]
) -> dict[str, Any]:
    """Stage a complete replacement; a failed write keeps the prior parquet."""
    validate_prediction_frame(frame, {**meta, "artifact_version": ARTIFACT_VERSION})
    saved = json.loads(json.dumps({**meta, "identity_revision": prediction_identity_revision(int(meta["season"])), "artifact_version": ARTIFACT_VERSION, "publication_id": uuid4().hex}, default=str))
    staged = frame.copy()
    staged.attrs.pop(METADATA_ATTR, None)
    staged.attrs.pop("artifact_status", None)
    staged.attrs[METADATA_ATTR] = saved
    staged.attrs["built_at"] = saved["built_at"]
    token = uuid4().hex
    parquet_temp = parquet_path.with_name(f".{parquet_path.name}.{token}.tmp")
    meta_temp = meta_path.with_name(f".{meta_path.name}.{token}.tmp")
    try:
        staged.to_parquet(parquet_temp, index=False)
        meta_temp.write_text(json.dumps(saved, indent=2), encoding="utf-8")
        os.replace(parquet_temp, parquet_path)
        # The parquet is the commit point. Failure to mirror its metadata must
        # not turn a successful publication into a failed recovery job.
        try:
            os.replace(meta_temp, meta_path)
        except OSError:
            logger.warning("Prediction sidecar mirror failed: %s", meta_path, exc_info=True)
    finally:
        parquet_temp.unlink(missing_ok=True)
        meta_temp.unlink(missing_ok=True)
    frame.attrs["built_at"] = saved["built_at"]
    return saved


def read_prediction_artifact(
    parquet_path: Path,
    meta_path: Path,
    *,
    position: str | None = None,
    season: int,
    week: int | None = None,
    apply_injury_adjustments: bool | None = None,
    fingerprint: str,
    artifact_kind: str | None = None,
) -> tuple[pd.DataFrame, dict[str, Any], dict[str, Any]]:
    """Read one stable version and return an actionable, JSON-safe diagnostic."""
    diagnostic: dict[str, Any] = {
        "status": "missing", "reason": "artifact_missing", "season": int(season),
        "current_fingerprint": fingerprint,
        "artifact_revision": artifact_revision(parquet_path, meta_path),
    }
    if artifact_kind != "draft_pool":
        diagnostic.update(position=str(position).lower(), week=int(week),
                          apply_injury_adjustments=bool(apply_injury_adjustments))
    if not parquet_path.exists():
        return pd.DataFrame(), {}, diagnostic
    meta: dict[str, Any] = {}
    # A rename during the read is harmless for embedded metadata; retrying also
    # protects legacy pairs from an observed mid-read rewrite.
    for _ in range(2):
        before = artifact_revision(parquet_path, meta_path)
        try:
            frame = pd.read_parquet(parquet_path)
            embedded = frame.attrs.get(METADATA_ATTR)
            if isinstance(embedded, dict):
                meta = embedded
                try:
                    sidecar = json.loads(meta_path.read_text(encoding="utf-8"))
                    sidecar_status = "matching" if sidecar == meta else "out_of_date"
                except FileNotFoundError:
                    sidecar_status = "missing"
                except (OSError, ValueError):
                    sidecar_status = "invalid"
            else:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if not isinstance(meta, dict) or meta.get("artifact_version"):
                    raise ValueError("artifact_metadata_generation_mismatch")
                sidecar_status = "legacy"
            after = artifact_revision(parquet_path, meta_path)
            if before != after:
                continue
            if meta.get("artifact_version") not in (None, ARTIFACT_VERSION):
                raise ValueError("artifact_version_unsupported")
            context = [("season", int(season))]
            if artifact_kind == "draft_pool":
                if meta.get("artifact_version") and meta.get("artifact_kind") != "draft_pool":
                    raise ValueError("artifact_kind_invalid")
                # Legacy pool sidecars did not contain weekly context fields.
                meta = {**meta, "artifact_kind": "draft_pool"}
            else:
                context.extend((("position", str(position).lower()), ("week", int(week)), ("apply_injury_adjustments", bool(apply_injury_adjustments))))
            for key, value in context:
                if meta.get(key) != value:
                    raise ValueError(f"artifact_context_mismatch:{key}")
            validate_prediction_frame(frame, meta)
            if frame.empty:
                raise ValueError("artifact_empty")
            identity_revision = prediction_identity_revision(season)
            reason = "source_fingerprint_changed" if meta.get("fingerprint") != fingerprint else None
            if reason is None and meta.get("identity_revision") and meta["identity_revision"] != identity_revision:
                reason = "identity_source_changed"
            diagnostic.update({
                "status": "stale" if reason else "ready", "reason": reason,
                "built_at": meta.get("built_at"), "source_fingerprint": meta.get("fingerprint"),
                "rows": len(frame), "artifact_revision": after,
                "artifact_version": meta.get("artifact_version", 0),
                "artifact_kind": meta.get("artifact_kind"),
                "publication_id": meta.get("publication_id"),
                "sidecar_status": sidecar_status,
                "identity_revision": meta.get("identity_revision"),
                "current_identity_revision": identity_revision,
                "feature_source_cutoff": meta.get("feature_source_cutoff"),
            })
            frame.attrs.pop(METADATA_ATTR, None)
            frame.attrs.update(meta.get("attrs") or {})
            frame.attrs["built_at"] = meta.get("built_at")
            frame.attrs["projection_stale"] = diagnostic["status"] == "stale"
            frame.attrs["artifact_fingerprint"] = meta.get("fingerprint")
            frame.attrs["artifact_status"] = diagnostic.copy()
            return frame, meta, diagnostic
        except (OSError, ValueError, TypeError, KeyError) as exc:
            diagnostic.update(status="invalid", reason=str(exc) if str(exc).startswith("artifact_") else "artifact_unreadable")
            return pd.DataFrame(), meta, diagnostic
    diagnostic.update(status="invalid", reason="artifact_changed_during_read")
    return pd.DataFrame(), meta, diagnostic
