"""Synthetic payout examples verify cash arithmetic, never contest performance."""
from copy import deepcopy
from decimal import Decimal, localcontext
from fractions import Fraction
import json
import random

import pytest

from src.products.dfs_contest_payouts import (
    MAX_ENTRANTS, SCHEMA_VERSION, evaluate_payouts, validate_payout_contract,
)


def contract(entrants=3, *, rounding="exact_fraction", fee=100, prizes=(10000, 5000, 2000)):
    return {"schema_version": SCHEMA_VERSION, "contest_id": "synthetic-cash-example",
            "entrant_count": entrants, "currency": "USD", "entry_fee_cents": fee,
            "paid_places": len(prizes), "payout_tiers": [
                {"start_rank": index, "end_rank": index, "prize_cents": value}
                for index, value in enumerate(prizes, 1)], "unpaid_ranks": "zero",
            "noncash_prizes": [], "tie_policy": {"cash_split": "occupied_rank_mean", "rounding": rounding,
                "source": {"source_uri": "fixture:synthetic-cash-tie-policy", "content_sha256": "a" * 64,
                           "as_of": "2026-10-12T12:00:00-07:00"}}}


def money(value):
    return Fraction(int(value["numerator"]), int(value["denominator"]))


def test_tie_spans_100_50_20_dollars_and_includes_both_own_entries():
    result = evaluate_payouts([{"entry_id": "own-a", "score": "100.00"},
                               {"entry_id": "own-b", "score": 100}],
                              [{"score": "1e2", "count": 1}], contract())
    assert [money(row["gross_cents"]) for row in result["per_entry"]] == [Fraction(17000, 3)] * 2
    assert result["per_entry"][0]["gross_cents"]["decimal"] is None
    assert money(result["aggregate"]["gross_cents"]) == Fraction(34000, 3)
    assert money(result["aggregate"]["fees_cents"]) == 200
    assert money(result["aggregate"]["net_cents"]) == Fraction(33400, 3)
    assert result["per_entry"][0]["own_tied_entries"] == 2
    assert result["per_entry"][0]["opponent_tied_entries"] == 1
    assert result["per_entry"][0]["rank_start"] == 1
    assert result["per_entry"][0]["rank_end"] == 3
    assert result["coverage"] == {"first_place_finish": True, "first_place_tie": True,
        "sole_first": False, "top_k": True, "top_k_cutoff": 3,
        "top_k_includes_boundary_ties": True, "cash": True, "net_positive": True}
    assert result["capabilities"]["forecast_expected_value"] is False
    assert result["capabilities"]["settlement"] is False
    assert result["capabilities"]["declared_cash_rounding"] is False


@pytest.mark.parametrize("policy,share,remainder", [("floor_cent", 5666, 2), ("half_up_cent", 5667, -1)])
def test_cash_rounding_occurs_per_tied_entry_and_discloses_remainder(policy, share, remainder):
    result = evaluate_payouts([{"entry_id": "a", "score": 20}, {"entry_id": "b", "score": 20}],
                              [{"score": 20, "count": 1}], contract(rounding=policy))
    assert money(result["per_entry"][0]["unrounded_share_cents"]) == Fraction(17000, 3)
    assert money(result["aggregate"]["gross_cents"]) == 2 * share
    assert money(result["aggregate"]["net_cents"]) == 2 * share - 200
    assert money(result["score_groups"][0]["rounding_remainder_cents"]) == remainder
    assert result["capabilities"]["declared_cash_rounding"] is True
    assert result["capabilities"]["platform_verified"] is False


def test_half_cent_rounds_up_instead_of_bankers_rounding():
    base = contract(2, rounding="half_up_cent", prizes=(1,), fee=0)
    result = evaluate_payouts([{"entry_id": "a", "score": 0}], [{"score": 0, "count": 1}], base)
    assert money(result["aggregate"]["gross_cents"]) == 1
    assert money(result["score_groups"][0]["rounding_remainder_cents"]) == -1


def test_tie_crossing_last_paid_place_includes_unpaid_ranks_and_negative_scores():
    result = evaluate_payouts([{"entry_id": "a", "score": "-1.25"}],
        [{"score": 10, "count": 1}, {"score": "-1.2500", "count": 3}],
        contract(5, fee=25, prizes=(10000, 1000)), top_k=2)
    row = result["per_entry"][0]
    assert (row["rank_start"], row["rank_end"], row["tied_entries"]) == (2, 5, 4)
    assert money(row["gross_cents"]) == 250
    assert money(row["net_cents"]) == 225
    assert result["coverage"]["top_k"] is True
    assert result["coverage"]["first_place_finish"] is False


