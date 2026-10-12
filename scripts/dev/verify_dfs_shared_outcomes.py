"""Offline synthetic engineering pipeline; no forecast, provider or entry writes.

The development runner deliberately reuses maintained test inputs. Production
modules never import tests. Detailed generated reports remain in local outputs.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import platform
import runpy
from time import perf_counter
import tracemalloc

from src.products.dfs_shared_outcomes import (
    evaluate_shared_outcomes, prepare_scenario_bank, scenario_bank_summary,
)


ROOT = Path(__file__).resolve().parents[2]


def _write(path, payload):
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def _quantile(values, q):
    ordered = sorted(values)
    index = (len(ordered) - 1) * q
    low = int(index)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def _execute(payload, pool, lineups, *, now, draws, purpose="evaluation"):
    started = perf_counter()
    bank = prepare_scenario_bank(payload, context=payload["context"], pool=pool, now=now)
    report = evaluate_shared_outcomes(bank, lineups, seed=20261012, draw_count=draws, purpose=purpose)
    return bank, report, perf_counter() - started


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "outputs/dfs-shared-outcomes-engine")
    parser.add_argument("--benchmark", action="store_true", help="Measure the declared maximum pool/portfolio/draw fixture.")
    parser.add_argument("--runs", type=int, default=9, help="Benchmark repetitions, from 3 to 25.")
    args = parser.parse_args()
    if not 3 <= args.runs <= 25:
        parser.error("--runs must be from 3 to 25")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    maintained = runpy.run_path(str(ROOT / "tests/test_dfs_shared_outcomes.py"))
    payload, pool, lineups = maintained["fixture"]()
    original = deepcopy((payload, pool, lineups))
    bank, report, elapsed = _execute(payload, pool, lineups, now=maintained["NOW"], draws=256)
    assert (payload, pool, lineups) == original, "The engineering pipeline must preserve caller inputs"
    streams = {}
    for purpose in ("generation", "selection", "evaluation"):
        streams[purpose] = evaluate_shared_outcomes(bank, lineups, seed=20261012, draw_count=256, purpose=purpose)["stream_manifest"]
    assert len(set(report["stream_manifest"]["streams"].values())) == 3
    assert report["audit"]["conservation_passed"] and report["audit"]["pool_players_covered"] == len(pool)
    assert not report["capabilities"]["calibrated_joint_tail"] and not report["capabilities"]["expected_payout"]
    assert next(row for row in report["players"] if row["player_id"] == "buf-qb")["negative_fraction"] > 0
    _write(args.output_dir / "synthetic-input.json", {"bank": payload, "pool": pool, "lineups": lineups})
    _write(args.output_dir / "synthetic-evaluation.json", report)
    verification = {"synthetic": True, "purpose": "engineering conservation and replay only",
                    "context": payload["context"], "bank": scenario_bank_summary(bank),
                    "lineups": len(lineups), "draws": report["draw_count"], "elapsed_seconds": elapsed,
                    "caller_inputs_unchanged": True, "stream_manifests": streams,
                    "audit": report["audit"], "capabilities": report["capabilities"],
                    "whole_repo_test_result": None, "production_runtime_claim": False}
    if args.benchmark:
        large_payload, large_pool, large_lineups = maintained["maximum_budget_fixture"]()
        measures, prepare, evaluate = [], [], []
        for _ in range(args.runs):
            large_bank, large_report, seconds = _execute(large_payload, large_pool, large_lineups,
                                                       now=maintained["NOW"], draws=1024)
            measures.append(seconds)
            prepare.append(large_bank["preparation_seconds"])
            evaluate.append(large_report["runtime_seconds"])
        tracemalloc.start()
        _execute(large_payload, large_pool, large_lineups, now=maintained["NOW"], draws=1024)
        _, peak_heap = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        raw = json.dumps(large_payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        verification["benchmark"] = {"synthetic": True, "runs": args.runs, "python": platform.python_version(),
            "os": platform.system(), "machine": platform.machine(), "processor": platform.processor(),
            "pool_players": len(large_pool), "lineups": len(large_lineups), "draws": 1024,
            "games": large_bank["counts"]["games"], "profiles": large_bank["counts"]["profiles"],
            "events_per_profile": 4, "raw_bank_bytes": len(raw), "raw_bank_sha256": hashlib.sha256(raw).hexdigest(),
            "scoring_version": large_bank["scoring_version"], "scoring_source": large_bank["scoring_source"],
            "combined_seconds": measures, "prepare_seconds": prepare, "evaluation_seconds": evaluate,
            "p50_seconds": _quantile(measures, .5), "p95_seconds": _quantile(measures, .95),
            "separate_tracemalloc_python_heap_peak_bytes": peak_heap,
            "memory_scope": "Separate instrumented run; Python allocations only, not RSS or native allocation coverage.",
            "scope": "Maximum pool/lineup/draw fixture with short synthetic ledgers; not a maximum-byte/event bank, plausible slate or production budget.",
            "capabilities": large_report["capabilities"]}
    _write(args.output_dir / "verification.json", verification)
    print(json.dumps({"synthetic": True, "output": str(args.output_dir), "bank_id": bank["content_id"],
                      "lineups": len(lineups), "draws": report["draw_count"], "seconds": elapsed,
                      "benchmark_p50_seconds": verification.get("benchmark", {}).get("p50_seconds"),
                      "benchmark_p95_seconds": verification.get("benchmark", {}).get("p95_seconds")}))


if __name__ == "__main__":
    main()
