"""JSON-safe values for draft-room HTTP responses.

Starlette/FastAPI encode with ``allow_nan=False``. Pandas/NumPy NaN, Inf, and
scalar types in late-round pool rows otherwise 500 the end-of-draft response
as a generic "Request failed".
"""

from __future__ import annotations

import json
import math
from typing import Any


def json_safe(value: Any) -> Any:
    """Replace NaN/Inf and numpy/pandas scalars with JSON-legal Python values."""
    if value is None:
        return None
    if isinstance(value, bool):
        return bool(value)
    if isinstance(value, str):
        return str(value)
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        num = float(value)
        return num if math.isfinite(num) else None
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    try:
        import numpy as np

        if isinstance(value, np.bool_):
            return bool(value)
        if isinstance(value, np.integer):
            return int(value)
        if isinstance(value, np.floating):
            num = float(value)
            return num if math.isfinite(num) else None
        if isinstance(value, np.str_):
            return str(value)
    except Exception:
        pass
    try:
        import pandas as pd

        if value is pd.NA or value is pd.NaT:
            return None
        if pd.isna(value):
            return None
    except Exception:
        pass
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return json_safe(item())
        except Exception:
            pass
    return value


def dumps(value: Any) -> str:
    """json.dumps that never emits NaN/Inf and coerces numpy scalars."""
    return json.dumps(json_safe(value), allow_nan=False)
