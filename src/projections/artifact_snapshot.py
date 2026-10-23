"""Read a last successful forecast for its exact requested context, without inference."""
from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd
import numpy as np


def read_cached_frame(path: Path) -> pd.DataFrame:
    """A damaged cache is a miss; its reader can schedule a replacement."""
    try:
        return pd.read_parquet(path)
    except (OSError, ValueError):
        logging.getLogger(__name__).debug("Projection cache unreadable: %s", path, exc_info=True)
        return pd.DataFrame()


def read_cached_metadata(path: Path) -> dict:
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
        return meta if isinstance(meta, dict) else {}
    except (OSError, ValueError):
        return {}


def read_snapshot(parquet: Path, meta_path: Path, *, season: int, week: int,
                  position: str, injury: bool, fingerprint: str,
                  required_columns: tuple[str, ...] = ()) -> pd.DataFrame:
    from src.projections.artifact_store import read_prediction_artifact
    frame, meta, diagnostic = read_prediction_artifact(
        parquet, meta_path, season=season, week=week, position=position,
        apply_injury_adjustments=injury, fingerprint=fingerprint,
    )
    if diagnostic["status"] not in {"ready", "stale"}:
        empty = pd.DataFrame()
        empty.attrs["artifact_status"] = diagnostic
        return empty
    if required_columns:
        if any(column not in frame for column in required_columns):
            return pd.DataFrame()
        values = frame[list(required_columns)].apply(pd.to_numeric, errors="coerce")
        if not np.isfinite(values.to_numpy(dtype=float)).all():
            return pd.DataFrame()
    frame.attrs.update(projection_stale=diagnostic["status"] == "stale")
    return frame
