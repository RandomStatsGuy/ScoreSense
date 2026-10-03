"""Bounded read-only agent report: python -m src.ops.job_report [--json]."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import closing
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sqlite3
import time

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data/cache/job_diagnostics.sqlite3"


def _p95(values):
    values = sorted(value for value in values if value is not None)
    return values[max(0, math.ceil(len(values) * .95) - 1)] if values else None


def _read_report(path=DEFAULT_PATH, *, hours=24, limit=20, slow_s=60, queue_s=5, cpu_s=30, freshness_s=600):
    """Read a consistent bounded snapshot. Never create/repair a missing database."""
    now = time.time()
    result = {"schema": 1, "generated_at": datetime.fromtimestamp(now, timezone.utc).isoformat(),
              "available": False, "requested_hours": hours,
              "thresholds": {"wall_s": slow_s, "queue_s": queue_s, "cpu_s": cpu_s, "freshness_s": freshness_s},
              "jobs": [], "unfinished": [], "recent_problems": []}
    path = Path(path)
    if not path.is_file():
        result["note"] = "No observations available; diagnostics may be disabled or no jobs have run."
        return result
    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=.1)) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA query_only=ON")
            conn.execute("BEGIN")
            buckets = [dict(row) for row in conn.execute(
                "SELECT * FROM buckets WHERE hour>=? ORDER BY hour DESC LIMIT 4096", (int((now - hours * 3600) // 3600),))]
            runs = [dict(row) for row in conn.execute(
                "SELECT * FROM runs WHERE submitted>=? ORDER BY submitted DESC LIMIT 10000", (now - hours * 3600,))]
            bounds = conn.execute("SELECT min(hour),max(hour) FROM buckets").fetchone()
    except (OSError, sqlite3.Error, ValueError):
        result["note"] = "Diagnostics unavailable or incompatible; no measurements inferred."
        return result
    result.update(available=True, retained_runs=len(runs),
                  aggregate_oldest_epoch=bounds[0] * 3600 if bounds[0] is not None else None,
                  note="Hourly aggregate boundary is approximate; percentiles/reasons use retained runs only. Missing CPU/queue metrics are null. Nested phases overlap their parents; do not sum them. Unfinished does not prove still running; records can be dropped, retained out, or left by worker/host exit.")
    grouped = {}
    samples = defaultdict(list)
    for run in runs:
        samples[(run["job"], run["scope"], int(run["parent"] is not None))].append(run)
        if run["state"] in {"pending", "queued", "running"} and len(result["unfinished"]) < limit:
            result["unfinished"].append({"job": run["job"], "run_id": run["id"], "parent": run["parent"],
                "state": run["state"], "age_s": round(max(0, now - run["submitted"]), 3),
                "pid": run["pid"], "observer_cancelled": bool(run["observer_cancelled"])})
        if (run["state"] == "lost" or run["status"] in {"error", "failed", "partial", "missing_source", "unavailable", "no_stats"}) and len(result["recent_problems"]) < limit:
            result["recent_problems"].append({key: run[key] for key in ("job", "state", "status", "error_type", "finished", "queue_s", "wall_s", "cpu_s")})
    for bucket in buckets:
        key = (bucket["job"], bucket["scope"], bucket["nested"])
        group = grouped.setdefault(key, {"job": key[0], "cpu_scope": key[1], "nested": bool(key[2]),
            "runs": 0, "failures": 0, "skips": 0, "same_input": 0,
            "wall_sum": 0, "wall_max": 0, "queue_sum": 0, "queue_max": 0,
            "queue_samples": 0, "cpu_sum": 0, "cpu_samples": 0, "cpu_max": 0})
        for column in ("runs", "failures", "skips", "same_input", "wall_sum", "queue_sum", "queue_samples", "cpu_sum", "cpu_samples"):
            group[column] += bucket[column]
        for column in ("wall_max", "queue_max", "cpu_max"):
            group[column] = max(group[column], bucket[column])
    for key, group in grouped.items():
        recent = samples[key]
        finished = [run for run in recent if run["state"] == "finished"]
        latest = finished[0] if finished else (recent[0] if recent else None)
        metadata = json.loads(latest["metadata"]) if latest else {}
        group.update(wall_avg_s=group.pop("wall_sum") / group["runs"], wall_max_s=group.pop("wall_max"),
            queue_avg_s=group.pop("queue_sum") / group["queue_samples"] if group["queue_samples"] else None,
            queue_max_s=group.pop("queue_max") if group["queue_samples"] else None,
            cpu_avg_s=group["cpu_sum"] / group["cpu_samples"] if group["cpu_samples"] else None,
            cpu_max_s=group.pop("cpu_max") if group["cpu_samples"] else None,
            cpu_total_s=group.pop("cpu_sum") if group["cpu_samples"] else None,
            wall_p95_s=_p95([run["wall_s"] for run in finished]),
            queue_p95_s=_p95([run["queue_s"] for run in finished]), percentile_samples=len(finished),
            queue_percentile_samples=sum(run["queue_s"] is not None for run in finished),
            recent_reasons=dict(Counter(run["reason"] for run in finished if run["reason"])),
            last_observed_metadata=metadata, last_finished_epoch=latest["finished"] if latest else None)
        for raw_column in ("queue_sum", "queue_max", "cpu_sum", "cpu_max"):
            group.pop(raw_column, None)
        group["recent_statuses"] = dict(Counter(run["status"] for run in finished))
        group["recent_error_types"] = dict(Counter(run["error_type"] for run in recent if run["error_type"]))
        cpu_walls = [(run["cpu_s"], run["wall_s"]) for run in finished if run["cpu_s"] is not None and run["wall_s"] is not None]
        group["cpu_wall_ratio_samples"] = len(cpu_walls)
        group["cpu_wall_ratio_sample"] = sum(cpu for cpu, _ in cpu_walls) / sum(wall for _, wall in cpu_walls) if cpu_walls and sum(wall for _, wall in cpu_walls) else None
        warnings = []
        if group["wall_max_s"] >= slow_s:
            warnings.append("execution_above_advisory")
        if group["queue_max_s"] is not None and group["queue_max_s"] >= queue_s:
            warnings.append("queue_wait_above_advisory")
        if group["cpu_max_s"] is not None and group["cpu_max_s"] >= cpu_s:
            warnings.append("observed_cpu_above_advisory")
        if group["failures"]:
            warnings.append("failures_observed")
        if group["same_input"]:
            warnings.append("repeated_input_revision_observed")
        age = metadata.get("freshness_age_s")
        group["freshness_age_at_report_s"] = age + max(0, now - latest["finished"]) if age is not None and latest and latest["finished"] is not None else None
        if group["freshness_age_at_report_s"] is not None and group["freshness_age_at_report_s"] >= freshness_s:
            warnings.append("reported_artifact_age_above_advisory")
        group["advisories"] = warnings
    result["jobs_total"] = len(grouped)
    result["jobs"] = sorted(grouped.values(), key=lambda job: (job["nested"], -job["wall_max_s"]))[:limit]
    # Detect overlap only among the retained intervals, not from aggregate totals.
    intervals = sorted((run["started"], run["finished"], run["job"]) for run in runs
                       if run["state"] == "finished" and run["parent"] is None and run["started"] is not None and run["finished"] is not None)
    overlap, end = 0, 0
    for start, finish, _ in intervals:
        overlap += int(start < end)
        end = max(end, finish)
    result["retained_top_level_overlap_intervals"] = overlap
    return result


def read_report(path=DEFAULT_PATH, **options):
    try:
        return _read_report(path, **options)
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError, OverflowError):
        return {"schema": 1, "available": False, "requested_hours": options.get("hours", 24),
                "note": "Diagnostics unavailable or incompatible; no measurements inferred.",
                "jobs": [], "unfinished": [], "recent_problems": []}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--hours", type=float, default=24)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--slow-seconds", type=float, default=60)
    parser.add_argument("--queue-seconds", type=float, default=5)
    parser.add_argument("--cpu-seconds", type=float, default=30)
    parser.add_argument("--freshness-seconds", type=float, default=600)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    for name in ("hours", "slow_seconds", "queue_seconds", "cpu_seconds", "freshness_seconds"):
        value = getattr(args, name)
        if not math.isfinite(value) or value <= 0:
            parser.error(f"{name} must be finite and positive")
    report = read_report(args.path, hours=min(args.hours, 30 * 24), limit=max(1, min(args.limit, 100)),
        slow_s=args.slow_seconds, queue_s=args.queue_seconds, cpu_s=args.cpu_seconds, freshness_s=args.freshness_seconds)
    if args.json:
        print(json.dumps(report, indent=2, allow_nan=False))
    else:
        print(f"Background jobs: available={report['available']}; requested={report['requested_hours']}h")
        print(report["note"])
        print("job | scope | nested | runs/fail/skip/same-input | wall avg/max | queue avg/max | CPU total")
        def metric(value):
            return "unknown" if value is None else f"{value:.3f}s"
        for job in report["jobs"]:
            print(f"{job['job']} | {job['cpu_scope']} | {job['nested']} | "
                f"{job['runs']}/{job['failures']}/{job['skips']}/{job['same_input']} | "
                f"{metric(job['wall_avg_s'])}/{metric(job['wall_max_s'])} | "
                f"{metric(job['queue_avg_s'])}/{metric(job['queue_max_s'])} | {metric(job['cpu_total_s'])}")
            if job["advisories"]:
                print("  advisory: " + ", ".join(job["advisories"]))
        print(f"Unfinished retained={len(report['unfinished'])}; recent problems={len(report['recent_problems'])}; "
              f"retained overlapping intervals={report.get('retained_top_level_overlap_intervals', 'unknown')}")
        if report["unfinished"] or report["recent_problems"]:
            print(json.dumps({"unfinished": report["unfinished"], "recent_problems": report["recent_problems"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
