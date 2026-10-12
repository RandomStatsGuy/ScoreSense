"""Synthetic arithmetic fixtures; these are not historical field calibration."""
from copy import deepcopy
import hashlib
from fractions import Fraction
import json
from pathlib import Path
import subprocess
import sys

import pytest

from src.analytics.dfs_contest_field_eval import evaluate_field_frequencies, MANIFEST_VERSION


def fixture():
    context = {"site": "draftkings", "sport": "NFL", "format": "classic", "season": 2026,
               "week": 6, "slate_id": "synthetic-field-holdout"}
    positions = [("qb", "BUF", "QB"), ("rb1", "BUF", "RB"), ("rb2", "MIA", "RB"),
        ("wr1", "BUF", "WR"), ("wr2", "BUF", "WR"), ("wr3", "MIA", "WR"),
        ("te1", "BUF", "TE"), ("te2", "KC", "TE"), ("dst", "BUF", "DST"),
        ("wr4", "KC", "WR"), ("unused", "LV", "RB")]
    opponent = {"BUF": "MIA", "MIA": "BUF", "KC": "LV", "LV": "KC"}
    pool = [{"player_id": pid, "team": team, "opponent": opponent[team], "position": pos,
             "game_id": "buf-mia" if team in {"BUF", "MIA"} else "kc-lv",
             "salary": 6000 if pid == "wr4" else 5000} for pid, team, pos in positions]
    first = [row["player_id"] for row in pool[:9]]
    second = [pid if pid != "wr2" else "wr4" for pid in first]
    def entry(identity, ids, count):
        return {"lineup_id": identity, "player_ids": ids, "multiplicity": count}
    def receipt(sid, time, week):
        return {"source_id": sid, "provider": "explicit synthetic field fixture", "uri": f"fixture:{sid}",
            "content_sha256": hashlib.sha256(sid.encode()).hexdigest(),
            "period": {"season": 2026, "start_week": week, "end_week": week},
            "published_at": time, "known_at": time, "retrieved_at": "2026-10-12T00:00:00Z",
            "definition": "Complete synthetic legal counted rosters for arithmetic only", "evidence_scope": "synthetic",
            "rights": {"personal_analysis": True, "hosted_ingestion": True, "display": True,
                       "redistribution": False, "training": None, "external_model": False}}
    sources = [receipt("earlier", "2026-10-01T00:00:00Z", 4),
               receipt("forecast", "2026-10-07T00:00:00Z", 6),
               receipt("observed", "2026-10-11T23:00:00Z", 6)]
    manifest = {"schema_version": MANIFEST_VERSION, "model_id": "synthetic-template-weights",
        "model_frozen_at": "2026-10-08T00:00:00Z", "contest_id": "synthetic-contest", "contest_type": "single_entry",
        "contest_entrant_count": 4, "observed_field_scope": "complete_contest_field",
        "evidence_scope": "synthetic", "forecast_source_ids": ["forecast"], "observed_source_ids": ["observed"],
        "training_blocks": [{"block_id": "week4", "through_at": "2026-10-01T00:00:00Z", "source_ids": ["earlier"]}],
        "tuning_blocks": [], "evaluation_block": {"block_id": "week6", "starts_at": "2026-10-11T17:00:00Z",
            "ends_at": "2026-10-11T22:00:00Z"},
        "independence_attestations": {"no_evaluation_outcomes_in_training": True,
            "no_evaluation_outcomes_in_tuning": True, "no_evaluation_outcomes_in_forecast": True}}
    return {"context": context, "pool": pool, "generated_entries": [entry("a", first, 3), entry("b", second, 1)],
        "observed_entries": [entry("c", first, 1), entry("d", second, 3)], "manifest": manifest, "sources": sources}


def test_entry_weighted_marginals_pairs_stack_salary_and_duplicates_are_exact():
    report = evaluate_field_frequencies(**fixture())
    assert report["coverage"] == {"evaluation_blocks": 1, "generated_entries": 4, "observed_entries": 4,
        "contest_entrant_count": 4, "observed_field_scope": "complete_contest_field", "observed_contest_fraction": 1,
        "generated_unique_constructions": 2, "observed_unique_constructions": 2, "player_dimensions": 11,
        "active_pair_dimensions": 44, "legal_rosters_checked": 4}
    players = {row["player_id"]: row for row in report["players"]["rows"]}
    assert players["wr2"]["generated_fraction"] == .75
    assert players["wr2"]["observed_fraction"] == .25
    assert players["wr4"]["absolute_error_percentage_points"] == 50
    assert players["unused"]["observed_fraction"] == 0
    assert report["players"]["mean_absolute_error_percentage_points"] == pytest.approx(100 / 11)
    assert report["pairs"]["mean_absolute_error_percentage_points_over_active_pairs"] == pytest.approx(800 / 44)
    assert report["qb_wr_te_attachments"]["total_variation"] == .5
    assert report["opposing_offensive_players"]["rows"] == [{"value": 2, "generated_count": 4,
        "observed_count": 4, "generated_fraction": 1, "observed_fraction": 1}]
    assert report["salary"]["generated_mean"] == 45250
    assert report["salary"]["observed_mean"] == 45750
    assert report["salary"]["max_cdf_difference"] == .5
    assert report["duplicates"]["generated_excess_fraction"] == .5
    assert report["duplicates"]["observed_entries_in_repeated_constructions_fraction"] == .75
    assert not report["capabilities"]["calibrated_field"]
    assert not report["capabilities"]["expected_payout"]
    assert not report["capabilities"]["holdout_independence_verified"]
    assert report["rights"]["redistribution"] is False
    assert report["sources"][0]["rights"]["training"] is None
    assert "player_ids" not in report["manifest"]


