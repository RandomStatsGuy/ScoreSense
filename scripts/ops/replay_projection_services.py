"""Offline service replay from saved public NFL/Sleeper inputs and fitted bundles.

Checks numerical coverage, not historical accuracy or live artifact freshness.
Never writes serving caches, model bundles or league data.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from scripts.ops.audit_projection_coverage import audit_frame
from src.draft_hub.trade_outlook import outlook_from_frames
from src.integrations import sleeper
from src.integrations.roster_identity import DROP_STATUSES, SKILL_POSITIONS
from src.projections.draft_projections import predict_draft_season
from src.projections.predict import predict_upcoming_week
from src.projections.ros_projections import predict_rest_of_season
from src.products.lineup_optimizer import build_lineup_pool


def replay_services(*, season: int, week: int, data_dir: Path, model_dir: Path,
                    cache_dir: Path, consensus_dir: Path, output: Path) -> dict:
    raw = json.loads((cache_dir / "sleeper_players.json").read_text())
    with patch.object(sleeper, "load_sleeper_players", return_value=raw):
        sleeper._PLAYERS_DF_CACHE = None
        players = sleeper.players_dataframe(allow_refresh=False)
    nfl = pd.read_parquet(cache_dir / f"nflverse_roster_{season}.parquet")
    schedules = pd.read_parquet(cache_dir / "nfl_schedules.parquet")
    injuries = players[players.injury_status.isin(["Out", "IR", "PUP", "Doubtful", "Questionable"])].copy()
    expected = nfl[nfl.position.isin(SKILL_POSITIONS) & ~nfl.status.isin(DROP_STATUSES)
                   & nfl.team.fillna("").ne("")].to_dict("records")
    frames = {service: [] for service in ("weekly", "season", "ros")}
    report = {"season_year": season, "week": week,
        "source": "Offline replay using saved public NFL/Sleeper identities and schedules",
        "limitations": ["Skill positions only; K/DST estimates were not retrained or audited here.",
                        "Coverage does not validate accuracy or production cache freshness.",
                        "Current identities are used for coverage, including the preseason replay."]}
    with ExitStack() as stack:
        for target, value in (
            ("src.integrations.sleeper.players_dataframe", players),
            ("src.integrations.nflverse_roster.load_seasonal_roster", nfl),
            ("src.core.schedule_utils._load_schedules", schedules),
            ("src.projections.predict.injured_players", injuries),
            ("src.core.opportunity.injured_players", injuries),
            ("src.integrations.sleeper.get_nfl_state", {"season": season, "week": week, "season_type": "regular"}),
            ("src.core.projection_context.get_nfl_state", {"season": season, "week": week, "season_type": "regular"}),
        ):
            stack.enter_context(patch(target, return_value=value))
        stack.enter_context(patch("src.integrations.fantasypros.FP_CACHE_DIR", consensus_dir))
        stack.enter_context(patch("requests.sessions.Session.request", side_effect=RuntimeError("Offline replay forbids network requests")))
        # Force the real ROS cold path and avoid mixing earlier-model artifacts
        # into its rolling rate. This replay produces no serving artifacts.
        stack.enter_context(patch("src.projections.ros_projections.load_weekly_prediction", return_value=pd.DataFrame()))
        for pos in ("qb", "rb", "wr"):
            weekly = predict_upcoming_week(pos, season, week, data_dir, model_dir)
            frames["weekly"].append(weekly)
            frames["season"].append(predict_draft_season(pos, season, data_dir, model_dir))
            frames["ros"].append(predict_rest_of_season(pos, season, week, data_dir, model_dir))
            chosen = weekly[weekly.Player.isin(["Fernando Mendoza", "Alvin Kamara", "Kendre Miller",
                "Aaron Jones", "Jaxon Smith-Njigba", "Josh Allen"])]
            report[pos] = {"rows": len(weekly), "input_quality": weekly.attrs.get("input_quality"),
                "selected": chosen[["Player", "Low (P10)", "Projected Points", "High (P90)",
                                      "Opportunity Adjustment", "projection_source"]].to_dict("records")}
            print(pos, len(weekly), "forecasts", flush=True)
            print(chosen[["Player", "Projected Points"]].to_string(index=False), flush=True)
        by_pos = dict(zip(("qb", "rb", "wr"), frames["weekly"]))
        stack.enter_context(patch("src.products.lineup_optimizer.load_weekly_prediction",
                                 side_effect=lambda pos, **kw: by_pos[pos].copy()))
        stack.enter_context(patch("src.projections.dfs_pool.load_dfs_pool", return_value=pd.DataFrame()))
        dfs, _ = build_lineup_pool(season, week, site="draftkings", data_dir=data_dir, model_dir=model_dir)
    merged = {key: pd.concat(value, ignore_index=True) for key, value in frames.items()}
    quantiles = ("Low (P10)", "Projected Points", "High (P90)")
    report["coverage"] = {
        "weekly": audit_frame(expected, merged["weekly"], quantiles),
        "season": audit_frame(expected, merged["season"], ("Season P10", "Season P50", "Season P90")),
        "ros": audit_frame(expected, merged["ros"], ("ROS P10", "ROS P50", "ROS P90")),
        "dfs_skill": audit_frame(expected, dfs, quantiles),
    }
    roster = [dict(row, roster_status="active") for row in expected]
    trade = outlook_from_frames({"teams": [{"roster": roster}]}, merged["season"], merged["ros"], week=week)
    absent = [row for row in expected if not np.isfinite(
        trade["players"][str(row["player_id"])]["remaining_points"]
        if trade["players"][str(row["player_id"])]["remaining_points"] is not None else np.nan)]
    report["coverage"]["trades_skill"] = {"expected": len(expected), "projected": len(expected)-len(absent),
                                             "missing_count": len(absent), "missing": absent}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False)+"\n", encoding="utf-8")
    print(json.dumps(report["coverage"], indent=2), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    for name in ("data-dir", "model-dir", "cache-dir", "consensus-dir", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    report = replay_services(**vars(parser.parse_args()))
    if any(value["missing_count"] for value in report["coverage"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
