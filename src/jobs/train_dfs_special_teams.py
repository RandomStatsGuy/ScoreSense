"""Reproduce the special-teams gate and artifact: PYTHONPATH=. python -m src.jobs.train_dfs_special_teams."""
import argparse
import hashlib
import io
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests

from src.config import CACHE_DIR, MODEL_DIR
from src.projections.dfs_special_teams import VERSION, score_history, evaluate_gate, training_matrix, fit_heads, QUANTILES


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--through-season", type=int, default=2025)
    parser.add_argument("--output", type=Path, default=MODEL_DIR / "dfs_special_teams.joblib")
    args = parser.parse_args()
    if args.through_season < 2024:
        raise ValueError("The declared evaluation requires completed 2023 and 2024 seasons")
    cache = CACHE_DIR / "dfs_training"
    cache.mkdir(parents=True, exist_ok=True)
    frames, sources = [], []
    for year in range(2018, args.through_season + 1):
        url = f"https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_{year}.parquet"
        path = cache / f"team_{year}.parquet"
        if not path.exists():
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            path.write_bytes(response.content)
        sources.append({"url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        frames.append(pd.read_parquet(path))
    url = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    sources.append({"url": url, "sha256": hashlib.sha256(response.content).hexdigest()})
    history = score_history(pd.concat(frames, ignore_index=True), pd.read_csv(io.StringIO(response.text)))
    report = evaluate_gate(history)
    report["sources"] = sources
    report["kicker_baseline"] = []
    for year in (2023, 2024):
        prior = history[(history.season < year) & (history.season >= year - 3)].K
        actual = history[history.season.eq(year)].K
        q = prior.quantile(QUANTILES).to_numpy()
        report["kicker_baseline"].append({"season": year, "rows": len(actual), "quantiles": q.tolist(),
            "coverage": float(((actual >= q[0]) & (actual <= q[2])).mean())})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".evaluation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    if not report["positions"]["DST"]["passed"]:
        raise ValueError("Defense gate failed; existing model preserved")
    x = training_matrix(history, "DST")
    valid = np.isfinite(x).all(axis=1)
    bundle = {"version": VERSION, "trained_through_season": args.through_season,
              "heads": fit_heads(x[valid], history.DST.to_numpy()[valid]), "gate": report, "history": history}
    temp = args.output.with_suffix(".tmp")
    joblib.dump(bundle, temp, compress=3)
    temp.replace(args.output)
    print(json.dumps({"model": str(args.output), "defense_gate": True, "kicker_candidate_gate": report["positions"]["K"]["passed"]}))


if __name__ == "__main__":
    main()
