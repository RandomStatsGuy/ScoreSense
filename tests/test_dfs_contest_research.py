"""Synthetic supplied fields test conditional replay, never calibration or EV."""
from copy import deepcopy
from fractions import Fraction
import json

import pytest

from test_dfs_shared_outcomes import fixture as shared_fixture, NOW
from test_dfs_contest_field import fixture as field_fixture
from src.products.dfs_shared_outcomes import prepare_scenario_bank, evaluate_shared_outcomes
from src.products.dfs_contest_payouts import SCHEMA_VERSION as PAYOUT_VERSION
from src.products.dfs_contest_research import (
    CAPABILITIES, SEMANTICS, prepare_contest_research, contest_research_summary,
    evaluate_contest_research,
)


def fixture():
    """Return bank raw, pool, own lineups, field raw, payout raw; all synthetic."""
    bank, pool, lineups = shared_fixture()
    field, _, _, _ = field_fixture()
    field["context"] = deepcopy(bank["context"])
    field["contest"]["entrant_count"] = 101
    for scenario in field["scenarios"]:
        scenario["ownership"] = [{"player_id": "buf-qb", "projected_fraction": None},
                                 {"player_id": "mia-wr2", "projected_fraction": .2}]
        for index, row in enumerate(scenario["templates"]):
            row["player_ids"] = deepcopy(lineups[int(index == 2)]["player_ids"])
    source = field["sources"][0]
    payout = {"schema_version": PAYOUT_VERSION, "contest_id": field["contest"]["contest_id"],
              "entrant_count": field["contest"]["entrant_count"], "currency": "USD", "entry_fee_cents": 50,
              "paid_places": 3, "payout_tiers": [
                  {"start_rank": rank, "end_rank": rank, "prize_cents": prize}
                  for rank, prize in enumerate((10000, 5000, 2000), 1)],
              "unpaid_ranks": "zero", "noncash_prizes": [],
              "tie_policy": {"cash_split": "occupied_rank_mean", "rounding": "exact_fraction",
                  "source": {"source_uri": source["uri"], "content_sha256": source["content_sha256"],
                             "as_of": "2026-10-12T12:00:00Z"}}}
    return bank, pool, lineups, field, payout


def prepared():
    raw, pool, lineups, field, payout = fixture()
    bank = prepare_scenario_bank(raw, context=raw["context"], pool=pool, now=NOW)
    return bank, prepare_contest_research(bank, field, payout), lineups


def money(value):
    return Fraction(int(value["numerator"]), int(value["denominator"]))


def test_common_game_draws_match_the_existing_shared_replay_exactly():
    bank, research, lineups = prepared()
    result = evaluate_contest_research(bank, research, lineups, seed=19, draw_count=64, top_k=3)
    shared = evaluate_shared_outcomes(bank, lineups, seed=19, draw_count=64, purpose="evaluation")
    assert result["stream_manifest"]["game_draw_content_id"] == shared["stream_manifest"]["draw_content_id"]
    assert result["stream_manifest"]["game_stream_id"] == shared["stream_manifest"]["streams"]["evaluation"]
    assert result["own_entry_count"] == 2
    assert result["opponent_entry_count"] == 99
    assert result["stream_manifest"]["full_opponent_count"] is True
    assert result["capabilities"] == CAPABILITIES
    assert result["semantics"] == SEMANTICS
    assert all(result["capabilities"][key] is False for key in
        ("expected_payout", "forward_forecast", "ownership_calibrated", "joint_outcomes_calibrated",
         "portfolio_selection", "platform_settlement_verified", "untouched_evaluation_verified"))
    for assumption in result["assumptions"]:
        assert money(assumption["fees_cents"]) == 100
        assert money(assumption["gross"]["mean_cents"]) - money(assumption["net"]["mean_cents"]) == 100
        assert sum(money(row["net"]["mean_cents"]) for row in assumption["lineups"]) == money(assumption["net"]["mean_cents"])
    json.dumps(result, allow_nan=False)


def test_zero_event_ties_match_joint_own_entry_prize_pool_oracle():
    raw, pool, lineups, field, payout = fixture()
    for game in raw["games"]:
        for profile in game["profiles"]:
            profile["events"] = []
    bank = prepare_scenario_bank(raw, context=raw["context"], pool=pool, now=NOW)
    research = prepare_contest_research(bank, field, payout)
    result = evaluate_contest_research(bank, research, lineups, seed=1, draw_count=32, top_k=1)
    values = result["assumptions"][0]
    expected_gross, expected_net = Fraction(34000, 101), Fraction(23900, 101)
    for key in ("mean_cents", "p10_cents", "p50_cents", "p90_cents", "min_cents", "max_cents"):
        assert money(values["gross"][key]) == expected_gross
        assert money(values["net"][key]) == expected_net
    assert values["net"]["replay_standard_error_cents"] == 0
    assert values["sampled_finish_fractions"]["first_place_tie"] == 1
    assert values["sampled_finish_fractions"]["sole_first"] == 0
    assert values["sampled_finish_fractions"]["top_k"] == 1
    assert values["sampled_finish_fractions"]["cash"] == 1
    assert values["sampled_finish_fractions"]["net_positive"] == 1
    for row in values["lineups"]:
        assert money(row["net"]["mean_cents"]) == Fraction(11950, 101)


