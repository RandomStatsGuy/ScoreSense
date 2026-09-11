"""User-supplied slate projections; never mutate the production model cache."""
import math
import pandas as pd


def apply_projection_overrides(pool: pd.DataFrame, overrides: dict) -> pd.DataFrame:
    out = pool.copy()
    known = set(out["player_id"].astype(str))
    for pid, values in overrides.items():
        if pid not in known:
            raise ValueError("An imported projection does not match the current player pool.")
        if not all(k in values and math.isfinite(values[k]) and -20 <= values[k] <= 150 for k in ("proj", "floor", "ceiling")):
            raise ValueError("Imported projections need finite Proj, Floor and Ceiling values between -20 and 150.")
        if not values["floor"] <= values["proj"] <= values["ceiling"]:
            raise ValueError("Imported projections must satisfy Floor ≤ Proj ≤ Ceiling.")
        mask = out["player_id"].astype(str) == pid
        for key, col in (("proj", "Projected Points"), ("floor", "Low (P10)"), ("ceiling", "High (P90)")):
            out.loc[mask, col] = values[key]
        out.loc[mask, "projection_source"] = "Imported"
        if "salary" in out:
            out.loc[mask, "value"] = values["proj"] / out.loc[mask, "salary"] * 1000
    return out
