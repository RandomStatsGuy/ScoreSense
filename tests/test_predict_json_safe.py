"""Weekly predict responses must be JSON-safe (no NaN/Inf in rows)."""

import json
import math

import numpy as np
import pandas as pd

import app.api as api


def _frame_with_bad_floats():
    return pd.DataFrame(
        {
            "Player": ["A. Player", "B. Player"],
            "Team": ["KC", "BUF"],
            "Projected Points": [18.4, float("nan")],
            "Low (P10)": [np.inf, 9.1],
            "High (P90)": [26.2, -np.inf],
            "Season": [2026, 2026],
            "Week": [1, 1],
        }
    )


def test_predict_response_replaces_nan_and_inf(monkeypatch):
    monkeypatch.setattr(api, "load_weekly_prediction", lambda *a, **kw: _frame_with_bad_floats())
    response = api._predict_response("qb", season=2026, week=1)

    assert response["count"] == 2
    rows = response["projections"]
    assert rows[1]["Projected Points"] is None
    assert rows[0]["Low (P10)"] is None
    assert rows[1]["High (P90)"] is None
    assert rows[0]["Projected Points"] == 18.4

    # Whole payload must serialize to strict JSON (NaN/Inf are invalid).
    serialized = json.dumps(response, allow_nan=False)
    assert "NaN" not in serialized


def test_json_safe_records_handles_none_and_valid_floats():
    df = pd.DataFrame({"x": [1.5, None, math.nan], "y": ["a", "b", "c"]})
    records = api._json_safe_records(df)
    assert records[0]["x"] == 1.5
    assert records[1]["x"] is None
    assert records[2]["x"] is None
    assert [r["y"] for r in records] == ["a", "b", "c"]
