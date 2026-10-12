"""Run the synthetic Classic build -> selection -> CSV -> backup round trip.

From the repository root in PowerShell:
  $env:PYTHONPATH='.'
  .venv\Scripts\python scripts/dev/verify_dfs_rebuild.py

Requires the existing Python dependencies and Node. Writes only local synthetic
artifacts. It never opens a provider, account, server, reservation or live lineup.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def synthetic_pool():
    import pandas as pd
    rows = []
    for position, size, score in [("QB", 4, 22), ("RB", 10, 18), ("WR", 14, 17), ("TE", 7, 13), ("DST", 4, 8)]:
        for i in range(size):
            team = ["BUF", "NYJ", "MIA", "NE"][i % 4]
            opponent = {"BUF": "NYJ", "NYJ": "BUF", "MIA": "NE", "NE": "MIA"}[team]
            rows.append({"player_id": f"{position}{i}", "Player": f"Synthetic {position} {i}",
                "Position": position, "Team": team, "Opponent": opponent, "salary": 4500,
                "dfs_id": str(10000+len(rows)), "Projected Points": score-i*.29,
                "Low (P10)": score-5-i*.29, "High (P90)": score+7-i*.29})
    return pd.DataFrame(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=150)
    parser.add_argument("--native-stacks", action="store_true",
                        help="Exercise exact attachment rules, declared receiving RBs and a hard pair maximum.")
    parser.add_argument("--output", type=Path, default=Path("outputs/dfs-rebuild-fixture"))
    args = parser.parse_args()
    if not 1 <= args.count <= 150:
        parser.error("--count must be from 1 through 150")
    # This is an isolated fixture command: prevent startup configuration from
    # requiring real credentials or opening the ordinary application database.
    os.environ["TESTING"] = "1"
    os.environ["SCORESENSE_TESTING"] = "1"
    repo = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repo))
    from src.products.lineup_optimizer import optimize_from_pool_dataframe
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    frame = synthetic_pool()
    request = {"site": "draftkings", "portfolio_mode": "global", "lineup_count": args.count,
        "max_overlap": 7, "max_exposure": .6 if args.count >= 3 else 1., "seed": 17,
        "player_exposure_limits": {"QB0": {"min": ".2" if args.count >= 3 else "0", "target": ".4", "max": "1"}},
        "block_qb_opposing_dst": True,
        "snapshot_context": {"fixture": "synthetic_only", "season": 2026, "week": 1, "client_slate_id": "synthetic-classic"}}
    if args.native_stacks:
        request.update(classic_stack_rules={"version": 1,
            "attachments": {"mode": "exact", "count": 1, "receiving_rb_ids": ["RB0"]},
            "bring_back": {"mode": "optional", "count": 0}},
            group_exposure_limits=[{"id": "synthetic-rb-pair", "player_ids": ["RB0", "RB1"],
                "min": ".1" if args.count >= 10 else "0", "target": ".2", "max": ".3" if args.count >= 10 else "1"}])
    started = time.monotonic()
    result = optimize_from_pool_dataframe(frame, **request)
    if not result.get("ok") or not result.get("complete") or not result.get("validation", {}).get("ok"):
        (output / "failed-build.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        raise RuntimeError(f"Synthetic build did not produce a full valid portfolio: {result.get('error')}")
    payload = {"synthetic": True, "request": request, "result": result, "catalog": frame.to_dict("records"),
               "build_seconds": round(time.monotonic()-started, 4)}
    fixture_path = output / "build.json"
    fixture_path.write_text(json.dumps(payload, indent=2, allow_nan=False), encoding="utf-8")
    command = ["node", str(repo / "scripts/dev/verify_dfs_rebuild_export.mjs"), str(fixture_path)]
    finished = subprocess.run(command, cwd=repo, capture_output=True, text=True, check=False)
    if finished.returncode:
        raise RuntimeError(f"Synthetic export round trip failed:\n{finished.stderr or finished.stdout}")
    evidence = json.loads(finished.stdout)
    evidence.update(build_seconds=payload["build_seconds"], selection=result["portfolio_selection"],
                    validation=result["validation"])
    (output / "evidence.json").write_text(json.dumps(evidence, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({"synthetic": True, "count": args.count, "solver_status": result["portfolio_selection"]["solver_status"],
        "candidate_count": result["portfolio_selection"]["candidate_count"], "build_seconds": payload["build_seconds"],
        "entry_csv_roundtrip": evidence["entry_csv_roundtrip"], "backup_roundtrip": evidence["backup_roundtrip"],
        "output": str(output), "acceptance": "unconfirmed"}, indent=2))


if __name__ == "__main__":
    main()
