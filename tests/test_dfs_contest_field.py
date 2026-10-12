"""Synthetic legal roster assumptions test mechanics, never field calibration."""
from copy import deepcopy
import hashlib
from time import perf_counter

import pytest

from src.products.dfs_contest_field import (
    CAPABILITIES, SCHEMA_VERSION, field_summary, prepare_contest_field,
    iter_field_draws, sample_field_counts, sample_field_draws, validate_field_lineups,
)

CONTEXT = {"site": "draftkings", "sport": "NFL", "format": "classic", "season": 2099,
           "week": 3, "slate_id": "synthetic-contest-field"}
NOW = "2026-10-12T23:00:00Z"


def fixture():
    positions = [("buf-qb", "BUF", "QB"), ("mia-qb", "MIA", "QB"),
                 ("buf-rb", "BUF", "RB"), ("mia-rb", "MIA", "RB"),
                 ("buf-wr1", "BUF", "WR"), ("buf-wr2", "BUF", "WR"),
                 ("mia-wr1", "MIA", "WR"), ("mia-wr2", "MIA", "WR"),
                 ("buf-te", "BUF", "TE"), ("kc-te", "KC", "TE"),
                 ("buf-dst", "BUF", "DST"), ("kc-dst", "KC", "DST")]
    pool = [{"player_id": pid, "game_id": "kc-lv" if team == "KC" else "buf-mia", "team": team,
             "opponent": {"BUF": "MIA", "MIA": "BUF", "KC": "LV"}[team], "position": pos, "salary": 5000}
            for pid, team, pos in positions]
    a = ["buf-qb", "buf-rb", "mia-rb", "buf-wr1", "buf-wr2", "mia-wr1", "kc-te", "buf-te", "buf-dst"]
    b = ["mia-qb", "buf-rb", "mia-rb", "buf-wr1", "mia-wr2", "mia-wr1", "kc-te", "buf-te", "kc-dst"]
    source = {"source_id": "synthetic-rosters", "provider": "explicit synthetic test fixture", "uri": "fixture:contest-rosters",
              "content_sha256": hashlib.sha256(b"synthetic whole rosters").hexdigest(),
              "period": {"season": 2026, "start_week": 1, "end_week": 2},
              "published_at": "2026-10-10T00:00:00Z", "known_at": "2026-10-10T00:00:00Z",
              "retrieved_at": "2026-10-12T00:00:00Z", "definition": "declared synthetic legal whole rosters",
              "evidence_scope": "synthetic", "rights": {"personal_analysis": True, "hosted_ingestion": True,
              "display": True, "redistribution": False, "training": False, "external_model": False}}
    scenario = {"scenario_id": "baseline", "provider": "synthetic test provider", "injury_assumption": "all participants available",
                "known_at": "2026-10-11T00:00:00Z", "source_ids": ["synthetic-rosters"], "split_id": "synthetic-construction-split",
                "ownership_units": "fraction", "ownership_contest_type": "mini_max",
                "ownership": [{"player_id": "buf-qb", "projected_fraction": None}, {"player_id": "mia-qb", "projected_fraction": .2}],
                "templates": [{"template_id": "a", "player_ids": a, "weight": 1},
                              {"template_id": "a-repeat", "player_ids": list(reversed(a)), "weight": 1},
                              {"template_id": "b", "player_ids": b, "weight": 3}]}
    payload = {"schema_version": SCHEMA_VERSION, "mode": "declared_legal_lineup_templates", "context": deepcopy(CONTEXT),
               "contest": {"contest_id": "synthetic-contest", "contest_type": "mini_max", "entrant_count": 100000},
               "decision_at": "2026-10-12T12:00:00Z", "evidence_scope": "synthetic", "sources": [source], "scenarios": [scenario]}
    return payload, pool, a, b


def prepared():
    payload, pool, a, b = fixture()
    return prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW), a, b