def test_duplicate_rows_and_different_sample_size_do_not_drop_multiplicity():
    data = fixture()
    data["generated_entries"] = [deepcopy(data["generated_entries"][0]) for _ in range(2)]
    for index, row in enumerate(data["generated_entries"]):
        row.update(lineup_id=f"duplicate-{index}", multiplicity=1)
    report = evaluate_field_frequencies(**data)
    assert report["coverage"]["generated_entries"] == 2
    assert report["coverage"]["generated_unique_constructions"] == 1
    assert report["duplicates"]["generated_excess_fraction"] == .5
    assert report["duplicates"]["generated_entries_in_repeated_constructions_fraction"] == 1
    assert report["coverage"]["observed_entries"] == 4
    assert report["salary"]["max_cdf_difference"] == .75


@pytest.mark.parametrize("mutate,match", [
    (lambda d: d["manifest"]["training_blocks"][0].update(block_id="week6"), "disjoint"),
    (lambda d: d["manifest"]["tuning_blocks"].append(deepcopy(d["manifest"]["training_blocks"][0])), "disjoint"),
    (lambda d: d["manifest"].update(model_frozen_at="2026-10-11T17:00:00Z"), "Freeze"),
    (lambda d: d["manifest"]["training_blocks"][0].update(through_at="2026-10-10T00:00:00Z"), "before.*freeze"),
    (lambda d: d["sources"][1].update(published_at="2026-10-09T00:00:00Z", known_at="2026-10-09T00:00:00Z"), "precede.*freeze"),
    (lambda d: d["sources"][2].update(published_at="2026-10-10T00:00:00Z", known_at="2026-10-10T00:00:00Z"), "after.*ends"),
    (lambda d: d["sources"][2].update(content_sha256=d["sources"][0]["content_sha256"]), "hashes overlap"),
    (lambda d: d["manifest"]["training_blocks"][0].update(source_ids=["earlier", "observed"]), "cannot also"),
    (lambda d: d["manifest"]["independence_attestations"].update(no_evaluation_outcomes_in_tuning=False), "attestation"),
    (lambda d: d["sources"][0]["rights"].update(personal_analysis=None), "personal-analysis"),
    (lambda d: d["sources"][2]["period"].update(start_week=7, end_week=7), "period"),
    (lambda d: d["sources"][2].update(evidence_scope="retrospective"), "relabeled"),
    (lambda d: d["manifest"].update(calibrated=True), "unsupported"),
    (lambda d: d["manifest"].update(observed_source_ids=["missing"]), "receipt"),
    (lambda d: d["manifest"].update(evidence_scope=[]), "evidence"),
    (lambda d: d["manifest"].update(observed_field_scope={}), "whole contest"),
    (lambda d: d["sources"][0].update(verified=True), "unsupported"),
    (lambda d: d["sources"][0]["rights"].update(sell=True), "unsupported"),
    (lambda d: d["sources"][0]["period"].update(unknown=True), "unsupported"),
])
def test_holdout_leakage_rights_and_missing_receipts_fail_closed(mutate, match):
    data = fixture()
    mutate(data)
    with pytest.raises(ValueError, match=match):
        evaluate_field_frequencies(**data)


@pytest.mark.parametrize("mutate", [
    lambda d: d["observed_entries"][0]["player_ids"].pop(),
    lambda d: d["observed_entries"][0]["player_ids"].__setitem__(0, "unknown"),
    lambda d: d["observed_entries"][0].update(multiplicity=0),
    lambda d: d["observed_entries"][0].update(multiplicity=True),
    lambda d: d["observed_entries"][0].update(multiplicity=1.5),
    lambda d: d["observed_entries"][0].update(multiplicity=1000001),
    lambda d: d["pool"][0].update(salary=20000),
])
def test_invalid_counted_rosters_cannot_enter_the_diagnostic(mutate):
    data = fixture()
    mutate(data)
    with pytest.raises(ValueError):
        evaluate_field_frequencies(**data)


