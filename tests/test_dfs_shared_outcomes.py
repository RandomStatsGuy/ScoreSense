"""Declared synthetic ledgers exercise contracts; they are not model validation."""
from copy import deepcopy
import hashlib
import json
from time import perf_counter

import pytest

from src.products.dfs_shared_outcomes import (
    prepare_scenario_bank, evaluate_shared_outcomes, scenario_bank_summary,
    SCHEMA_VERSION, SEMANTICS,
)

CONTEXT = {"site": "draftkings", "sport": "NFL", "format": "classic", "season": 2099,
           "week": 3, "slate_id": "synthetic-shared-events"}
NOW = "2026-10-12T23:00:00Z"


def fixture():
    from src.products.dfs_event_scoring import SCORING_VERSION
    positions = [("buf-qb", "BUF", "QB"), ("buf-rb", "BUF", "RB"), ("mia-rb", "MIA", "RB"),
                 ("buf-wr1", "BUF", "WR"), ("buf-wr2", "BUF", "WR"), ("mia-wr1", "MIA", "WR"),
                 ("buf-te", "BUF", "TE"), ("mia-te", "MIA", "TE"), ("buf-dst", "BUF", "DST"),
                 ("mia-wr2", "MIA", "WR")]
    pool = [{"player_id": pid, "game_id": "buf-mia", "team": team, "opponent": "MIA" if team == "BUF" else "BUF",
             "position": pos, "salary": 5000} for pid, team, pos in positions]
    next(row for row in pool if row["player_id"] == "mia-te").update(player_id="kc-te", team="KC", opponent="LV", game_id="kc-lv")
    actors = [{key: value for key, value in row.items() if key not in {"salary", "game_id"}} for row in pool if row["game_id"] == "buf-mia"]
    actors += [{"player_id": "mia-qb", "team": "MIA", "opponent": "BUF", "position": "QB"},
               {"player_id": "mia-dst", "team": "MIA", "opponent": "BUF", "position": "DST"},
               {"player_id": "buf-residual", "team": "BUF", "opponent": "MIA", "position": "RESIDUAL", "residual": True}]
    for actor in actors:
        actor.update(status="active", availability_scenario="normal")
    def event(eid, kind, team="BUF", **fields):
        return {"event_id": eid, "kind": kind, "team": team, "period": 1, **fields}
    success = [event("p1", "pass", passer_id="buf-qb", receiver_id="buf-wr1", complete=True,
                     intercepted=False, yards=50, td=True),
               event("p2", "pass", passer_id="buf-qb", receiver_id="buf-residual", complete=True,
                     intercepted=False, yards=20, td=False),
               event("r1", "rush", rusher_id="buf-rb", rush_type="designed", yards=8, td=False),
               event("r2", "rush", team="MIA", rusher_id="mia-rb", rush_type="designed", yards=3, td=False),
               event("p3", "pass", team="MIA", passer_id="mia-qb", receiver_id="mia-wr1", complete=True,
                     intercepted=False, yards=25, td=False)]
    poor = [event("i1", "pass", passer_id="buf-qb", receiver_id="buf-wr1", complete=False,
                  intercepted=True, yards=0, td=False),
            event("s1", "sack", passer_id="buf-qb", yards=-7),
            event("r3", "rush", rusher_id="buf-rb", rush_type="designed", yards=-3, td=False)]
    profiles = []
    for name, events, weather in [("success", success, "clear"), ("pressure-limited", poor, "wind"), ("zero-volume", [], "declared-low-volume")]:
        participants = deepcopy(actors)
        if name == "pressure-limited":
            next(row for row in participants if row["player_id"] == "buf-wr2").update(status="inactive", availability_scenario="inactive")
            next(row for row in participants if row["player_id"] == "buf-rb")["availability_scenario"] = "limited"
        profiles.append({"profile_id": name, "weight": 1, "source_ids": ["synthetic-events"],
                         "shared_state": {"weather": weather, "game_script": name, "personnel": "declared synthetic rotation"},
                         "players": participants, "events": events, "ledger_complete": True})
    receipt = {"source_id": "synthetic-events", "provider": "explicit synthetic test fixture", "uri": "fixture:shared-events",
               "content_sha256": hashlib.sha256(json.dumps(profiles, sort_keys=True).encode()).hexdigest(),
               "period": {"season": 2026, "start_week": 1, "end_week": 2},
               "published_at": "2026-10-10T00:00:00Z", "known_at": "2026-10-10T00:00:00Z",
               "retrieved_at": "2026-10-12T00:00:00Z", "definition": "explicit complete synthetic event ledgers",
               "evidence_scope": "synthetic", "rights": {"personal_analysis": True, "hosted_ingestion": True,
               "display": True, "redistribution": True, "training": False, "external_model": False}}
    payload = {"schema_version": SCHEMA_VERSION, "scoring_version": SCORING_VERSION, "mode": "declared_empirical_scenarios",
               "context": deepcopy(CONTEXT), "decision_at": "2026-10-12T12:00:00Z", "evidence_scope": "synthetic",
               "sources": [receipt], "games": [{"game_id": "buf-mia", "home_team": "BUF", "away_team": "MIA",
               "kickoff_at": "2099-09-20T17:00:00Z", "profiles": profiles}]}
    second_actors = [{"player_id": "kc-te", "team": "KC", "opponent": "LV", "position": "TE"},
                     {"player_id": "kc-dst", "team": "KC", "opponent": "LV", "position": "DST"},
                     {"player_id": "lv-dst", "team": "LV", "opponent": "KC", "position": "DST"}]
    for actor in second_actors:
        actor.update(status="active", availability_scenario="normal")
    payload["games"].append({"game_id": "kc-lv", "home_team": "KC", "away_team": "LV", "kickoff_at": "2099-09-20T17:00:00Z",
        "profiles": [{"profile_id": "declared-zero-volume", "weight": 1, "source_ids": ["synthetic-events"],
            "shared_state": {"weather": "declared", "game_script": "zero volume", "personnel": "synthetic"},
            "players": second_actors, "events": [], "ledger_complete": True}]})
    payload["sources"][0]["content_sha256"] = hashlib.sha256(json.dumps(payload["games"], sort_keys=True).encode()).hexdigest()
    lineups = [{"lineup_id": "first", "player_ids": [row["player_id"] for row in pool[:9]]},
               {"lineup_id": "alternative", "player_ids": [row["player_id"] for row in pool[:9] if row["player_id"] != "buf-wr2"] + ["mia-wr2"]}]
    return payload, pool, lineups