@pytest.mark.parametrize("sign", [1, -1], ids=["positive", "negative"])
@pytest.mark.parametrize("field", ["weight", "ownership"])
def test_oversized_json_integers_fail_as_validation_errors(field, sign):
    payload, pool, _, _ = fixture()
    scenario = payload["scenarios"][0]
    value = sign * 10**1000
    if field == "weight":
        scenario["templates"][0]["weight"] = value
        message = "finite positive weight"
    else:
        scenario["ownership"][0]["projected_fraction"] = value
        message = "explicit fraction"
    with pytest.raises(ValueError, match=message):
        prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)


def test_correlated_whole_rosters_retain_duplicate_weight_and_explicit_unknown_ownership():
    field, a, b = prepared()
    scenario = field["scenarios"][0]
    assert scenario["declared_template_count"] == 3
    assert scenario["unique_template_count"] == 2
    rows = {tuple(row["player_ids"]): row for row in scenario["templates"]}
    assert rows[tuple(sorted(a))]["weight"] == 2
    assert rows[tuple(sorted(a))]["probability"] == .4
    assert rows[tuple(sorted(a))]["declared_template_ids"] == ["a", "a-repeat"]
    assert rows[tuple(sorted(b))]["probability"] == .6
    assert scenario["ownership"][0]["projected_fraction"] is None
    assert scenario["known_projected_ownership_count"] == 1
    assert field["capabilities"] == CAPABILITIES
    assert not field["capabilities"]["fitted_opponent_generator"]
    assert not field["capabilities"]["calibrated_extreme_ranks"]
    consistency = scenario["ownership_consistency"]
    assert consistency["known_players"] == 1
    assert consistency["missing_players"] == 11
    assert consistency["mean_absolute_fraction_gap"] == pytest.approx(.4)
    assert consistency["maximum_absolute_fraction_gap"] == pytest.approx(.4)
    assert consistency["pool_players_with_template_support"] == 12


def test_full_large_field_is_sampled_not_scaled_and_exact_duplicates_survive():
    field, a, _ = prepared()
    result = sample_field_counts(field, 99998, scenario_id="baseline", seed=1742)
    assert sum(row["multiplicity"] for row in result["template_counts"]) == 99998
    assert result["full_field_represented"]
    assert len(result["template_counts"]) == 2
    assert all(row["multiplicity"] > 10000 for row in result["template_counts"])
    count = next(row["multiplicity"] for row in result["template_counts"] if row["player_ids"] == sorted(a))
    assert abs(count / 99998 - .4) < .01
    assert result["finite_template_support_not_calibrated"]


def test_whole_roster_sampling_preserves_conditional_stacks_and_salary_without_ownership_products():
    field, _, _ = prepared()
    sampled = sample_field_counts(field, 99998, scenario_id="baseline", seed=18)
    marginal = {row["player_id"]: 0 for row in field["pool"]}
    for row in sampled["template_counts"]:
        assert sum(next(p["salary"] for p in field["pool"] if p["player_id"] == pid) for pid in row["player_ids"]) == 45000
        for pid in row["player_ids"]:
            marginal[pid] += row["multiplicity"]
    assert marginal["buf-qb"] == marginal["buf-wr2"] == marginal["buf-dst"]
    assert marginal["mia-qb"] == marginal["mia-wr2"] == marginal["kc-dst"]
    assert marginal["buf-qb"] + marginal["mia-qb"] == 99998
    assert marginal["buf-rb"] == 99998


def test_streams_are_reproducible_separate_by_purpose_draw_assumption_and_seed():
    payload, pool, _, _ = fixture()
    alternate = deepcopy(payload["scenarios"][0])
    alternate["scenario_id"] = "late-news"
    alternate["injury_assumption"] = "declared correlated ownership response"
    alternate["templates"][0]["weight"] = 10
    payload["scenarios"].append(alternate)
    field = prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)
    a = sample_field_counts(field, 99998, scenario_id="baseline", seed=3)
    assert a == sample_field_counts(field, 99998, scenario_id="baseline", seed=3)
    cases = [dict(scenario_id="baseline", seed=4), dict(scenario_id="baseline", seed=3, draw_index=1),
             dict(scenario_id="baseline", seed=3, purpose="generation"), dict(scenario_id="late-news", seed=3)]
    assert len({a["stream_id"], *(sample_field_counts(field, 99998, **case)["stream_id"] for case in cases)}) == 5
    assert a["rng"]["algorithm"] == "PCG64"


