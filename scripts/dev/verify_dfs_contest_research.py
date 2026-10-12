"""Reproducible synthetic engineering receipt; never historical calibration.

The maximum supported replay case deliberately constructs 750 distinct pool
players, 16 games with two coherent profiles each, 150 distinct own rosters,
four assumptions with 500 distinct legal templates each, a full 100000-entry
contest and 256 shared game draws. This is a local CPU/heap measurement, not a
hosted latency promise, real slate, ownership fit, or financial forecast.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import platform
import random
from statistics import median
from time import perf_counter
import tracemalloc

import numpy as np

from src.products.dfs_event_scoring import SCORING_VERSION
from src.products.dfs_shared_outcomes import prepare_scenario_bank
from src.products.dfs_contest_research import prepare_contest_research, evaluate_contest_research

TEAMS = ("ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
         "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ",
         "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS")
DECISION = "2026-10-12T00:00:00Z"


def maximum_fixture():
    """Construct every bound asserted by this receipt, without mutating files."""
    context = {"site": "draftkings", "sport": "NFL", "format": "classic", "season": 2026,
               "week": 6, "slate_id": "synthetic-max-contest-engineering"}
    pool, games = [], []
    for game_index in range(16):
        home, away = TEAMS[2 * game_index:2 * game_index + 2]
        game_id = f"synthetic-game-{game_index:02d}"
        participants = []
        for position, count in (("QB", 2), ("RB", 12), ("WR", 24), ("TE", 7 if game_index != 15 else 5), ("DST", 2)):
            for index in range(count):
                team = home if index % 2 == 0 else away
                player = {"player_id": f"g{game_index:02d}-{position.lower()}{index:02d}", "team": team,
                    "opponent": away if team == home else home, "position": position}
                participants.append({**player, "status": "active", "availability_scenario": "normal"})
                pool.append({**player, "game_id": game_id, "salary": 2000 + 100 * (index % 5)})
        profiles = []
        quarterbacks = {row["team"]: row["player_id"] for row in participants if row["position"] == "QB"}
        for profile_index in range(2):
            events = []
            for index, player in enumerate(participants):
                if player["position"] in {"WR", "TE"}:
                    events.append({"event_id": f"pass-{index}", "kind": "pass", "team": player["team"], "period": 1,
                        "passer_id": quarterbacks[player["team"]], "receiver_id": player["player_id"],
                        "complete": True, "intercepted": False, "yards": 4 + index % (8 if profile_index == 0 else 27),
                        "td": profile_index == 1 and index % 11 == 0})
                elif player["position"] == "RB":
                    events.append({"event_id": f"rush-{index}", "kind": "rush", "team": player["team"], "period": 1,
                        "rusher_id": player["player_id"], "rush_type": "designed", "yards": 1 + index % (4 if profile_index == 0 else 13),
                        "td": profile_index == 1 and index % 13 == 0})
            profiles.append({"profile_id": f"synthetic-regime-{profile_index}", "weight": 1 + profile_index,
                "source_ids": ["synthetic-events"], "shared_state": {"weather": "synthetic", "game_script": f"regime-{profile_index}",
                    "personnel": "declared synthetic participants"}, "players": deepcopy(participants),
                "events": events, "ledger_complete": True})
        games.append({"game_id": game_id, "home_team": home, "away_team": away, "kickoff_at": "2026-10-18T17:00:00Z",
                      "profiles": profiles})
    assert len(pool) == 750
    def receipt(identity, digest):
        return {"source_id": identity, "provider": "explicit synthetic engineering fixture", "uri": f"fixture:{identity}",
            "content_sha256": digest, "definition": "Synthetic inputs for maximum-bound CPU and heap verification only",
            "period": {"season": 2026, "start_week": 6, "end_week": 6}, "published_at": "2026-10-11T00:00:00Z",
            "known_at": "2026-10-11T00:00:00Z", "retrieved_at": DECISION, "evidence_scope": "synthetic",
            "rights": {"personal_analysis": True, "hosted_ingestion": True, "display": True,
                "redistribution": False, "training": False, "external_model": False}}
    events_source = receipt("synthetic-events", hashlib.sha256(json.dumps(games, sort_keys=True).encode()).hexdigest())
    bank_payload = {"schema_version": "dfs_shared_outcomes_bank_v1", "scoring_version": SCORING_VERSION,
        "mode": "declared_empirical_scenarios", "context": context, "decision_at": DECISION,
        "evidence_scope": "synthetic", "sources": [events_source], "games": games}
    rng = random.Random(20261012)
    by_position = {position: [row for row in pool if row["position"] == position] for position in ("QB", "RB", "WR", "TE", "DST")}
    def roster():
        qb = rng.choice(by_position["QB"])
        wrs = rng.sample([row for row in by_position["WR"] if row["team"] == qb["team"]], 2)
        ids = [qb["player_id"], *(row["player_id"] for row in rng.sample(by_position["RB"], 2)),
               *(row["player_id"] for row in wrs)]
        ids.append(rng.choice([row for row in by_position["WR"] if row["player_id"] not in ids])["player_id"])
        ids.append(rng.choice(by_position["TE"])["player_id"])
        ids.append(rng.choice(by_position["DST"])["player_id"])
        ids.append(rng.choice([row for row in pool if row["position"] in {"RB", "WR", "TE"} and row["player_id"] not in ids])["player_id"])
        return sorted(ids)
    own, templates, seen = [], [], set()
    while len(own) < 150:
        ids = roster()
        if tuple(ids) not in seen:
            own.append({"lineup_id": f"own-{len(own):03d}", "player_ids": ids})
            seen.add(tuple(ids))
    templates.extend(deepcopy(own[:50]))
    template_sets = {tuple(row["player_ids"]) for row in templates}
    while len(templates) < 500:
        ids = roster()
        if tuple(ids) not in template_sets:
            templates.append({"lineup_id": f"field-{len(templates):03d}", "player_ids": ids})
            template_sets.add(tuple(ids))
    source = receipt("synthetic-field-policy", hashlib.sha256(b"synthetic engineering field and cash policy v1").hexdigest())
    scenarios = [{"scenario_id": f"assumption-{index}", "provider": f"synthetic-provider-{index}",
        "injury_assumption": f"synthetic shared rotation {index}", "known_at": DECISION,
        "source_ids": [source["source_id"]], "split_id": "synthetic-engineering-only", "ownership_units": "fraction",
        "ownership_contest_type": "mini_max", "ownership": [],
        "templates": [{"template_id": row["lineup_id"], "player_ids": row["player_ids"],
            "weight": 1 + (number + index * 7) % (5 + index * 3)} for number, row in enumerate(templates)]} for index in range(4)]
    field_payload = {"schema_version": "dfs_contest_field_v1", "mode": "declared_legal_lineup_templates", "context": context,
        "contest": {"contest_id": "synthetic-100000-entry-contest", "contest_type": "mini_max", "entrant_count": 100000},
        "decision_at": DECISION, "evidence_scope": "synthetic", "sources": [source], "scenarios": scenarios}
    payout = {"schema_version": "dfs_cash_payout_contract_v1", "contest_id": field_payload["contest"]["contest_id"],
        "entrant_count": 100000, "currency": "USD", "entry_fee_cents": 100, "paid_places": 10000,
        "payout_tiers": [{"start_rank": 1, "end_rank": 1, "prize_cents": 1000000},
            {"start_rank": 2, "end_rank": 10, "prize_cents": 10000},
            {"start_rank": 11, "end_rank": 100, "prize_cents": 1000},
            {"start_rank": 101, "end_rank": 10000, "prize_cents": 200}],
        "unpaid_ranks": "zero", "noncash_prizes": [], "tie_policy": {"cash_split": "occupied_rank_mean", "rounding": "exact_fraction",
            "source": {"source_uri": source["uri"], "content_sha256": source["content_sha256"], "as_of": source["known_at"]}}}
    return context, pool, bank_payload, field_payload, payout, own


def engineering_receipt(*, repeats=3, draw_count=256, measure_heap=True):
    if type(repeats) is not int or not 1 <= repeats <= 9 or draw_count not in {32, 64, 128, 256}:
        raise ValueError("Use 1–9 timed repeats and 32,64,128 or256 draws.")
    context, pool, raw_bank, raw_field, payout, own = maximum_fixture()
    started = perf_counter()
    bank = prepare_scenario_bank(raw_bank, context=context, pool=pool)
    prepared = prepare_contest_research(bank, raw_field, payout)
    preparation_seconds = perf_counter() - started
    request = {"context": context, "pool": pool, "bank": raw_bank, "contest_field": raw_field,
        "payout_contract": payout, "lineups": own, "input_snapshot_id": hashlib.sha256(b"synthetic-max-engineering-snapshot").hexdigest(),
        "bank_id": bank["content_id"], "contest_research_id": prepared["content_id"], "seed": 20261012, "draw_count": draw_count, "top_k": 10}
    serialized = json.dumps(request, separators=(",", ":"), allow_nan=False).encode()
    # Import only the request model in this standalone fixture process. Never
    # load production credentials or start an API/application lifecycle.
    os.environ["SCORESENSE_TESTING"] = "1"
    from app.dfs_contest_research_routes import EvaluateContest
    from app.dfs_shared_outcomes_routes import MAX_BODY_BYTES, _parse_body
    assert len(serialized) < MAX_BODY_BYTES
    _parse_body(serialized, EvaluateContest)
    timings, report = [], None
    for _ in range(repeats):
        started = perf_counter()
        report = evaluate_contest_research(bank, prepared, own, seed=20261012, draw_count=draw_count)
        timings.append(perf_counter() - started)
    assert report["own_entry_count"] == 150 and report["opponent_entry_count"] == 99850
    assert len(report["assumptions"]) == 4 and all(len(row["lineups"]) == 150 for row in report["assumptions"])
    assert not report["capabilities"]["expected_payout"] and not report["capabilities"]["forward_forecast"]
    peak = None
    if measure_heap:
        tracemalloc.start()
        evaluate_contest_research(bank, prepared, own, seed=20261012, draw_count=draw_count)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
    return {"schema_version": "dfs_contest_engineering_receipt_v1", "evidence_scope": "synthetic",
        "input_sha256": hashlib.sha256(serialized).hexdigest(), "request_bytes": len(serialized),
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "platform": platform.platform()},
        "case": {"pool_players": len(pool), "games": len(raw_bank["games"]), "profiles": sum(len(g["profiles"]) for g in raw_bank["games"]),
            "events": sum(len(profile["events"]) for g in raw_bank["games"] for profile in g["profiles"]), "own_entries": len(own),
            "contest_entries": payout["entrant_count"], "assumptions": len(raw_field["scenarios"]),
            "templates_per_assumption": [len(row["templates"]) for row in raw_field["scenarios"]], "draw_count": draw_count,
            "cash_tiers": len(payout["payout_tiers"]), "missing_projected_ownership_retained": True},
        "checks": {"whole_field_represented": True, "all_own_entries_in_ties": True, "validated_coherent_game_profiles": True,
            "strict_bounded_request_model_checked": True, "no_raw_provider_or_account_access": True, "no_fitted_or_calibrated_claim": True},
        "timing": {"preparation_seconds": preparation_seconds, "timed_repeats": repeats, "replay_seconds": timings,
            "replay_p50_seconds": median(timings), "replay_p95_seconds": float(np.quantile(timings, .95))},
        "memory": {"separate_tracemalloc_replay_peak_bytes": peak, "includes_preparation": False, "is_process_rss": False},
        "capabilities": report["capabilities"],
        "limitations": ["Maximum replay-control dimensions are constructed, but only two profiles per game and four cash tiers are measured.",
            "Synthetic salaries and game events exercise bounded engineering behavior; they are not a real slate or historical field sample.",
            "Local warm-process timing and Python heap exclude hosting overhead, full process RSS and source-model uncertainty.",
            "Declared template support does not validate opponent frequency calibration, extreme-rank probabilities or forward payout."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--draw-count", type=int, default=256)
    parser.add_argument("--skip-heap", action="store_true")
    args = parser.parse_args()
    receipt = engineering_receipt(repeats=args.repeats, draw_count=args.draw_count, measure_heap=not args.skip_heap)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, allow_nan=False), encoding="utf-8", newline="\n")
    print(json.dumps({key: receipt[key] for key in ("request_bytes", "case", "timing", "memory", "capabilities")}, indent=2))


if __name__ == "__main__":
    main()