def prepared():
    payload, pool, lineups = fixture()
    return prepare_scenario_bank(payload, context=CONTEXT, pool=pool, now=NOW), lineups


def test_whole_game_scores_include_unselected_residual_and_opposing_dst():
    bank, lineups = prepared()
    profiles = {row["profile_id"]: row for row in bank["games"][0]["profiles"]}
    assert profiles["success"]["player_scores"]["buf-qb"] == pytest.approx(6.8)
    assert profiles["success"]["player_scores"]["buf-residual"] == 3
    assert profiles["pressure-limited"]["player_scores"]["buf-qb"] == -1
    assert profiles["pressure-limited"]["player_scores"]["mia-dst"] == 13
    assert profiles["pressure-limited"]["player_scores"]["buf-rb"] == pytest.approx(-.3)
    result = evaluate_shared_outcomes(bank, lineups, seed=19, draw_count=512)
    assert result["audit"]["conservation_passed"]
    assert result["semantics"] == SEMANTICS
    assert not result["capabilities"]["calibrated_joint_tail"]
    players = {row["player_id"]: row for row in result["players"]}
    assert players["buf-qb"]["negative_fraction"] > 0
    assert players["buf-wr2"]["zero_fraction"] == 1
    assert all(row["paired_delta_mean_vs_first"] == 0 for row in result["lineups"])
    assert players["buf-qb"]["mean"] == pytest.approx(sum(
        profiles[row["profile_id"]]["player_scores"]["buf-qb"] * row["draws"] / 512 for row in result["profile_selections"] if row["game_id"] == "buf-mia"))


