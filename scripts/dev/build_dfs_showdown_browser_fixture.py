"""Compute synthetic Showdown browser inputs with the real optimizer.

No live accounts, player forecasts, entries or original twenty-lineup audit are
used. Response envelopes mirror the API; solver/comparison values are computed.
"""
from copy import deepcopy
import json
from pathlib import Path

import pandas as pd

from src.products.lineup_optimizer import optimize_from_pool_dataframe


def fixture_pool():
    rows = []
    subjects = [
        ("qa", "Avery Quarterback", "BUF", "QB", 5),
        ("backup", "Jordan Backup", "BUF", "QB", 24),
        ("qb", "Morgan Quarterback", "LA", "QB", 18),
        ("wa", "Casey Receiver", "BUF", "WR", 30),
        ("ta", "Riley Tight End", "BUF", "TE", 19),
        ("ra", "Taylor Back", "BUF", "RB", 22),
        ("wb", "Jamie Receiver", "LA", "WR", 25),
        ("rb", "Cameron Back", "LA", "RB", 20),
        ("db", "Los Angeles Defense", "LA", "DST", 12),
        ("cheap", "Drew Reserve", "LA", "TE", 2),
    ]
    for index, (pid, name, team, position, projection) in enumerate(subjects):
        rows.append({"player_id": pid, "Player": name, "Team": team,
            "Opponent": "LA" if team == "BUF" else "BUF", "Position": position,
            "Projected Points": projection, "Low (P10)": projection / 2, "High (P90)": projection + 10,
            "salary": 1000 if pid == "cheap" else 6000, "cpt_salary": 1500 if pid == "cheap" else 9000,
            "dfs_id": str(100 + index), "cpt_dfs_id": str(200 + index),
            "Injury Status": "Q" if pid == "wb" else "Active",
            "availability_updated_at": "2026-10-12T12:00:00Z",
            "projection_source": "Synthetic model fixture", "projection_statistic": "median",
            "availability_conditioning": "conditional_active", "score_system_id": "synthetic_dk_ppr",
            "forecast_at": "2026-10-12T11:00:00Z", "projection_model": "synthetic_fixture_v1",
            "Season": 2026, "Week": 5, "game_start": "2030-10-14T00:20:00Z"})
    return pd.DataFrame(rows)


def main():
    frame = fixture_pool()
    pairing = {"receiver_captain_qb": "require", "approved_qb_ids": {"BUF": ["qa"], "LA": ["qb"]}}
    meta = {"season": 2026, "week": 5, "slate_id": "showdown-fixture", "slate_name": "Synthetic BUF at LA",
            "count": len(frame), "projection_stale": False}
    request = {"site": "draftkings_showdown", "season": 2026, "week": 5, "slate_id": "showdown-fixture",
               "objective": "ceiling", "lineup_count": 1, "max_overlap": 6, "showdown_rules": pairing,
               "locked_player_ids": [], "excluded_player_ids": [], "candidate_player_ids": None,
               "salary_cap": 50000, "min_salary": None, "max_per_team": None,
               "locked_captain_id": None, "randomness": 0, "max_exposure": None,
               "captain_exposure_limits": {}, "block_bye_weeks": True, "apply_injury_adjustments": True}
    context = {"requested_season": 2026, "requested_week": 5, "client_slate_id": "showdown-fixture",
               "pool_meta": meta, "salary_snapshot": None, "apply_injury_adjustments": True, "projection_overrides": {}}

    def compute(extra=None, frozen=False):
        extra = extra or {}
        source = deepcopy(context)
        if frozen:
            source.update({"comparison_source_snapshot_id": built["build_snapshot"]["id"],
                           "comparison_scope": "supplied_frozen_build_inputs_not_live_state"})
        response = optimize_from_pool_dataframe(frame.copy(deep=True), site=request["site"],
            objective=request["objective"], lineup_count=1, max_overlap=6, salary_cap=50000,
            showdown_rules=deepcopy(pairing), snapshot_context=source, **extra)
        response["meta"] = {**meta, **({"comparison_source_snapshot_id": built["build_snapshot"]["id"], "frozen_comparison": True} if frozen else {})}
        response["slate_validation"] = {"scope": "supplied_frozen_comparison" if frozen else "unbound_client_inputs",
                                          "scoring_verified": False, "lock_state_verified": False}
        if frozen:
            response["comparison_source_snapshot_id"] = built["build_snapshot"]["id"]
        return response

    built = compute()
    captain_request = {**request, "include_captain_comparison": True, "comparison_snapshot": built["build_snapshot"]}
    player_request = {**request, "comparison_player_id": "cheap", "comparison_player_slot": "flex",
                      "comparison_snapshot": built["build_snapshot"]}
    result = {"synthetic": True, "evidence_scope": "computed_synthetic_not_original_20_lineup_reproduction",
        "pool": {"players": frame.to_dict("records"), "meta": meta,
                 "slate": {"slate_id": "showdown-fixture", "name": "Synthetic BUF at LA"}},
        "salaries": [{"player_id": row["player_id"], "dfs_id": row["dfs_id"], "cpt_dfs_id": row["cpt_dfs_id"],
                      "player_name": row["Player"], "position": row["Position"], "team": row["Team"],
                      "salary": row["salary"], "cpt_salary": row["cpt_salary"]} for row in frame.to_dict("records")],
        "build_request": request, "build": built,
        "captain_comparison_request": captain_request,
        "captain_comparison": compute({"include_captain_comparison": True}, frozen=True),
        "player_comparison_request": player_request,
        "player_comparison": compute({"comparison_player_id": "cheap", "comparison_player_slot": "flex"}, frozen=True)}
    assert built["ok"] and result["player_comparison"]["player_comparison"]["forced"]["status"] == "optimal"
    target = Path(__file__).resolve().parents[2] / "frontend" / "test-fixtures" / "dfs-showdown-data.json"
    # Keep generated response data compact so the source changes remain reviewable.
    target.write_bytes((json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8"))
    print(json.dumps({"fixture": str(target), "synthetic_players": len(frame),
                      "objective_score": built["objective_score"], "projection_sum": built["projection_sum"],
                      "captain_candidates": len(result["captain_comparison"]["captain_comparison"]["candidates"])}))


if __name__ == "__main__":
    main()
