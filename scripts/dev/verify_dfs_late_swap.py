"""Synthetic late-swap mechanics and bounded engineering measurements.

All identities, player inputs, receipt hashes and accepted-state declarations
are artificial. This does not read an account, provider, database or live slate.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import platform
from time import perf_counter


CONTEXT = {"site": "draftkings", "sport": "NFL", "format": "classic",
           "season": 2099, "week": 3, "slate_id": "synthetic-late-swap"}
SLOTS = ("QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST")
DECISION = "2026-10-11T20:00:00Z"


def late_swap_fixture(entry_count=2, alternatives_per_entry=2):
    """Independent legal fixture with intentionally repeated accepted rosters."""
    assert 1 <= entry_count <= 150 and 0 <= alternatives_per_entry <= 4
    specs = [("q0", "QB", "BUF", "MIA", "early", True, None),
             ("rb1", "RB", "KC", "LV", "late", False, "4"),
             ("rb2", "RB", "LV", "KC", "late", False, "5"),
             ("w0", "WR", "BUF", "MIA", "early", True, None),
             ("w2", "WR", "KC", "LV", "late", False, "7"),
             ("w3", "WR", "LV", "KC", "late", False, "8"),
             ("t0", "TE", "KC", "LV", "late", False, "6"),
             ("flex", "WR", "LV", "KC", "late", False, "3"),
             ("d0", "DST", "KC", "LV", "late", False, "2"),
             ("rb3", "RB", "KC", "LV", "late", False, "14"),
             ("w4", "WR", "LV", "KC", "late", False, "17"),
             ("rb4", "RB", "LV", "KC", "late", False, "11"),
             ("w5", "WR", "KC", "LV", "late", False, "13")]
    catalog = [{"player_id": pid, "dfs_id": str(1000 + i), "name": f"Synthetic {pid}",
                "position": pos, "team": team, "opponent": opp, "game_id": game,
                "salary": 4000, "kickoff_at": "2026-10-11T19:00:00Z" if locked else "2026-10-11T22:00:00Z",
                "lock_state": "locked" if locked else "unlocked", "status": "eligible", "projection": proj}
               for i, (pid, pos, team, opp, game, locked, proj) in enumerate(specs)]
    baseline = dict(zip(SLOTS, ["q0", "rb1", "rb2", "w0", "w2", "w3", "t0", "flex", "d0"]))
    entries, candidates = [], []
    for i in range(entry_count):
        eid = f"{i + 1:06d}"
        entries.append({"entry_id": eid, "contest_id": "00042", "slots": deepcopy(baseline)})
        alternatives = [{**baseline, "RB1": "rb3"}, {**baseline, "WR2": "w4"},
                        {**baseline, "FLEX": "rb4"}, {**baseline, "WR3": "w5"}]
        candidates.extend({"candidate_id": f"synthetic-{eid}-{j}", "entry_id": eid, "slots": slots}
                          for j, slots in enumerate(alternatives[:alternatives_per_entry]))
    source_kinds = [("readback", "user_platform_readback"), ("rules", "rules"),
                    ("catalog", "salary_catalog"), ("locks", "lock_snapshot"),
                    ("projections", "projection_inputs")]
    sources = [{"source_id": sid, "kind": kind, "as_of": DECISION,
                "content_sha256": hashlib.sha256(f"synthetic:{kind}".encode()).hexdigest(),
                "rights": {"personal_analysis": True, "hosted_ingestion": True, "display": True}}
               for sid, kind in source_kinds]
    return {"schema_version": "dfs_late_swap_package_v1", "context": deepcopy(CONTEXT),
        "decision_at": DECISION, "objective": "projection_guided_snapshot",
        "contest": {"contest_id": "00042", "name": 'Synthetic "late" contest',
                    "late_swap_enabled": True, "lock_policy": "individual_game", "as_of": DECISION},
        "sources": sources,
        "accepted_state": {"source_id": "readback", "readback_sha256": sources[0]["content_sha256"],
                           "portfolio_version": "synthetic-portfolio-1", "export_version": "synthetic-export-1",
                           "as_of": DECISION, "entries": entries},
        "catalog": catalog, "candidates": candidates, "controls": {}}


def template_fixture(package):
    """Ordered repeated headers, quoted metadata and an unrelated contest row."""
    import csv
    import io
    rows = [["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB",
             "WR", "WR", "WR", "TE", "FLEX", "DST", "User note"],
            ["999999", "00999", "Unrelated contest", "$0.50", "", "", "", "", "", "", "", "", "", "=preserved"]]
    catalog = {p["player_id"]: p for p in package["catalog"]}
    for entry in package["accepted_state"]["entries"]:
        cells = [f'{catalog[entry["slots"][slot]]["name"]} ({catalog[entry["slots"][slot]]["dfs_id"]})' for slot in SLOTS]
        rows.append([entry["entry_id"], entry["contest_id"], package["contest"]["name"], "$0.50",
                     *cells, 'Quoted, extra "metadata"'])
    rows.append(["", "", "Provider instruction preserved", ""])
    buf = io.StringIO(newline="")
    csv.writer(buf, lineterminator="\r\n").writerows(rows)
    return buf.getvalue()


def engineering_receipt(entry_count=150, alternatives_per_entry=4, pool_players=750):
    """Measure real strict parsing, planning and internal CSV round trip once."""
    # This flag supports a pure engineering runner's config imports. No storage
    # lifecycle or application startup is entered; the helpers are read-only.
    os.environ.setdefault("SCORESENSE_TESTING", "1")
    from app.dfs_late_swap_routes import PreviewLateSwap, PlanLateSwap, _preview, _plan
    from app.dfs_shared_outcomes_routes import _parse_body, MAX_BODY_BYTES
    from src.products.dfs_late_swap import prepare_late_swap_package, build_late_swap_csv_preview

    package = late_swap_fixture(entry_count, alternatives_per_entry)
    assert len(package["catalog"]) <= pool_players <= 750
    while len(package["catalog"]) < pool_players:
        i = len(package["catalog"])
        package["catalog"].append({**package["catalog"][1], "player_id": f"synthetic-unused-{i:03d}",
            "dfs_id": str(2000 + i), "name": f"Synthetic unused {i}", "projection": "0"})
    target = entry_count // 3
    maximum = entry_count // 2
    package["controls"] = {"player_exposure_limits": {
        "q0": {"min": {"count": entry_count}, "max": {"count": entry_count}},
        "rb3": {"max": {"count": maximum}}, "rb4": {"target": {"count": target}}},
        "group_exposure_limits": [{"id": "locked-qb-new-rb", "player_ids": ["q0", "rb3"],
                                   "max": {"count": maximum}}]}
    preview_request = {"context": deepcopy(CONTEXT), "package": package}
    raw_preview = json.dumps(preview_request, separators=(",", ":"), allow_nan=False).encode()
    started = perf_counter()
    parsed_preview = _parse_body(raw_preview, PreviewLateSwap)
    preview_parse_seconds = perf_counter() - started
    started = perf_counter()
    preview = _preview(parsed_preview)
    preview_seconds = perf_counter() - started
    plan_request = {**preview_request, "package_id": preview["content_id"]}
    raw = json.dumps(plan_request, separators=(",", ":"), allow_nan=False).encode()
    assert len(raw) < MAX_BODY_BYTES
    started = perf_counter()
    parsed = _parse_body(raw, PlanLateSwap)
    plan_parse_seconds = perf_counter() - started
    started = perf_counter()
    report = _plan(parsed)
    plan_seconds = perf_counter() - started
    prepared = prepare_late_swap_package(package, context=CONTEXT)
    template = template_fixture(package)
    dry_run = None
    started = perf_counter()
    if report["complete"]:
        dry_run = build_late_swap_csv_preview(template, prepared, report)
    csv_seconds = perf_counter() - started
    ids = [entry["entry_id"] for entry in report["entries"]]
    counts = {row["id"]: row["actual_count"] for row in report.get("audit", {}).get("hard_counts", [])
              if row["scope"] == "player"}
    gates = ("accepted_readback_authenticated", "current_lock_verified", "platform_export_ready",
             "conditional_remaining_evaluation", "expected_payout", "forecast_performance_verified")
    checks = {"strict_bounded_request": len(raw) < MAX_BODY_BYTES,
        "complete_exact_entry_assignments": report["complete"] is True and len(ids) == entry_count and
            set(ids) == {entry["entry_id"] for entry in package["accepted_state"]["entries"]} and len(ids) == len(set(ids)),
        "locked_exact_slots_preserved": all(entry["after_slots"]["QB"] == "q0" and
            entry["after_slots"]["WR1"] == "w0" for entry in report["entries"]),
        "independent_final_audit_passed": report.get("audit", {}).get("ok") is True,
        "all_locked_appearances_counted": counts.get("q0") == entry_count and counts.get("w0") == entry_count,
        "hard_player_and_pair_maximum_held": counts.get("rb3", entry_count) <= maximum,
        "target_actual_retained": counts.get("rb4") == target,
        "no_authenticity_currentness_or_forecast_claim": all(report["capabilities"].get(key) is False for key in gates),
        "csv_metadata_and_unselected_rows_preserved": dry_run is not None and
            all(dry_run["manifest"].get(key) is True for key in ("metadata_preserved", "unselected_rows_preserved", "round_trip_passed")),
        "dry_run_not_platform_ready": dry_run is not None and dry_run["manifest"]["platform_export_ready"] is False}
    return {"schema_version": "dfs_late_swap_engineering_receipt_v1", "evidence_scope": "synthetic",
        "input_sha256": hashlib.sha256(raw).hexdigest(), "request_bytes": len(raw),
        "environment": {"python": platform.python_version(), "platform": platform.platform(),
            "processor": platform.processor(), "logical_cpus": os.cpu_count()},
        "case": {"entries": entry_count, "supplied_alternatives": len(package["candidates"]),
            "automatic_baselines": entry_count, "pool_players": pool_players, "locked_slots": 2 * entry_count,
            "soft_target_appearance_count": target, "hard_new_rb_maximum": maximum,
            "projection_values": "explicit synthetic unstarted-player inputs", "declared_decision_at": DECISION},
        "timing": {"preview_parse_seconds": preview_parse_seconds, "preview_cpu_helper_seconds": preview_seconds,
            "plan_parse_seconds": plan_parse_seconds, "plan_cpu_helper_seconds": plan_seconds,
            "internal_csv_seconds": csv_seconds, "timed_repeats": 1, "percentile_estimate": None},
        "checks": checks, "report": report, "csv_manifest": dry_run["manifest"] if dry_run else None,
        "limitations": ["All identities, receipts, accepted states, rules and player inputs are synthetic declarations.",
            "One local measurement is not a p50/p95 estimate or hosted latency promise.",
            "The internal CSV is an engineering dry run and is not available for platform submission.",
            "Peak memory was not measured; other local validation may share this host.",
            "No account, provider, production database, live lineup, model calibration or financial return was accessed or verified."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--entry-count", type=int, default=150)
    parser.add_argument("--alternatives-per-entry", type=int, default=4)
    parser.add_argument("--pool-players", type=int, default=750)
    args = parser.parse_args()
    receipt = engineering_receipt(args.entry_count, args.alternatives_per_entry, args.pool_players)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, allow_nan=False), encoding="utf-8", newline="\n")
    print(json.dumps({key: receipt[key] for key in ("request_bytes", "case", "timing", "checks")}, indent=2))
    print(json.dumps(receipt["report"]["solver"], indent=2))
    if not all(receipt["checks"].values()):
        raise SystemExit("Synthetic late-swap engineering checks failed; inspect the retained receipt.")


if __name__ == "__main__":
    main()
