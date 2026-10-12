"""Independent rank, tie, tail-risk and union-coverage selection oracles.

These artificial score tables verify exact arithmetic; they provide no model,
ownership, calibration, performance or financial-return evidence.
"""
from collections import Counter
from copy import deepcopy
from decimal import Decimal
from fractions import Fraction
from itertools import combinations
import random

import pytest

from src.products import dfs_contest_portfolio as engine
from src.products.dfs_contest_payouts import evaluate_payouts, validate_payout_contract
from test_dfs_contest_research import fixture, money


def contract(entrants, policy="exact_fraction", prizes=(100, 53, 21, 5), fee=10):
    value = deepcopy(fixture()[-1])
    prizes = prizes[:entrants]
    value.update(entrant_count=entrants, entry_fee_cents=fee, paid_places=len(prizes),
        payout_tiers=[{"start_rank": i, "end_rank": i, "prize_cents": cents}
                      for i, cents in enumerate(prizes, 1)])
    value["tie_policy"]["rounding"] = policy
    return validate_payout_contract(value)


def expanded_oracle(selected, opponents, payout, top_k):
    """Expand only tiny fixtures and count ranks directly, without engine helpers."""
    prize = {rank: tier["prize_cents"] for tier in payout["payout_tiers"]
             for rank in range(tier["start_rank"], tier["end_rank"] + 1)}
    all_scores = list(selected) + list(opponents)
    gross, hit = Fraction(), False
    for score in selected:
        above = sum(value > score for value in all_scores)
        tied = sum(value == score for value in all_scores)
        share = Fraction(sum(prize.get(rank, 0) for rank in range(above + 1, above + tied + 1)), tied)
        if payout["tie_policy"]["rounding"] == "floor_cent":
            share = Fraction(share.numerator // share.denominator)
        elif payout["tie_policy"]["rounding"] == "half_up_cent":
            share = Fraction((2 * share.numerator + share.denominator) // (2 * share.denominator))
        gross += share
        hit |= above + 1 <= top_k
    return gross - len(selected) * payout["entry_fee_cents"], hit


def frozen(scores_by_draw, opponents_by_draw, payout, count, top_k):
    draws = []
    for scores, opponents in zip(scores_by_draw, opponents_by_draw):
        draws.append({"scores": tuple(scores),
            "above": tuple(sum(other > score for other in opponents) for score in scores),
            "equal": tuple(sum(other == score for other in opponents) for score in scores)})
    return {"draws": draws, "contract": payout, "count": count, "top_k": top_k}


@pytest.mark.parametrize("policy", ["exact_fraction", "floor_cent", "half_up_cent"])
@pytest.mark.parametrize("count", [1, 2, 3])
def test_fast_joint_pricing_matches_expanded_rank_oracle_and_separate_adapter(policy, count):
    rng = random.Random(20261013 + count)
    # Dense repeated decimal scores create own/opponent ties crossing paid ranks.
    scores = [tuple(Decimal(rng.randrange(-2, 5)) / 10 for _ in range(6)) for _ in range(8)]
    opponents = [tuple(Decimal(rng.randrange(-2, 5)) / 10 for _ in range(7)) for _ in range(8)]
    payout = contract(count + 7, policy=policy)
    table = frozen(scores, opponents, payout, count, top_k=2)
    for indices in combinations(range(6), count):
        actual = engine._joint_values(table, indices)
        expected_net, expected_hit = [], []
        for draw_scores, draw_opponents in zip(scores, opponents):
            selected = [draw_scores[index] for index in indices]
            net, hit = expanded_oracle(selected, draw_opponents, payout, top_k=2)
            expected_net.append(net)
            expected_hit.append(hit)
            separate = evaluate_payouts(
                [{"entry_id": str(i), "score": str(score)} for i, score in enumerate(selected)],
                [{"score": str(score), "count": n} for score, n in Counter(draw_opponents).items()],
                payout, top_k=2)
            assert money(separate["aggregate"]["net_cents"]) == net
            assert separate["coverage"]["top_k"] == hit
        assert actual == {"net": expected_net, "coverage": expected_hit}


@pytest.mark.parametrize("policy, expected", [("exact_fraction", Fraction(280, 3)),
    ("floor_cent", Fraction(92)), ("half_up_cent", Fraction(94))])
def test_own_ties_share_all_occupied_prizes_and_subtract_each_fee_once(policy, expected):
    payout = contract(4, policy=policy, prizes=(100, 50, 20))
    table = frozen([(Decimal(10), Decimal(10))], [(Decimal(10), Decimal(0))], payout, 2, 1)
    assert engine._joint_values(table, (0, 1)) == {"net": [expected], "coverage": [True]}


def test_tie_crossing_unpaid_boundary_keeps_zero_prizes_in_denominator():
    payout = contract(5, prizes=(101,), fee=0)
    table = frozen([(Decimal(0), Decimal(0))], [(Decimal(0),) * 3], payout, 2, 1)
    assert engine._joint_values(table, (0, 1))["net"] == [Fraction(202, 5)]


@pytest.mark.parametrize("alpha, expected", [(Fraction(0), Fraction(12)),
    (Fraction(1, 2), Fraction(60)), (Fraction(4, 5), Fraction(100)),
    (Fraction(9, 10), Fraction(100))])
def test_cvar_exact_fractional_boundary_oracle(alpha, expected):
    assert engine._cvar([Fraction(-100), Fraction(0), Fraction(20), Fraction(40), Fraction(100)], alpha) == expected


def test_cvar_preserves_profitable_negative_losses_and_fractional_currency():
    assert engine._cvar([Fraction(-100), Fraction(-50)], Fraction(1, 2)) == -50
    assert engine._cvar([Fraction(1, 3), Fraction(2, 3), Fraction(1)], Fraction(1, 2)) == Fraction(8, 9)


def test_top_finish_coverage_uses_union_of_draws_not_individual_hit_sum():
    # A and B both cover the first draw; C covers its complementary draw.
    scores = [(Decimal(10), Decimal(10), Decimal(0)), (Decimal(0), Decimal(0), Decimal(10))]
    opponents = [(Decimal(5), Decimal(5)), (Decimal(5), Decimal(5))]
    payout = contract(4, prizes=(100,), fee=0)
    table = frozen(scores, opponents, payout, 2, 1)
    ab = engine._joint_values(table, (0, 1))
    ac = engine._joint_values(table, (0, 2))
    assert ab["coverage"] == [True, False]
    assert ac["coverage"] == [True, True]
    assert sum(sum(score > 5 for score in (draw[i] for i in (0, 1))) for draw in scores) == 2
    assert sum(sum(score > 5 for score in (draw[i] for i in (0, 2))) for draw in scores) == 2
    assert money(engine._metrics(ab, Fraction(1, 2), Fraction(1), "conditional_top_finish")["objective_value"]) == Fraction(1, 2)
    assert engine._metrics(ac, Fraction(1, 2), Fraction(1), "conditional_top_finish")["objective_value"] == {
        "unit": "sample_fraction", "numerator": "1", "denominator": "1"}


def test_mean_net_loss_risk_and_top_finish_objectives_have_distinct_winners():
    alternatives = {
        "mean": {"net": [Fraction(1000), Fraction(-100), Fraction(-100), Fraction(-100)], "coverage": [True, False, False, False]},
        "risk": {"net": [Fraction(100)] * 4, "coverage": [True, True, False, False]},
        "coverage": {"net": [Fraction(1)] * 4, "coverage": [True] * 4},
    }
    winners = {}
    for mode in engine.OBJECTIVES:
        values = {name: engine._metrics(value, Fraction(1, 2), Fraction(1), mode)
                  for name, value in alternatives.items()}
        winners[mode] = max(values, key=lambda name: money(values[name]["objective_value"]))
    assert winners == {"conditional_mean_net": "mean", "conditional_risk_adjusted_net": "risk",
                       "conditional_top_finish": "coverage"}


def test_joint_pricer_rejects_shortfall_or_repeated_candidate_indices():
    payout = contract(4)
    table = frozen([(Decimal(10), Decimal(9))], [(Decimal(8), Decimal(8))], payout, 2, 1)
    for indices in ((0,), (0, 0)):
        with pytest.raises(ValueError, match="exact requested unique portfolio count"):
            engine._joint_values(table, indices)


def test_changing_only_final_evaluation_seed_cannot_change_selected_candidates(monkeypatch):
    from src.products.dfs_contest_research import prepare_contest_research
    from src.products.dfs_shared_outcomes import prepare_scenario_bank
    raw, pool, lineups, field, payout = fixture()
    third = deepcopy(lineups[0])
    third["lineup_id"] = "projection-preferred"
    third["player_ids"] = ["mia-wr2" if pid == "buf-wr1" else pid for pid in third["player_ids"]]
    lineups.append(third)
    bank = prepare_scenario_bank(raw, context=raw["context"], pool=pool)
    prepared = prepare_contest_research(bank, field, payout)
    options = {"count": 1, "scenario_id": "baseline", "objective": "conditional_mean_net",
        "projection_scores": {row["lineup_id"]: 100 + i for i, row in enumerate(lineups)},
        "seed": 42, "draw_count": 32, "top_k": 1}
    first = engine.select_contest_portfolio(bank, prepared, lineups, **options)
    original_seed = engine._effective_seed
    def changed_seed(seed, purpose):
        value = original_seed(seed, purpose)
        return (value + 1) % (2**31) if purpose == "evaluation" else value
    monkeypatch.setattr(engine, "_effective_seed", changed_seed)
    second = engine.select_contest_portfolio(bank, prepared, lineups, **options)
    assert first["complete"] and second["complete"]
    assert first["selected_lineup_ids"] == second["selected_lineup_ids"]
    assert first["selected"]["selection_metrics"] == second["selected"]["selection_metrics"]
    assert first["stream_manifest"]["selection"] == second["stream_manifest"]["selection"]
    assert first["stream_manifest"]["evaluation"] != second["stream_manifest"]["evaluation"]
    for result in (first, second):
        selected = result["selected"]["evaluation"]["stream_manifest"]
        baseline = result["baseline"]["evaluation"]["stream_manifest"]
        assert selected == baseline
        assert result["capabilities"]["untouched_evaluation_verified"] is False