def test_streams_are_reproducible_separate_and_common_across_finalists():
    bank, lineups = prepared()
    a = evaluate_shared_outcomes(bank, lineups, seed=38, draw_count=256)
    b = evaluate_shared_outcomes(bank, list(reversed(lineups)), seed=38, draw_count=256)
    assert a["stream_manifest"] == b["stream_manifest"]
    assert {row["lineup_id"]: row["mean"] for row in a["lineups"]} == {row["lineup_id"]: row["mean"] for row in b["lineups"]}
    assert len(set(a["stream_manifest"]["streams"].values())) == 3
    generation = evaluate_shared_outcomes(bank, lineups, seed=38, draw_count=256, purpose="generation")
    assert generation["stream_manifest"]["draw_content_id"] != a["stream_manifest"]["draw_content_id"]
    assert generation["stream_manifest"]["streams"] == a["stream_manifest"]["streams"]
    assert a["stream_manifest"]["independent_streams_not_disjoint_outcomes"]


def test_paired_full_lineup_delta_uses_the_same_receiving_events():
    bank, lineups = prepared()
    lineups[1]["player_ids"] = [pid if pid != "buf-wr1" else "mia-wr2" for pid in lineups[0]["player_ids"]]
    result = evaluate_shared_outcomes(bank, lineups, seed=19, draw_count=256)
    receiver = next(row for row in result["players"] if row["player_id"] == "buf-wr1")
    first, alternative = result["lineups"]
    assert receiver["mean"] > 0
    assert alternative["paired_delta_mean_vs_first"] == pytest.approx(-receiver["mean"])
    assert alternative["mean"] - first["mean"] == pytest.approx(-receiver["mean"])
    assert alternative["paired_better_fraction_vs_first"] == 0


def test_prepared_bank_is_detached_and_content_mutation_rejected():
    payload, pool, lineups = fixture()
    bank = prepare_scenario_bank(payload, context=CONTEXT, pool=pool, now=NOW)
    payload["games"][0]["profiles"][0]["events"][0]["yards"] = 1
    pool[0]["salary"] = 1
    assert bank["pool"][0]["salary"] == 5000
    summary = scenario_bank_summary(bank)
    assert "games" not in summary and "pool" not in summary
    summary["capabilities"]["forward_forecast"] = True
    assert not bank["capabilities"]["forward_forecast"]
    bank["games"][0]["profiles"][0]["player_scores"]["buf-qb"] = 200
    with pytest.raises(ValueError, match="changed"):
        evaluate_shared_outcomes(bank, lineups)


@pytest.mark.parametrize("case", ["context", "scoring", "future-cutoff", "future-source", "rights", "unknown-actor-status",
    "missing-player", "wrong-game", "wrong-team", "incompatible-status", "missing-shared-state", "partial-ledger",
    "missing-source", "duplicate-profile", "negative-weight", "nan-weight", "unsupported-event"])
def test_incompatible_or_incomplete_bank_rejects_atomically(case):
    payload, pool, _ = fixture()
    profile = payload["games"][0]["profiles"][0]
    if case == "context": payload["context"]["slate_id"] = "other"
    elif case == "scoring": payload["scoring_version"] = "other"
    elif case == "future-cutoff": payload["decision_at"] = "2099-09-19T00:00:00Z"
    elif case == "future-source": payload["sources"][0]["known_at"] = "2099-09-19T00:00:00Z"
    elif case == "rights": payload["sources"][0]["rights"]["hosted_ingestion"] = None
    elif case == "unknown-actor-status": profile["players"][0]["status"] = "unknown"
    elif case == "missing-player": profile["players"] = [row for row in profile["players"] if row["player_id"] != "mia-wr2"]
    elif case == "wrong-game": pool[0]["game_id"] = "other"
    elif case == "wrong-team": pool[0]["opponent"] = "NYJ"
    elif case == "incompatible-status": profile["players"][0]["availability_scenario"] = "inactive"
    elif case == "missing-shared-state": del profile["shared_state"]["weather"]
    elif case == "partial-ledger": profile["ledger_complete"] = False
    elif case == "missing-source": profile["source_ids"] = ["missing"]
    elif case == "duplicate-profile": payload["games"][0]["profiles"].append(deepcopy(profile))
    elif case == "negative-weight": profile["weight"] = -1
    elif case == "nan-weight": profile["weight"] = float("nan")
    elif case == "unsupported-event": profile["events"][0]["lateral_yards"] = 8
    with pytest.raises(ValueError):
        prepare_scenario_bank(payload, context=CONTEXT, pool=pool, now=NOW)


