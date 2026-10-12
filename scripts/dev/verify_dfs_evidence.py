"""Exercise synthetic source evidence and real complete Classic comparisons.

Run with PYTHONPATH=. and the existing repository Python environment. No feeds,
models, accounts, or live entries are read. --write-browser-fixture updates the
explicitly synthetic production-browser fixture after independent audits pass.
This checks software behavior, not predictive performance or platform acceptance.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import sys
import time


TEAMS = ("BUF", "KC", "SEA", "LAR", "CHI", "MIN")
OPPONENTS = {"BUF": "KC", "KC": "BUF", "SEA": "LAR", "LAR": "SEA", "CHI": "MIN", "MIN": "CHI"}
CONTEXT = {"site": "draftkings", "sport": "NFL", "format": "classic", "slate_id": "classic-fixture", "season": 2026, "week": 5}
DECISION = "2026-10-11T12:00:00Z"


def synthetic_pool():
    import pandas as pd

    rows = []
    for index, team in enumerate(TEAMS):
        # SEA's projection inputs deliberately produce an omitted-game
        # challenger. These are declared synthetic estimates, not forecasts.
        strength = (1.0, 0.5, 3.0, 2.0, -1.0, -2.0)[index]
        for suffix, position, points, salary in (
            ("qb", "QB", 22.0, 6000), ("rb", "RB", 16.0, 5000),
            ("wr1", "WR", 16.0, 5500), ("wr2", "WR", 12.0, 4000),
            ("te", "TE", 10.0, 3500), ("dst", "DST", 7.0, 3000),
        ):
            identifier = f"e-{team.lower()}-{suffix}"
            rows.append({"player_id": identifier, "dfs_id": str(80001 + len(rows)),
                         "Player": f"Synthetic {team} {suffix.upper()}", "Position": position,
                         "Team": "LA" if team == "LAR" else team,
                         "Opponent": "LA" if OPPONENTS[team] == "LAR" else OPPONENTS[team],
                         "game_id": f"synthetic-{min(team, OPPONENTS[team]).lower()}-{max(team, OPPONENTS[team]).lower()}",
                         "salary": salary, "Projected Points": points + strength,
                         "Low (P10)": points + strength - 5, "High (P90)": points + strength + 7,
                         "value": (points + strength) / salary * 1000,
                         "projection_source": "Imported", "Injury Status": "", "on_bye": False})
    return pd.DataFrame(rows)


def synthetic_payload(frame):
    from src.products.dfs_opportunity import PLAY_DEFINITION

    source = {"source_id": "synthetic-observations", "provider": "Synthetic local fixture",
              "uri": "fixture:dfs-opportunity-evidence", "content_sha256": "a" * 64,
              "period": {"season": 2026, "start_week": 1, "end_week": 4},
              "published_at": "2026-10-06T00:00:00Z", "retrieved_at": "2026-10-06T01:00:00Z",
              "known_at": "2026-10-06T00:00:00Z", "definition": PLAY_DEFINITION["id"],
              "rights": {"personal_analysis": True, "hosted_ingestion": True, "display": True,
                         "redistribution": False, "training": False, "external_model": False},
              "evidence_scope": "synthetic"}
    teams = []

    def pair(home, away, week, home_plays, away_plays, home_dropbacks, away_dropbacks):
        game = f"synthetic-history-{home.lower()}-{away.lower()}-{week}"
        for team, opponent, is_home, plays, dropbacks in (
            (home, away, True, home_plays, home_dropbacks),
            (away, home, False, away_plays, away_dropbacks),
        ):
            teams.append({"game_id": game, "team": team, "opponent": opponent,
                          "season": 2026, "week": week, "is_home": is_home,
                          "kickoff_at": f"2026-09-{6 + (week - 1) * 7:02d}T17:00:00Z",
                          "ended_at": f"2026-09-{6 + (week - 1) * 7:02d}T21:00:00Z",
                          "source_id": source["source_id"], "plays": plays,
                          "designed_runs": plays - dropbacks, "dropbacks": dropbacks,
                          "sacks": 3, "scrambles": 2, "throws": dropbacks - 5,
                          "targeted": dropbacks - 7, "untargeted": 2, "completions": dropbacks - 15})

    # The first pair reproduces the independently asserted inherited formula.
    pair("KC", "BUF", 1, 60, 70, 40, 35)
    pair("BUF", "KC", 2, 60, 80, 30, 50)
    # Both teams lack the venue sample for their next matchup.
    pair("SEA", "LAR", 1, 64, 58, 38, 34)
    pair("SEA", "LAR", 2, 68, 62, 42, 36)
    # CHI has a history; MIN has none. Missing evidence is never zero.
    pair("CHI", "NYJ", 1, 62, 59, 36, 33)
    player_games = []
    for player in frame.to_dict("records"):
        if player["Position"] == "DST":
            continue
        for observed in teams:
            if observed["team"] != player["Team"]:
                continue
            suffix = player["player_id"].rsplit("-", 1)[-1]
            targets = {"qb": 0, "rb": 4, "wr1": 8, "wr2": 5, "te": 3}[suffix]
            carries = {"qb": 3, "rb": 12, "wr1": 0, "wr2": 0, "te": 0}[suffix]
            player_games.append({"game_id": observed["game_id"], "canonical_id": player["player_id"],
                                 "team": player["Team"], "targets": targets, "carries": carries,
                                 "source_id": source["source_id"]})
    source["content_sha256"] = hashlib.sha256(json.dumps({"team_games": teams, "player_games": player_games},
        sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return {"context": CONTEXT, "decision_at": DECISION,
            "games": [{"game_id": "synthetic-buf-kc", "away": "BUF", "home": "KC", "kickoff_at": "2099-10-11T17:00:00Z"},
                      {"game_id": "synthetic-lar-sea", "away": "SEA", "home": "LAR", "kickoff_at": "2099-10-11T20:25:00Z"},
                      {"game_id": "synthetic-chi-min", "away": "CHI", "home": "MIN", "kickoff_at": "2099-10-11T20:25:00Z"}],
            "players": [{"canonical_id": p["player_id"], "team": p["Team"], "position": p["Position"]}
                        for p in frame.to_dict("records")],
            "team_games": teams, "player_games": player_games, "sources": [source], "evidence_scope": "synthetic"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("outputs/dfs-evidence-engine"))
    parser.add_argument("--write-browser-fixture", action="store_true")
    args = parser.parse_args()
    os.environ["TESTING"] = "1"
    os.environ["SCORESENSE_TESTING"] = "1"
    repo = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repo))
    from src.products.dfs_classic_comparison import compare_classic_lineups, evaluate_common_snapshot
    from src.products.dfs_opportunity import (build_opportunity_evidence, parse_receiving_observations,
                                              prepare_opportunity_artifact, read_opportunity_artifact)

    started = time.monotonic()
    frame = synthetic_pool()
    payload = synthetic_payload(frame)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    evidence = prepare_opportunity_artifact(payload, directory=output / "artifact")
    (output / "source-observations.json").write_text(json.dumps({"team_games": payload["team_games"],
        "player_games": payload["player_games"]}, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    assert read_opportunity_artifact(CONTEXT, directory=output / "artifact") == evidence
    game = evidence["games"][0]
    assert game["team_screens"]["KC"]["plays_screen"] == 67.5
    assert game["team_screens"]["BUF"]["plays_screen"] == 66.25
    assert game["combined_play_screen"] == 133.75
    assert game["team_screens"]["KC"]["dropbacks_screen"] != game["team_screens"]["BUF"]["dropbacks_screen"]
    assert evidence["games"][1]["team_screens"]["SEA"]["venue_fallback"]
    assert evidence["games"][2]["combined_play_screen"] is None
    assert all(player["routes"] is None for player in evidence["players"])
    assert not evidence["capabilities"]["forward_role_model"] and not evidence["capabilities"]["contest_ev"]
    future = deepcopy(payload)
    future["sources"][0].update(published_at="2026-10-12T00:00:00Z", known_at="2026-10-12T00:00:00Z",
                                retrieved_at="2026-10-12T01:00:00Z")
    assert build_opportunity_evidence(**future)["games"][0]["combined_play_screen"] is None
    receiving_csv = "ID,RECV,RECV,TGT,PASS SNAPS,TEAM DB\ne-kc-wr2,88.2,100,24,125,150\n"
    receiving_source = {**payload["sources"][0], "source_id": "synthetic-receiving-report",
        "uri": "fixture:receiving-report", "definition": "synthetic_receiving_report_v1",
        "content_sha256": hashlib.sha256(receiving_csv.encode("utf-8")).hexdigest()}
    parsed = parse_receiving_observations(receiving_csv,
        source=receiving_source, column_map={"canonical_id": 0, "receiving_grade": 1, "routes": 2,
            "targets": 3, "player_pass_snaps": 4, "team_dropbacks": 5})
    row = parsed["rows"][0]
    assert row["receiving_grade"] == 88.2 and row["routes"] == 100 and row["targets_per_route"] == .24
    assert row["player_pass_snap_route_rate"] == .8 and row["team_dropback_route_participation"] == 2 / 3
    evidence = prepare_opportunity_artifact({**payload, "sources": [*payload["sources"], receiving_source],
        "receiving_reports": [{"source_id": receiving_source["source_id"], "csv_text": receiving_csv,
            "column_map": {"canonical_id": 0, "receiving_grade": 1, "routes": 2, "targets": 3,
                           "player_pass_snaps": 4, "team_dropbacks": 5}}]}, directory=output / "artifact")
    assert evidence["capabilities"]["route_evidence"]
    observed_receiver = next(player for player in evidence["players"] if player["canonical_id"] == "e-kc-wr2")
    assert observed_receiver["route_observations"][0]["player_pass_snap_route_rate"] == .8
    assert read_opportunity_artifact(CONTEXT, directory=output / "artifact") == evidence
    (output / "receiving-report.csv").write_text(receiving_csv, encoding="utf-8")
    report = compare_classic_lineups(frame, max_per_team=0, stack_qb_ids=["e-buf-qb", "e-kc-qb"],
        classic_stack_rules={"version": 1, "attachments": {"mode": "minimum", "count": 1},
                             "bring_back": {"mode": "optional", "count": 0}},
        receiving_rb_ids=[], snapshot_context={"context": CONTEXT,
            "evidence_content_id": evidence["content_id"], "decision_at": DECISION, "synthetic": True})
    feasible = [candidate for candidate in report["candidates"] if candidate["objective_score"] is not None]
    assert feasible and report["best_primary_id"] and report["best_challenger_id"]
    assert all(len(candidate["result"]["lineup"]) == 9 and candidate["result"]["validation"]["ok"] for candidate in feasible)
    assert any(len(candidate["completions"]) > 1 for candidate in feasible)
    assert any(p["team"] in {"SEA", "LAR", "CHI", "MIN"} for candidate in feasible if candidate["in_primary_scope"] for p in candidate["result"]["lineup"])
    historical = deepcopy(feasible[0]["result"])
    refreshed = frame.copy()
    refreshed["Projected Points"] += 1
    common = evaluate_common_snapshot([historical], refreshed,
        snapshot_context={"evidence_content_id": evidence["content_id"], "synthetic": True})
    assert common["complete"] and common["lineups"][0]["objective_score"] == feasible[0]["objective_score"] + 9
    assert historical == feasible[0]["result"]
    assert common["snapshot_id"] != report["snapshot_id"]
    constraints = report["constraints"]
    input_keys = ("player_id", "name", "team", "position", "opponent", "proj", "floor", "ceiling", "salary",
                  "dfs_id", "injury_status", "on_bye", "value")
    engine_inputs = {"context": CONTEXT, "pool": [{k: player[k] for k in input_keys}
        for player in report["common_snapshot"]["content"]["players"]], "objective": "median",
        **{k: constraints[k] for k in ("site", "salary_cap", "min_salary", "max_per_team", "locked_player_ids",
            "excluded_player_ids", "classic_stack_rules", "block_qb_opposing_dst")},
        "stack_qb_ids": constraints["primary_stack_qb_ids"], "stack_teams": constraints["primary_stack_teams"],
        "receiving_rb_ids": []}
    document = {"synthetic": True, "purpose": "Software and UI fixture; not model performance or a live recommendation",
                "context": CONTEXT, "pool": frame.to_dict("records"), "evidence": evidence,
                "comparison": report, "engine_inputs": engine_inputs, "parser_example": parsed}
    (output / "fixture.json").write_text(json.dumps(document, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    if args.write_browser_fixture:
        fixture = repo / "frontend/test-fixtures/dfs-evidence-data.json"
        browser = deepcopy(document)
        browser["purpose"] += "; browser projection omits duplicated results/audits; full report stays in outputs"
        browser["comparison"].pop("common_snapshot", None)
        for candidate in browser["comparison"]["candidates"]:
            for key in ("result", "original_stack_audit", "dst_audit"):
                candidate.pop(key, None)
            for completion in candidate["completions"]:
                for key in ("stack_audit", "original_stack_audit", "dst_audit"):
                    completion.pop(key, None)
        # One candidate per line keeps the generated artifact bounded and reviewable.
        encoded = json.dumps(browser, separators=(",", ":"), allow_nan=False)
        encoded = encoded.replace('},{"id":', '},\n{"id":')
        fixture.write_text(encoded + "\n", encoding="utf-8", newline="\n")
    summary = {"synthetic": True, "evidence_roundtrip": True, "exact_inherited_screen": True,
               "future_source_excluded": True, "denominators_distinct": True, "missing_venue_fallback": True,
               "missing_evidence_stays_null": True, "common_snapshot_evaluation": True,
               "historical_result_unchanged": True, "complete_nine_player_audits": True,
               "candidate_count": len(report["candidates"]), "feasible_candidates": len(feasible),
               "attempt_count": report["attempt_count"], "comparison_complete": report["complete"],
               "completion_search_complete": report["completion_search_complete"],
               "comparison_seconds": report["runtime_seconds"], "seconds": round(time.monotonic() - started, 4),
               "evidence_content_id": evidence["content_id"], "comparison_snapshot_id": report["snapshot_id"],
               "forward_role_model": False, "contest_ev": False, "platform_acceptance": "unconfirmed"}
    (output / "verification.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