def test_batch_sampler_matches_individual_draws_and_checks_snapshot_before_sampling():
    field, _, _ = prepared()
    batch = sample_field_draws(field, 99998, scenario_id="baseline", seed=22, draw_count=16)
    assert batch == [sample_field_counts(field, 99998, scenario_id="baseline", seed=22, draw_index=i) for i in range(16)]
    with pytest.raises(ValueError, match="draw count"):
        sample_field_draws(field, 99998, scenario_id="baseline", draw_count=257)
    field["contest"]["entrant_count"] = 1
    with pytest.raises(ValueError, match="changed"):
        sample_field_draws(field, 1, scenario_id="baseline")


def test_lazy_draw_iterator_freezes_detached_templates_before_caller_mutation():
    field, _, _ = prepared()
    expected = sample_field_draws(field, 99998, scenario_id="baseline", seed=82, draw_count=4)
    draws = iter_field_draws(field, 99998, scenario_id="baseline", seed=82, draw_count=4)
    field["scenarios"][0]["templates"][0]["player_ids"][0] = "changed-by-caller"
    field["contest"]["entrant_count"] = 1
    assert list(draws) == expected
    with pytest.raises(ValueError, match="changed"):
        iter_field_draws(field, 1, scenario_id="baseline")


def test_ownership_is_separate_from_football_and_never_drives_marginal_products():
    field, _, _ = prepared()
    payload, pool, _, _ = fixture()
    payload["scenarios"][0]["ownership"] = [{"player_id": p["player_id"], "projected_fraction": 0} for p in pool]
    changed = prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)
    assert changed["scenarios"][0]["templates"] == field["scenarios"][0]["templates"]
    assert changed["pool"] == field["pool"]
    assert all("score" not in row for row in changed["pool"])
    assert not changed["capabilities"]["contest_specific_ownership_verified"]


def test_field_summary_omits_raw_rosters_and_player_ownership_and_detaches_receipts():
    field, _, _ = prepared()
    summary = field_summary(field)
    assert "pool" not in summary
    assert "templates" not in summary["scenarios"][0]
    assert "ownership" not in summary["scenarios"][0]
    assert summary["sources"][0]["rights"]["redistribution"] is False
    summary["sources"][0]["rights"]["redistribution"] = True
    assert field["sources"][0]["rights"]["redistribution"] is False


def test_prepared_field_detaches_inputs_and_rejects_content_mutation():
    payload, pool, _, _ = fixture()
    field = prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)
    pool[0]["salary"] = 1
    payload["scenarios"][0]["templates"][0]["weight"] = 100
    assert field["pool"][0]["salary"] == 5000
    field["scenarios"][0]["templates"][0]["probability"] = .99
    with pytest.raises(ValueError, match="changed"):
        sample_field_counts(field, 100, scenario_id="baseline")


@pytest.mark.parametrize("case", ["context", "mode", "entrants-zero", "entrants-large", "entrants-bool", "type",
    "cutoff", "source-future", "source-after-cutoff", "source-missing-time", "rights", "source-scope", "source-key", "scenario-future", "scenario-before-source",
    "scenario-source", "units", "ownership-type", "ownership-percent", "ownership-bool", "ownership-nan", "ownership-duplicate", "ownership-foreign",
    "negative-weight", "nan-weight", "unknown-control", "duplicate-scenario", "duplicate-template-id", "foreign-player", "repeat-player", "wrong-composition",
    "one-game", "over-salary", "game-conflict"])