def test_sensitivity_replay_is_deterministic_and_never_changes_game_performance():
    raw, pool, lineups, field, payout = fixture()
    alternative = deepcopy(field["scenarios"][0])
    alternative.update(scenario_id="late-news", injury_assumption="supplied correlated selection response")
    alternative["templates"][2]["weight"] = 20
    alternative["ownership"] = [{"player_id": p["player_id"], "projected_fraction": .75} for p in pool]
    field["scenarios"].append(alternative)
    bank = prepare_scenario_bank(raw, context=raw["context"], pool=pool, now=NOW)
    research = prepare_contest_research(bank, field, payout)
    first = evaluate_contest_research(bank, research, lineups, seed=42, draw_count=64, top_k=5)
    repeated = evaluate_contest_research(bank, research, lineups, seed=42, draw_count=64, top_k=5)
    assert first["assumptions"] == repeated["assumptions"]
    assert first["stream_manifest"] == repeated["stream_manifest"]
    assert len(first["assumptions"]) == 2
    assert len({r["field_draw_content_id"] for r in first["assumptions"]}) == 2
    shared = evaluate_shared_outcomes(bank, lineups, seed=42, draw_count=64, purpose="evaluation")
    assert first["stream_manifest"]["game_draw_content_id"] == shared["stream_manifest"]["draw_content_id"]
    field["scenarios"][0]["ownership"] = [{"player_id": p["player_id"], "projected_fraction": 0} for p in pool]
    changed = evaluate_contest_research(bank, prepare_contest_research(bank, field, payout), lineups,
                                       seed=42, draw_count=64, top_k=5)
    assert changed["bank_id"] == first["bank_id"]
    assert changed["stream_manifest"]["game_draw_content_id"] == first["stream_manifest"]["game_draw_content_id"]


def test_research_preview_omits_raw_game_and_field_rosters_and_detaches_contract():
    bank, research, _ = prepared()
    summary = contest_research_summary(research)
    assert summary["bank_id"] == bank["content_id"]
    assert summary["field"]["contest"]["entrant_count"] == 101
    assert "pool" not in summary["field"]
    assert "templates" not in summary["field"]["scenarios"][0]
    assert "ownership" not in summary["field"]["scenarios"][0]
    assert summary["field"]["sources"][0]["rights"]["redistribution"] is False
    summary["payout_contract"]["payout_tiers"][0]["prize_cents"] = 1
    assert research["payout_contract"]["payout_tiers"][0]["prize_cents"] == 10000


@pytest.mark.parametrize("mutation", ["contest-id", "entrant-count", "decision", "slate", "source-uri", "source-hash", "future-payout", "missing-payout"])
def test_research_requires_same_exact_contest_context_and_admitted_payout_receipt(mutation):
    raw, pool, _, field, payout = fixture()
    bank = prepare_scenario_bank(raw, context=raw["context"], pool=pool, now=NOW)
    if mutation == "contest-id": payout["contest_id"] = "other-contest"
    elif mutation == "entrant-count": payout["entrant_count"] = 100
    elif mutation == "decision": field["decision_at"] = "2026-10-12T11:00:00Z"
    elif mutation == "slate": field["context"]["slate_id"] = "different-slate"
    elif mutation == "source-uri": payout["tie_policy"]["source"]["source_uri"] = "fixture:unadmitted"
    elif mutation == "source-hash": payout["tie_policy"]["source"]["content_sha256"] = "b" * 64
    elif mutation == "future-payout": payout["tie_policy"]["source"]["as_of"] = "2026-10-13T12:00:00Z"
    elif mutation == "missing-payout": payout = None
    with pytest.raises(ValueError):
        prepare_contest_research(bank, field, payout)


@pytest.mark.parametrize("mutation", ["bank", "package-id", "package-bank-id", "payout", "field", "field-empty", "field-count"])
def test_changed_prepared_inputs_are_rejected_before_any_claim(mutation):
    bank, research, lineups = prepared()
    if mutation == "bank": bank["games"][0]["profiles"][0]["weight"] = 10
    elif mutation == "package-id": research["content_id"] = "a" * 64
    elif mutation == "package-bank-id": research["bank_id"] = "a" * 64
    elif mutation == "payout": research["payout_contract"]["entry_fee_cents"] = 1
    elif mutation == "field": research["field"]["scenarios"][0]["templates"][0]["probability"] = .99
    elif mutation == "field-empty": research["field"]["scenarios"] = []
    elif mutation == "field-count": research["field"]["contest"]["entrant_count"] = 1
    with pytest.raises(ValueError, match="changed|snapshot|selected|validated"):
        evaluate_contest_research(bank, research, lineups, draw_count=32)


@pytest.mark.parametrize("controls", [{"seed": True}, {"seed": -1}, {"seed": 2**31},
    {"draw_count": True}, {"draw_count": 31}, {"draw_count": 257}, {"top_k": True},
    {"top_k": 0}, {"top_k": 102}])
def test_replay_controls_are_bounded_and_never_silently_coerced(controls):
    bank, research, lineups = prepared()
    with pytest.raises(ValueError):
        evaluate_contest_research(bank, research, lineups, **controls)


def test_contest_count_must_leave_at_least_one_actual_opponent():
    raw, pool, lineups, field, payout = fixture()
    field["contest"]["entrant_count"] = payout["entrant_count"] = 2
    payout["paid_places"] = 2
    payout["payout_tiers"] = payout["payout_tiers"][:2]
    bank = prepare_scenario_bank(raw, context=raw["context"], pool=pool, now=NOW)
    research = prepare_contest_research(bank, field, payout)
    with pytest.raises(ValueError, match="at least one opponent"):
        evaluate_contest_research(bank, research, lineups, draw_count=32, top_k=2)


def test_finish_fractions_only_contain_outcome_events_not_policy_flags():
    bank, research, lineups = prepared()
    result = evaluate_contest_research(bank, research, lineups, draw_count=32)
    assert set(result["assumptions"][0]["sampled_finish_fractions"]) == {
        "first_place_finish", "first_place_tie", "sole_first", "top_k", "cash", "net_positive"}
