"""Report actual slate coverage; finite inputs are required by every solver."""
import numpy as np
import pandas as pd


def projection_coverage(pool):
    slate = pool[pool["salary"].notna()] if "salary" in pool else pool
    missing, fixed, complete, modeled = [], 0, 0, 0
    for row in slate.to_dict("records"):
        values = pd.to_numeric(pd.Series([row.get(c) for c in ("Low (P10)", "Projected Points", "High (P90)")]), errors="coerce")
        if not np.isfinite(values).all():
            missing.append({"player_id": str(row.get("player_id", "")), "name": str(row.get("Player", "")),
                            "team": str(row.get("Team", "")), "position": str(row.get("Position", "")),
                            "reason": "unsupported_position" if row.get("Position") == "K" else "missing_or_invalid_projection"})
        else:
            complete += 1
            fixed += row.get("projection_source") == "Fixed estimate"
            modeled += row.get("projection_source") == "ScoreSense"
    return {"slate_players": len(slate), "complete_inputs": complete, "fixed_estimates": int(fixed),
            "missing_count": len(missing), "missing_players": missing,
            "all_players_have_inputs": bool(len(slate)) and not missing,
            "modeled_players": int(modeled),
            "all_players_modeled": bool(len(slate)) and modeled == len(slate)}