def test_inactive_participant_cannot_have_events_and_unknown_is_not_zero():
    payload, pool, _ = fixture()
    next(row for row in payload["games"][0]["profiles"][0]["players"] if row["player_id"] == "buf-wr1").update(
        status="inactive", availability_scenario="inactive")
    with pytest.raises(ValueError):
        prepare_scenario_bank(payload, context=CONTEXT, pool=pool, now=NOW)


@pytest.mark.parametrize("change", ["unknown", "short", "duplicate", "bad-flex", "salary", "permutation"])
def test_finalists_require_complete_legal_distinct_classic_rosters(change):
    payload, pool, lineups = fixture()
    if change == "unknown": lineups[0]["player_ids"][0] = "missing"
    elif change == "short": lineups[0]["player_ids"].pop()
    elif change == "duplicate": lineups[0]["player_ids"][0] = lineups[0]["player_ids"][1]
    elif change == "bad-flex": lineups[0]["player_ids"][0] = "mia-wr2"
    elif change == "salary": pool[0]["salary"] = 15000
    elif change == "permutation": lineups.append({"lineup_id": "duplicate", "player_ids": list(reversed(lineups[0]["player_ids"]))})
    bank = prepare_scenario_bank(payload, context=CONTEXT, pool=pool, now=NOW)
    with pytest.raises(ValueError):
        evaluate_shared_outcomes(bank, lineups)


@pytest.mark.parametrize("kwargs", [{"draw_count": 15}, {"draw_count": 1025}, {"draw_count": True}, {"seed": -1}, {"seed": True}, {"purpose": "fit-on-evaluation"}])
def test_runtime_and_random_stream_limits(kwargs):
    bank, lineups = prepared()
    with pytest.raises(ValueError):
        evaluate_shared_outcomes(bank, lineups, **kwargs)


def test_draw_count_does_not_relabel_readiness():
    bank, lineups = prepared()
    result = evaluate_shared_outcomes(bank, lineups, draw_count=1024)
    assert result["capabilities"] == evaluate_shared_outcomes(bank, lineups, draw_count=16)["capabilities"]
    assert result["audit"]["game_draws"] == 2048
    assert not result["capabilities"]["forward_forecast"]


@pytest.mark.parametrize("location", ["bank", "game", "profile", "actor", "pool", "context"])
def test_unsupported_controls_cannot_be_silently_dropped(location):
    payload, pool, _ = fixture()
    target = {"bank": payload, "game": payload["games"][0], "profile": payload["games"][0]["profiles"][0],
              "actor": payload["games"][0]["profiles"][0]["players"][0], "pool": pool[0], "context": payload["context"]}[location]
    target["extra_correlation_bonus"] = 8
    with pytest.raises(ValueError, match="unsupported"):
        prepare_scenario_bank(payload, context=CONTEXT, pool=pool, now=NOW)


def test_finalist_extra_control_rejected_not_ignored():
    bank, lineups = prepared()
    lineups[0]["force_evaluation_seed"] = 0
    with pytest.raises(ValueError, match="unsupported"):
        evaluate_shared_outcomes(bank, lineups)


def test_classic_scoring_roster_requires_two_different_nfl_games():
    bank, lineups = prepared()
    entry = lineups[0]
    entry["player_ids"] = [pid if pid != "kc-te" else "mia-wr2" for pid in entry["player_ids"]]
    with pytest.raises(ValueError, match="at least two different NFL games"):
        evaluate_shared_outcomes(bank, [entry])


@pytest.mark.parametrize("field", ["position", "status", "availability_scenario", "evidence_scope"])
@pytest.mark.parametrize("value", [[], {}])
def test_nested_enum_containers_are_validation_failures(field, value):
    payload, pool, _ = fixture()
    if field == "evidence_scope":
        payload[field] = value
    else:
        payload["games"][0]["profiles"][0]["players"][0][field] = value
    with pytest.raises(ValueError):
        prepare_scenario_bank(payload, context=CONTEXT, pool=pool, now=NOW)


