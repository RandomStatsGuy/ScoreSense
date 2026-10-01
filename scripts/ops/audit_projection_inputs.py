"""Audit the saved models' real input contract, without fetching feeds.

PYTHONPATH=. python scripts/ops/audit_projection_inputs.py --season 2026 --week 4
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from src.config import CANDIDATE_DATA_DIR, MODEL_DIR, PROCESSED_DATA_DIR
from src.core.features import feature_completeness
from src.core.projection_context import build_projection_roster
from src.projections.predict import load_model


def audit_inputs(season: int, week: int, data_dir: Path, model_dir: Path, candidate_dir: Path) -> dict:
    report = {"season": season, "week": week, "positions": {}}
    for pos in ("qb", "rb", "wr"):
        data = pd.read_parquet(data_dir / f"{pos}_mlready.parquet")
        roster = build_projection_roster(data, season, week)
        bundle = load_model(pos, model_dir)
        quality = feature_completeness(roster, bundle["feature_cols"])
        path = candidate_dir / f"candidate_features_{pos}.parquet"
        candidate_context = None
        if path.exists():
            candidates = pd.read_parquet(path, columns=["season", "week"])
            latest = candidates.sort_values(["season", "week"]).iloc[-1]
            candidate_context = {"season": int(latest.season), "week": int(latest.week)}
        quality["latest_candidate_context"] = candidate_context
        quality["current_season_profiles"] = int(roster.get("_profile_season", pd.Series(dtype=int)).eq(season).sum())
        current = roster[roster["_profile_season"].eq(season)] if "_profile_season" in roster else roster.iloc[:0]
        quality["current_season_input_quality"] = feature_completeness(current, bundle["feature_cols"])
        report["positions"][pos] = quality
    report["complete"] = all(p["complete"] for p in report["positions"].values())
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--data-dir", type=Path, default=PROCESSED_DATA_DIR)
    parser.add_argument("--model-dir", type=Path, default=MODEL_DIR)
    parser.add_argument("--candidate-dir", type=Path, default=CANDIDATE_DATA_DIR)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = audit_inputs(args.season, args.week, args.data_dir, args.model_dir, args.candidate_dir)
    content = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content + "\n", encoding="utf-8")
    print(content)
    raise SystemExit(0 if report["complete"] else 1)


if __name__ == "__main__":
    main()