def test_all_own_entries_change_rank_and_tie_interactions():
    result = evaluate_payouts([{"entry_id": "low", "score": 0}, {"entry_id": "high", "score": 10}],
        [{"score": 10, "count": 1}, {"score": -1, "count": 2}],
        contract(5, prizes=(100, 20, 9), fee=7))
    low, high = result["per_entry"]
    assert low["entry_id"] == "low" and low["rank_start"] == 3
    assert money(low["gross_cents"]) == 9
    assert (high["rank_start"], high["rank_end"]) == (1, 2)
    assert money(high["gross_cents"]) == 60
    assert money(result["aggregate"]["gross_cents"]) == 69
    assert money(result["aggregate"]["fees_cents"]) == 14
    assert money(result["aggregate"]["net_cents"]) == 55


def test_compressed_duplicate_rows_are_not_deduplicated_or_scaled():
    result = evaluate_payouts([{"entry_id": "a", "score": "5"}],
        [{"score": "5.0", "count": 2}, {"score": 5, "count": 3}],
        contract(6, prizes=(100,), fee=0))
    assert result["opponent_entry_count"] == 5
    assert result["per_entry"][0]["tied_entries"] == 6
    assert money(result["per_entry"][0]["gross_cents"]) == Fraction(50, 3)
    assert len(result["score_groups"]) == 1


def test_billion_entry_extreme_rank_does_not_expand_multiplicity():
    result = evaluate_payouts([{"entry_id": "last", "score": -100}],
        [{"score": 0, "count": MAX_ENTRANTS - 1}], contract(MAX_ENTRANTS, prizes=(10000,), fee=50))
    assert len(result["score_groups"]) == 2
    assert result["per_entry"][0]["rank_start"] == MAX_ENTRANTS
    assert money(result["aggregate"]["gross_cents"]) == 0
    assert money(result["aggregate"]["net_cents"]) == -50
    assert result["coverage"]["cash"] is False
    assert result["coverage"]["top_k"] is False


def test_tier_range_sum_never_enumerates_large_rank_ranges():
    base = contract(MAX_ENTRANTS, prizes=(), fee=0)
    base["paid_places"] = MAX_ENTRANTS
    base["payout_tiers"] = [{"start_rank": 1, "end_rank": MAX_ENTRANTS - 1, "prize_cents": 0},
                            {"start_rank": MAX_ENTRANTS, "end_rank": MAX_ENTRANTS, "prize_cents": 3}]
    result = evaluate_payouts([{"entry_id": "last", "score": -100}],
        [{"score": 0, "count": MAX_ENTRANTS - 1}], base, top_k=MAX_ENTRANTS)
    assert money(result["aggregate"]["gross_cents"]) == 3
    assert result["coverage"]["top_k"] is True


def test_prize_pool_larger_than_javascript_safe_integer_serializes_exactly():
    base = contract(MAX_ENTRANTS, prizes=(), fee=10**12)
    base["paid_places"] = MAX_ENTRANTS
    base["payout_tiers"] = [{"start_rank": 1, "end_rank": MAX_ENTRANTS, "prize_cents": 10**12}]
    result = evaluate_payouts([{"entry_id": str(index), "score": 0} for index in range(150)],
        [{"score": 0, "count": MAX_ENTRANTS - 150}], base)
    # The public serializer uses strings consistently, including values that
    # happen to fit today; the represented opponent prize pool can be 10**21.
    assert result["aggregate"]["gross_cents"]["numerator"] == "150000000000000"
    assert result["score_groups"][0]["prize_pool_cents"]["numerator"] == "1000000000000000000000"
    assert money(result["aggregate"]["net_cents"]) == 0
    assert all(isinstance(row["gross_cents"]["numerator"], str) for row in result["per_entry"])
    json.dumps(result, allow_nan=False)


def test_exact_score_comparison_does_not_merge_display_similar_or_float_nearby_scores():
    result = evaluate_payouts([{"entry_id": "precise", "score": "0.30000000000000004"}],
        [{"score": "0.3", "count": 1}], contract(2, prizes=(100,), fee=0))
    assert result["coverage"]["sole_first"] is True
    assert result["per_entry"][0]["tied_entries"] == 1
    numeric = evaluate_payouts([{"entry_id": "numeric", "score": 0.1 + 0.2}],
        [{"score": 0.3, "count": 1}], contract(2, prizes=(100,), fee=0))
    assert numeric["coverage"]["sole_first"] is True


def test_exact_decimal_serialization_is_independent_of_decimal_context():
    with localcontext() as ctx:
        ctx.prec = 2
        result = evaluate_payouts([{"entry_id": "a", "score": Decimal("-2.125")}],
            [{"score": Decimal("-2.1250"), "count": 3}], contract(4, prizes=(1,), fee=0))
    share = result["per_entry"][0]["gross_cents"]
    assert share["decimal"] == "0.25"
    assert result["per_entry"][0]["score"] == "-2.125"
    assert money(share) == Fraction(1, 4)


def test_known_zero_fee_and_payout_remain_zero_and_one_entry_can_be_sole_first():
    base = contract(1, fee=0, prizes=())
    result = evaluate_payouts([{"entry_id": "a", "score": 0}], [], base)
    assert result["coverage"]["sole_first"] is True
    assert result["coverage"]["first_place_tie"] is False
    assert result["coverage"]["cash"] is False
    assert result["coverage"]["net_positive"] is False
    assert result["aggregate"]["net_cents"]["decimal"] == "0"