def maximum_budget_fixture():
    """Explicit synthetic 32-team/750-player input, not a claimed real slate."""
    payload, _, _ = fixture()
    teams = "ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LA MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split()
    games, pool = [], []
    for index in range(16):
        home, away = teams[2 * index:2 * index + 2]
        game_id = f"maximum-synthetic-{index}"
        actors = []
        count = 47 if index < 14 else 46
        for n in range(count):
            team = home if n % 2 == 0 else away
            opponent = away if team == home else home
            position = "DST" if n < 2 else ("QB", "RB", "RB", "WR", "WR", "WR", "TE")[(n - 2) % 7]
            player_id = f"max-{index}-{n}"
            pool.append({"player_id": player_id, "game_id": game_id, "team": team, "opponent": opponent, "position": position, "salary": 5000})
            actors.append({"player_id": player_id, "team": team, "opponent": opponent, "position": position,
                           "status": "active", "availability_scenario": "normal"})
        profiles = []
        for scenario in range(3):
            events = []
            for team in (home, away):
                quarterback = next(row["player_id"] for row in actors if row["team"] == team and row["position"] == "QB")
                receiver = next(row["player_id"] for row in actors if row["team"] == team and row["position"] == "WR")
                runner = next(row["player_id"] for row in actors if row["team"] == team and row["position"] == "RB")
                events += [{"event_id": f"{team}-pass", "kind": "pass", "team": team, "period": 1,
                            "passer_id": quarterback, "receiver_id": receiver, "complete": True,
                            "intercepted": False, "yards": 20 + 30 * scenario, "td": scenario == 2},
                           {"event_id": f"{team}-rush", "kind": "rush", "team": team, "period": 1,
                            "rusher_id": runner, "rush_type": "designed", "yards": 5 - 4 * scenario, "td": False}]
            profiles.append({"profile_id": f"synthetic-{scenario}", "weight": 1, "source_ids": ["synthetic-events"],
                             "shared_state": {"weather": "declared", "game_script": str(scenario), "personnel": "synthetic"},
                             "players": deepcopy(actors), "events": events, "ledger_complete": True})
        games.append({"game_id": game_id, "home_team": home, "away_team": away, "kickoff_at": "2099-09-20T17:00:00Z", "profiles": profiles})
    payload["games"] = games
    payload["sources"][0]["content_sha256"] = hashlib.sha256(json.dumps(games, sort_keys=True).encode()).hexdigest()
    by_position = {pos: [row["player_id"] for row in pool if row["position"] == pos] for pos in ("QB", "RB", "WR", "TE", "DST")}
    game_by_id = {row["player_id"]: row["game_id"] for row in pool}
    lineups = []
    for index in range(150):
        quarterback = by_position["QB"][index % len(by_position["QB"])]
        different_game_tes = [pid for pid in by_position["TE"] if game_by_id[pid] != game_by_id[quarterback]]
        ids = [quarterback,
               by_position["RB"][index % len(by_position["RB"])], by_position["RB"][(index + 1) % len(by_position["RB"])],
               *[by_position["WR"][(index + offset) % len(by_position["WR"])] for offset in range(4)],
               different_game_tes[index % len(different_game_tes)], by_position["DST"][index % len(by_position["DST"])]]
        lineups.append({"lineup_id": f"synthetic-{index}", "player_ids": ids})
    return payload, pool, lineups


def test_declared_maximum_pool_portfolio_and_draw_budget_completes():
    payload, pool, lineups = maximum_budget_fixture()
    bank = prepare_scenario_bank(payload, context=CONTEXT, pool=pool, now=NOW)
    result = evaluate_shared_outcomes(bank, lineups, draw_count=1024, seed=20261012)
    assert len(result["players"]) == 750 and len(result["lineups"]) == 150
    assert result["audit"]["game_draws"] == 16384
    assert result["audit"]["profiles_validated"] == 48
    assert not result["capabilities"]["calibrated_marginals"]