def test_invalid_fields_reject_atomically(case):
    payload, pool, a, b = fixture()
    raw = payload["scenarios"][0]
    if case == "context": payload["context"]["slate_id"] = "other"
    elif case == "mode": payload["mode"] = "fitted_calibrated"
    elif case == "entrants-zero": payload["contest"]["entrant_count"] = 0
    elif case == "entrants-large": payload["contest"]["entrant_count"] = 100001
    elif case == "entrants-bool": payload["contest"]["entrant_count"] = True
    elif case == "type": payload["contest"]["contest_type"] = "showdown"
    elif case == "cutoff": payload["decision_at"] = "2099-01-01T00:00:00Z"
    elif case == "source-future": payload["sources"][0]["retrieved_at"] = "2099-01-01T00:00:00Z"
    elif case == "source-after-cutoff": payload["sources"][0]["known_at"] = "2026-10-12T13:00:00Z"
    elif case == "source-missing-time": payload["sources"][0]["known_at"] = None
    elif case == "rights": payload["sources"][0]["rights"]["hosted_ingestion"] = None
    elif case == "source-scope": payload["sources"][0]["evidence_scope"] = "retrospective"
    elif case == "source-key": payload["sources"][0]["unrecognized_right"] = True
    elif case == "scenario-future": raw["known_at"] = "2026-10-12T13:00:00Z"
    elif case == "scenario-before-source": raw["known_at"] = "2026-10-09T00:00:00Z"
    elif case == "scenario-source": raw["source_ids"] = ["unknown"]
    elif case == "units": raw["ownership_units"] = "percent"
    elif case == "ownership-type": raw["ownership_contest_type"] = "single_entry"
    elif case == "ownership-percent": raw["ownership"][1]["projected_fraction"] = 20
    elif case == "ownership-bool": raw["ownership"][1]["projected_fraction"] = True
    elif case == "ownership-nan": raw["ownership"][1]["projected_fraction"] = float("nan")
    elif case == "ownership-duplicate": raw["ownership"].append(deepcopy(raw["ownership"][0]))
    elif case == "ownership-foreign": raw["ownership"][0]["player_id"] = "foreign"
    elif case == "negative-weight": raw["templates"][0]["weight"] = -1
    elif case == "nan-weight": raw["templates"][0]["weight"] = float("nan")
    elif case == "unknown-control": raw["templates"][0]["captain"] = True
    elif case == "duplicate-scenario": payload["scenarios"].append(deepcopy(raw))
    elif case == "duplicate-template-id": raw["templates"][1]["template_id"] = "a"
    elif case == "foreign-player": raw["templates"][0]["player_ids"][0] = "foreign"
    elif case == "repeat-player": raw["templates"][0]["player_ids"][0] = "buf-rb"
    elif case == "wrong-composition": raw["templates"][0]["player_ids"][0] = "mia-wr2"
    elif case == "one-game": raw["templates"][0]["player_ids"][6] = "mia-wr2"
    elif case == "over-salary": pool[0]["salary"] = 15000
    elif case == "game-conflict": pool[0]["opponent"] = "NYJ"
    with pytest.raises(ValueError):
        prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)


def test_broad_public_ownership_is_explicit_and_missing_values_remain_unknown():
    payload, pool, _, _ = fixture()
    payload["scenarios"][0]["ownership_contest_type"] = "broad_public"
    payload["scenarios"][0]["ownership"] = []
    field = prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)
    assert field_summary(field)["scenarios"][0]["ownership_contest_type"] == "broad_public"
    assert field["scenarios"][0]["ownership"] == []
    assert field["scenarios"][0]["known_projected_ownership_count"] == 0
    assert field["scenarios"][0]["ownership_consistency"]["mean_absolute_fraction_gap"] is None
    assert field["scenarios"][0]["ownership_consistency"]["maximum_absolute_fraction_gap"] is None


