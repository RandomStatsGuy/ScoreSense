"""Draft-room JSON must stay Starlette-safe (no NaN/Inf / numpy scalars)."""

import json
import math

import numpy as np

from src.draft_hub.jsonutil import dumps, json_safe


def test_json_safe_strips_nan_inf_and_numpy_scalars():
    payload = json_safe(
        {
            "fair": float("nan"),
            "proj": np.float64(12.5),
            "rank": np.int64(3),
            "flag": np.bool_(True),
            "name": np.str_("Mahomes"),
            "nested": [np.inf, -np.inf, None],
        }
    )
    assert payload["fair"] is None
    assert payload["proj"] == 12.5
    assert payload["rank"] == 3
    assert payload["flag"] is True
    assert payload["name"] == "Mahomes"
    assert payload["nested"] == [None, None, None]
    serialized = dumps(payload)
    json.loads(serialized)
    json.dumps(payload, allow_nan=False)


def test_dumps_never_emits_nan():
    raw = {"season_proj": math.nan, "per_game_proj": math.inf}
    text = dumps(raw)
    assert "NaN" not in text
    assert "Infinity" not in text
    assert json.loads(text) == {"season_proj": None, "per_game_proj": None}