@pytest.mark.parametrize("path,value", [
    (("entry_fee_cents",), None), (("entry_fee_cents",), True), (("currency",), "EUR"),
    (("entrant_count",), 0), (("entrant_count",), MAX_ENTRANTS + 1), (("entrant_count",), 3.0),
    (("paid_places",), None), (("payout_tiers",), None), (("unpaid_ranks",), None),
    (("noncash_prizes",), None), (("noncash_prizes",), [{"rank": 1, "award": "ticket"}]),
    (("tie_policy", "rounding"), "bankers"), (("tie_policy", "cash_split"), "best_rank"),
    (("tie_policy", "source", "content_sha256"), "bad"),
    (("tie_policy", "source", "as_of"), "2026-10-12T12:00:00"),
    (("tie_policy", "source", "source_uri"), ""),
])
def test_invalid_or_missing_payout_contract_never_defaults_to_zero(path, value):
    base = contract()
    target = base
    for name in path[:-1]:
        target = target[name]
    target[path[-1]] = value
    with pytest.raises(ValueError):
        validate_payout_contract(base)


@pytest.mark.parametrize("change", [
    lambda base: base.update(silent_control=True),
    lambda base: base["payout_tiers"][1].update(start_rank=3),
    lambda base: base["payout_tiers"][1].update(start_rank=1),
    lambda base: base["payout_tiers"].pop(),
    lambda base: base["payout_tiers"][0].update(prize_cents=-1),
    lambda base: base["payout_tiers"][0].update(prize_cents=1.2),
    lambda base: base["payout_tiers"][0].update(prize_cents=True),
    lambda base: base["tie_policy"].update(unknown_policy="ignore"),
])
def test_incomplete_ambiguous_or_unsupported_schedule_rejected(change):
    base = contract()
    change(base)
    with pytest.raises(ValueError):
        validate_payout_contract(base)


@pytest.mark.parametrize("score", [None, True, "", " 1", "NaN", "Infinity", float("nan"),
                                  float("inf"), "1e1000000", "1e-1000000", {}, "1000000000.0001"])
def test_unknown_nonfinite_and_unbounded_scores_rejected(score):
    with pytest.raises(ValueError):
        evaluate_payouts([{"entry_id": "a", "score": score}], [], contract(1, prizes=(100,)))


@pytest.mark.parametrize("own,opponents,entrants,cutoff", [
    ([], [], 1, 1),
    ([{"entry_id": "same", "score": 1}, {"entry_id": "same", "score": 2}], [], 2, 1),
    ([{"entry_id": "a", "score": 1}], [{"score": 1, "count": 0}], 1, 1),
    ([{"entry_id": "a", "score": 1}], [{"score": 1, "count": True}], 2, 1),
    ([{"entry_id": "a", "score": 1}], [{"score": 1, "count": 1}], 3, 1),
    ([{"entry_id": "a", "score": 1}], [], 1, 0),
    ([{"entry_id": "a", "score": 1}], [], 1, 2),
    ([{"entry_id": "a", "score": 1, "gross": 100}], [], 1, 1),
])
def test_invalid_field_counts_identity_and_cutoffs_rejected(own, opponents, entrants, cutoff):
    with pytest.raises(ValueError):
        evaluate_payouts(own, opponents, contract(entrants, prizes=()), top_k=cutoff)


def test_validation_is_copying_and_idempotent():
    original = contract()
    saved = deepcopy(original)
    validated = validate_payout_contract(original)
    assert original == saved
    assert validate_payout_contract(validated) == validated
    validated["payout_tiers"][0]["prize_cents"] = 1
    assert original == saved


def test_compressed_rank_math_matches_independent_expanded_oracle_across_fields():
    rng = random.Random(90210)
    for _ in range(80):
        own_values = [rng.randrange(-3, 4) for _ in range(rng.randrange(1, 8))]
        opponent_values = [rng.randrange(-3, 4) for _ in range(rng.randrange(0, 20))]
        entrants = len(own_values) + len(opponent_values)
        prizes = [rng.randrange(0, 2000) for _ in range(rng.randrange(0, entrants + 1))]
        fee = rng.randrange(0, 100)
        expanded = own_values + opponent_values
        raw = contract(entrants, prizes=prizes, fee=fee)
        result = evaluate_payouts([{"entry_id": str(index), "score": value} for index, value in enumerate(own_values)],
            [{"score": value, "count": opponent_values.count(value)} for value in set(opponent_values)], raw)
        expected = []
        for value in own_values:
            above = sum(other > value for other in expanded)
            tied = expanded.count(value)
            prize_pool = sum(prizes[above:above + tied])
            expected.append(Fraction(prize_pool, tied))
        assert [money(row["gross_cents"]) for row in result["per_entry"]] == expected
        assert money(result["aggregate"]["gross_cents"]) == sum(expected)
        assert money(result["aggregate"]["net_cents"]) == sum(expected) - fee * len(own_values)
