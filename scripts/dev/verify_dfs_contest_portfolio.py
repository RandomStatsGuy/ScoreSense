"""Measure synthetic portfolio research mechanics, never forecast performance.

The fixture contains 600 distinct legal Classic candidates and selects 150 on
32 draws against two supplied assumptions. Candidate projections are explicit
synthetic values. No account, provider, database, entry or live lineup is read.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import platform
import random
from time import perf_counter

from scripts.dev.verify_dfs_contest_research import maximum_fixture
from src.products.dfs_shared_outcomes import prepare_scenario_bank
from src.products.dfs_contest_research import prepare_contest_research


def portfolio_fixture(candidate_count=600, requested_count=150, draw_count=32):
    """Use the maintained coherent event fixture with fresh unique legal rosters."""
    context, pool, raw_bank, field, payout, _ = maximum_fixture()
    field["scenarios"] = field["scenarios"][:2]
    rng = random.Random(20261013)
    positions = {pos: [p for p in pool if p["position"] == pos]
                 for pos in ("QB", "RB", "WR", "TE", "DST")}
    candidates, seen = [], set()
    while len(candidates) < candidate_count:
        qb = rng.choice(positions["QB"])
        players = [qb, *rng.sample(positions["RB"], 2),
                   *rng.sample(positions["WR"], 3), rng.choice(positions["TE"])]
        used = {row["player_id"] for row in players}
        players.append(rng.choice([row for row in pool if row["position"] in {"RB", "WR", "TE"}
                                   and row["player_id"] not in used]))
        players.append(rng.choice([row for row in positions["DST"] if row["team"] != qb["opponent"]]))
        ids = sorted(row["player_id"] for row in players)
        if tuple(ids) in seen or len({row["game_id"] for row in players}) < 2:
            continue
        assert sum(row["salary"] for row in players) <= 50000
        assert max(Counter(row["team"] for row in players).values()) <= 4
        seen.add(tuple(ids))
        candidates.append({"lineup_id": f"synthetic-candidate-{len(candidates):03d}", "player_ids": ids})
    assert len(seen) == candidate_count
    # These values declare a repeatable synthetic ranking, not a fitted model.
    projections = {row["lineup_id"]: str(200 - index / 1000) for index, row in enumerate(candidates)}
    bank = prepare_scenario_bank(raw_bank, context=context, pool=pool)
    prepared = prepare_contest_research(bank, field, payout)
    request = {"context": context, "pool": pool, "bank": raw_bank,
        "contest_field": field, "payout_contract": payout, "lineups": candidates,
        "input_snapshot_id": "synthetic-portfolio-engineering-inputs",
        "selection_request_id": "synthetic-portfolio-engineering-selection",
        "bank_id": bank["content_id"], "contest_research_id": prepared["content_id"],
        "projection_scores": projections, "count": requested_count,
        "objective": "conditional_mean_net", "scenario_id": field["scenarios"][0]["scenario_id"],
        "risk_alpha": "0.9", "risk_weight": "0", "seed": 20261013,
        "draw_count": draw_count, "top_k": 10}
    return request


def engineering_receipt(*, candidate_count=600, requested_count=150, draw_count=32):
    """Exercise the strict request and actual CPU helper without an API lifecycle."""
    os.environ["SCORESENSE_TESTING"] = "1"
    from app.dfs_contest_research_routes import SelectContest, _select
    from app.dfs_shared_outcomes_routes import MAX_BODY_BYTES, _parse_body

    request = portfolio_fixture(candidate_count, requested_count, draw_count)
    raw = json.dumps(request, separators=(",", ":"), allow_nan=False).encode()
    assert len(raw) < MAX_BODY_BYTES
    started = perf_counter()
    parsed = _parse_body(raw, SelectContest)
    parse_seconds = perf_counter() - started
    started = perf_counter()
    result = _select(parsed)
    seconds = perf_counter() - started
    selected = result.get("selected_lineups", [])
    own_sets = {tuple(sorted(row["player_ids"])) for row in selected}
    candidate_sets = {tuple(sorted(row["player_ids"])) for row in request["lineups"]}
    checks = {"strict_bounded_request_checked": True,
        "complete_requested_set": result.get("complete") is True and len(selected) == requested_count,
        "unique_selected_candidates": len(own_sets) == len(selected) and own_sets <= candidate_sets,
        "no_hard_constraint_violations": result.get("exposure_violations") == [],
        "no_forecast_or_untouched_claim": all(result["capabilities"][key] is False for key in
            ("expected_payout", "forward_forecast", "untouched_evaluation_verified")),
        "joint_payout_check_passed": result["stream_manifest"].get("independent_joint_payout_check_passed") is True}
    # Retain the actual result so an unresolved search cannot become a pass.
    return {"schema_version": "dfs_contest_portfolio_engineering_receipt_v1",
        "evidence_scope": "synthetic", "input_sha256": hashlib.sha256(raw).hexdigest(),
        "request_bytes": len(raw), "environment": {"python": platform.python_version(), "platform": platform.platform()},
        "case": {"candidate_count": candidate_count, "requested_count": requested_count,
            "draw_count": draw_count, "assumptions": len(request["contest_field"]["scenarios"]),
            "contest_entries": request["payout_contract"]["entrant_count"],
            "pool_players": len(request["pool"]), "cash_rounding": "exact_fraction",
            "projection_values": "explicit synthetic candidate ranking"},
        "checks": checks,
        "timing": {"strict_request_parse_seconds": parse_seconds,
            "single_cpu_helper_seconds": seconds, "timed_repeats": 1,
            "percentile_estimate": None},
        "result": deepcopy(result),
        "limitations": ["One local synthetic measurement is not a latency percentile or hosted performance promise.",
            "The candidate, game and field distributions are synthetic and provide no calibration or return evidence.",
            "The measurement includes CPU-helper preparation and selection; fixture construction is excluded.",
            "No account, external provider, database, accepted entry or platform settlement was accessed."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--candidate-count", type=int, default=600)
    parser.add_argument("--requested-count", type=int, default=150)
    parser.add_argument("--draw-count", type=int, default=32)
    args = parser.parse_args()
    receipt = engineering_receipt(candidate_count=args.candidate_count,
        requested_count=args.requested_count, draw_count=args.draw_count)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, allow_nan=False), encoding="utf-8", newline="\n")
    print(json.dumps({key: receipt[key] for key in ("request_bytes", "case", "timing")}, indent=2))
    result = receipt["result"]
    print(json.dumps({key: result.get(key) for key in
        ("complete", "selected_count", "capabilities", "solver")}, indent=2))
    if not all(receipt["checks"].values()):
        raise SystemExit("Synthetic engineering checks failed; inspect the retained receipt.")


if __name__ == "__main__":
    main()