def test_exact_normalized_inputs_are_reproducible_and_unmutated():
    data = fixture()
    before = deepcopy(data)
    first = evaluate_field_frequencies(**data)
    second = evaluate_field_frequencies(**data)
    assert data == before
    assert first == second
    changed = deepcopy(data)
    changed["observed_entries"][0]["multiplicity"] += 1
    changed["manifest"]["contest_entrant_count"] += 1
    assert evaluate_field_frequencies(**changed)["input_content_id"] != first["input_content_id"]


def test_partial_observed_field_is_declared_and_never_scaled_to_full_contest():
    data = fixture()
    data["manifest"].update(contest_entrant_count=10000, observed_field_scope="partial_observed_sample")
    report = evaluate_field_frequencies(**data)
    assert report["coverage"]["observed_entries"] == 4
    assert report["coverage"]["observed_contest_fraction"] == .0004
    assert not report["capabilities"]["large_field_rank_probabilities"]
    data["manifest"]["observed_field_scope"] = "complete_contest_field"
    with pytest.raises(ValueError, match="counts do not match"):
        evaluate_field_frequencies(**data)


def test_observations_cannot_exceed_the_declared_actual_contest_count():
    data = fixture()
    data["manifest"].update(contest_entrant_count=3, observed_field_scope="partial_observed_sample")
    with pytest.raises(ValueError, match="counts do not match"):
        evaluate_field_frequencies(**data)


def test_manifest_times_compare_utc_instants():
    data = fixture()
    data["manifest"]["model_frozen_at"] = "2026-10-08T01:00:00+02:00"
    assert evaluate_field_frequencies(**data)["capabilities"]["chronological_declarations_checked"]
    data["sources"][1].update(published_at="2026-10-07T20:00:00-04:00", known_at="2026-10-07T20:00:00-04:00")
    with pytest.raises(ValueError, match="precede.*freeze"):
        evaluate_field_frequencies(**data)


def test_report_does_not_depend_on_individual_entry_ids():
    data = fixture()
    first = evaluate_field_frequencies(**data)
    for row in data["observed_entries"]:
        row["lineup_id"] = "private-" + row["lineup_id"]
    second = evaluate_field_frequencies(**data)
    assert first["players"] == second["players"]
    assert first["duplicates"] == second["duplicates"]
    assert "private-" not in json.dumps(second)


def test_cli_runs_complete_declared_fixture_and_rejects_duplicate_keys(tmp_path):
    input_path, output_path = tmp_path / "input.json", tmp_path / "output.json"
    input_path.write_text(json.dumps(fixture()), encoding="utf-8")
    result = subprocess.run([sys.executable, "-m", "src.analytics.dfs_contest_field_eval", "--input", str(input_path),
        "--output", str(output_path)], cwd=Path(__file__).parents[1], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    report = json.loads(output_path.read_text(encoding="utf-8"))
    assert report["coverage"]["observed_entries"] == 4
    original_output = output_path.read_bytes()
    input_path.write_text('{"context":{},"context":{}}', encoding="utf-8")
    result = subprocess.run([sys.executable, "-m", "src.analytics.dfs_contest_field_eval", "--input", str(input_path),
        "--output", str(output_path)], cwd=Path(__file__).parents[1], capture_output=True, text=True, check=False)
    assert result.returncode != 0
    assert "duplicate object keys" in result.stderr
    assert output_path.read_bytes() == original_output


def test_exact_field_size_sensitivity_preserves_same_games_and_uses_every_entry():
    from test_dfs_contest_research import fixture as replay_fixture, NOW
    from src.products.dfs_shared_outcomes import prepare_scenario_bank
    from src.products.dfs_contest_research import prepare_contest_research, evaluate_contest_research
    raw, pool, own, field, payout = replay_fixture()
    for game in raw["games"]:
        for profile in game["profiles"]:
            profile["events"] = []
    bank = prepare_scenario_bank(raw, context=raw["context"], pool=pool, now=NOW)
    results = []
    for entrants in (10, 101, 100000):
        selected_field, selected_payout = deepcopy(field), deepcopy(payout)
        selected_field["contest"]["entrant_count"] = selected_payout["entrant_count"] = entrants
        prepared = prepare_contest_research(bank, selected_field, selected_payout)
        result = evaluate_contest_research(bank, prepared, own, seed=41, draw_count=32, top_k=1)
        results.append(result)
        gross = result["assumptions"][0]["gross"]["mean_cents"]
        net = result["assumptions"][0]["net"]["mean_cents"]
        assert Fraction(int(gross["numerator"]), int(gross["denominator"])) == Fraction(34000, entrants)
        assert Fraction(int(net["numerator"]), int(net["denominator"])) == Fraction(34000, entrants) - 100
        assert result["opponent_entry_count"] == entrants - 2
        assert result["contest"]["entrant_count"] == entrants
        assert result["stream_manifest"]["full_opponent_count"]
        assert not result["capabilities"]["expected_payout"]
    assert len({row["contest_research_id"] for row in results}) == 3
    assert len({row["stream_manifest"]["game_draw_content_id"] for row in results}) == 1