@pytest.mark.parametrize("kwargs", [{"opponent_entry_count": -1}, {"opponent_entry_count": 100001},
    {"opponent_entry_count": True}, {"seed": -1}, {"seed": True}, {"draw_index": 256},
    {"draw_index": True}, {"purpose": "unknown"}, {"scenario_id": "unknown"}])
def test_sampler_rejects_unbounded_or_ambiguous_controls(kwargs):
    field, _, _ = prepared()
    arguments = {"opponent_entry_count": 100, "scenario_id": "baseline", **kwargs}
    with pytest.raises(ValueError):
        sample_field_counts(field, **arguments)


def test_zero_opponents_and_single_roster_are_exact_without_small_field_approximation():
    payload, pool, a, _ = fixture()
    payload["scenarios"][0]["templates"] = payload["scenarios"][0]["templates"][:1]
    field = prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)
    empty = sample_field_counts(field, 0, scenario_id="baseline")
    full = sample_field_counts(field, 100000, scenario_id="baseline")
    assert empty["template_counts"][0]["multiplicity"] == 0
    assert full["template_counts"][0]["multiplicity"] == 100000
    assert full["template_counts"][0]["player_ids"] == sorted(a)


def test_tiny_positive_template_weights_do_not_break_multinomial_rounding():
    payload, pool, _, _ = fixture()
    payload["scenarios"][0]["templates"][0]["weight"] = 1e-300
    payload["scenarios"][0]["templates"][1]["weight"] = 1e-300
    payload["scenarios"][0]["templates"][2]["weight"] = 1000000
    field = prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)
    result = sample_field_counts(field, 99998, scenario_id="baseline", seed=18)
    assert sum(row["multiplicity"] for row in result["template_counts"]) == 99998


def test_positive_weight_that_underflows_a_probability_rejects_instead_of_disappearing():
    payload, pool, _, _ = fixture()
    payload["scenarios"][0]["templates"][0]["weight"] = 5e-324
    payload["scenarios"][0]["templates"][1]["weight"] = 5e-324
    payload["scenarios"][0]["templates"][2]["weight"] = 1000000
    with pytest.raises(ValueError, match="cannot be represented"):
        prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)


def test_archived_count_validator_preserves_identical_rosters_with_distinct_entry_ids():
    _, pool, a, _ = fixture()
    rows = [{"lineup_id": "entry-1", "player_ids": a, "multiplicity": 2},
            {"lineup_id": "entry-2", "player_ids": list(reversed(a)), "multiplicity": 3}]
    normalized = validate_field_lineups(rows, pool)
    assert len(normalized) == 2
    assert sum(row["multiplicity"] for row in normalized) == 5
    assert normalized[0]["salary"] == 45000
    assert normalized[0]["player_ids"] == normalized[1]["player_ids"]
    rows[1]["multiplicity"] = 100000
    with pytest.raises(ValueError, match="100000"):
        validate_field_lineups(rows, pool)


def test_four_fields_and_template_bound_are_enforced():
    payload, pool, _, _ = fixture()
    payload["scenarios"] = [{**deepcopy(payload["scenarios"][0]), "scenario_id": f"scenario-{i}"} for i in range(5)]
    with pytest.raises(ValueError, match="1–4"):
        prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)
    payload["scenarios"] = payload["scenarios"][:1]
    template = payload["scenarios"][0]["templates"][0]
    payload["scenarios"][0]["templates"] = [{**deepcopy(template), "template_id": f"template-{i}"} for i in range(501)]
    with pytest.raises(ValueError, match="1–500"):
        prepare_contest_field(payload, context=CONTEXT, pool=pool, now=NOW)


def test_exact_count_sampler_is_bounded_for_maximum_entrant_count():
    field, _, _ = prepared()
    started = perf_counter()
    for draw in range(256):
        result = sample_field_counts(field, 99998, scenario_id="baseline", seed=39, draw_index=draw)
        assert sum(row["multiplicity"] for row in result["template_counts"]) == 99998
    # Loose regression budget catches accidental per-opponent roster materialization.
    assert perf_counter() - started < 10
