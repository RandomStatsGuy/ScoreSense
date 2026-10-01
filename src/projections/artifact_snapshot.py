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
    try:
        meta = read_cached_metadata(meta_path)
        if (meta.get("season"), meta.get("week"), meta.get("position"),
            meta.get("apply_injury_adjustments")) != (season, week, position, injury):
            return pd.DataFrame()
        frame = read_cached_frame(parquet)
        if frame.empty:
            return frame
        if required_columns:
            if any(column not in frame for column in required_columns):
                return pd.DataFrame()
            values = frame[list(required_columns)].apply(pd.to_numeric, errors="coerce")
            if not np.isfinite(values.to_numpy(dtype=float)).all(axis=1).any():
                return pd.DataFrame()
        frame.attrs.update(meta.get("attrs") or {})
        frame.attrs.update(built_at=meta.get("built_at"),
                           projection_stale=meta.get("fingerprint") != fingerprint)
        return frame
    except (OSError, ValueError, TypeError):
        logging.getLogger(__name__).debug("Projection snapshot unavailable: %s", parquet, exc_info=True)
        return pd.DataFrame()
