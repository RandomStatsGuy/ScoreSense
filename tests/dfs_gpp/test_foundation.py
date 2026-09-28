"""Deterministic foundations; no claims about learned football/field quality."""

from dataclasses import FrozenInstanceError, fields
from fractions import Fraction
from itertools import product
import random

import pytest

from src.products.dfs_gpp.contracts import CashContest, ScoreMultiplicity
from src.products.dfs_gpp.identity import scoring_lineup_key
from src.products.dfs_gpp.payouts import CashPayoutEvaluator
from src.products.dfs_gpp.readiness import (
    CapabilityUnavailable, ReadinessEvidence, assess_readiness, require_capability,
)


def contest(**overrides):
    values = dict(
        modeled_entries=5, entry_fee_cents=100, entry_limit=5,
        prizes_cents=(10000, 6000, 4000, 0, 0), capacity=10,
    )
    values.update(overrides)
    return CashContest(**values)


def ready(**overrides):
    values = {item.name: True for item in fields(ReadinessEvidence)}
    values.update(overrides)
    return ReadinessEvidence(**values)


def key(ids, *, style="classic", captain=None, slate="slate-a"):
    return scoring_lineup_key(
        site="draftkings", slate_snapshot_id=slate, game_style=style,
        player_ids=ids, captain_id=captain,
    )


@pytest.mark.parametrize("overrides", [
    {"modeled_entries": 0}, {"modeled_entries": True}, {"capacity": 4},
    {"entry_limit": 0}, {"entry_limit": 11}, {"entry_fee_cents": -1},
    {"entry_fee_cents": 1.5}, {"current_entries": -1}, {"current_entries": 6},
    {"current_entries": False}, {"prizes_cents": (10000, 6000)},
    {"prizes_cents": (10000, 6000, 4000, 0, -1)},
    {"prizes_cents": (6000, 10000, 4000, 0, 0)},
    {"prizes_cents": (10000, 6000, 4000, 0, False)},
    {"prizes_cents": (10000, 6000, 4000, 0, 0.0)},
    {"advertised_prize_pool_cents": 19999},
])
def test_invalid_contest_rejected(overrides):
    with pytest.raises((TypeError, ValueError)):
        contest(**overrides)


def test_capacity_fill_modeled_size_are_distinct_and_prizes_immutable():
    prizes = [10000, 6000, 4000, 0, 0]
    spec = contest(current_entries=3, prizes_cents=prizes, advertised_prize_pool_cents=20000)
    prizes[0] = 0
    assert (spec.current_entries, spec.modeled_entries, spec.capacity) == (3, 5, 10)
    assert spec.prizes_cents[0] == 10000
    with pytest.raises(FrozenInstanceError):
        spec.entry_limit = 2


@pytest.mark.parametrize("above,equal,expected", [
    (0, 1, Fraction(8000)), (1, 2, Fraction(10000, 3)),
    (2, 2, Fraction(4000, 3)), (0, 4, Fraction(4000)),
    (4, 0, Fraction(0)), (0, 0, Fraction(10000)),
])
def test_exact_tie_intervals(above, equal, expected):
    assert CashPayoutEvaluator(contest()).tied_payout_cents(above, equal) == expected


@pytest.mark.parametrize("above,equal", [(-1, 0), (0, -1), (4, 1), (5, 0), (True, 0), (0, 1.0)])
def test_invalid_tie_intervals(above, equal):
    with pytest.raises((TypeError, ValueError)):
        CashPayoutEvaluator(contest()).tied_payout_cents(above, equal)


def test_own_entries_compete_and_tie_with_each_other_and_field():
    result = CashPayoutEvaluator(contest()).evaluate_portfolio(
        [10, 10], [ScoreMultiplicity(10, 1), ScoreMultiplicity(5, 2)],
    )
    assert result.entry_payouts_cents == (Fraction(20000, 3),) * 2
    assert result.gross_cents == Fraction(40000, 3)
    assert result.entry_fees_cents == 200
    assert result.net_cents == Fraction(39400, 3)
    assert result.net_roi == Fraction(197, 3)


def test_free_contest_roi_is_none_not_infinity():
    result = CashPayoutEvaluator(contest(entry_fee_cents=0)).evaluate_portfolio(
        [1], [ScoreMultiplicity(0, 4)],
    )
    assert result.net_roi is None
    assert result.gross_cents == result.net_cents == 10000


def test_compressed_field_keeps_all_entries_and_accepts_negative_scores():
    evaluator = CashPayoutEvaluator(contest())
    compressed = evaluator.evaluate_portfolio([-1], [ScoreMultiplicity(-2, 4)])
    expanded = evaluator.evaluate_portfolio([-1], [ScoreMultiplicity(-2, 1)] * 4)
    assert compressed == expanded
    assert compressed.gross_cents == 10000


@pytest.mark.parametrize("own,opponents", [
    ([], [ScoreMultiplicity(0, 5)]),
    ([1] * 6, []),
    ([True], [ScoreMultiplicity(0, 4)]),
    ([1.0], [ScoreMultiplicity(0, 4)]),
    ([1], [ScoreMultiplicity(0, 3)]),
    ([1], [ScoreMultiplicity(0, 5)]),
    ([1], [(0, 4)]),
])
def test_invalid_portfolio_counts_and_scores(own, opponents):
    with pytest.raises((TypeError, ValueError)):
        CashPayoutEvaluator(contest()).evaluate_portfolio(own, opponents)


def test_actual_entry_limit_is_enforced():
    with pytest.raises(ValueError):
        CashPayoutEvaluator(contest(entry_limit=1)).evaluate_portfolio(
            [1, 2], [ScoreMultiplicity(0, 3)],
        )


@pytest.mark.parametrize("score,count", [(1.0, 1), (True, 1), (0, 0), (0, -1), (0, True), (0, 1.5)])
def test_invalid_multiplicity(score, count):
    with pytest.raises((TypeError, ValueError)):
        ScoreMultiplicity(score, count)


def test_exhaustive_small_fields_match_independent_rank_reference():
    evaluator = CashPayoutEvaluator(contest())
    prizes = evaluator.contest.prizes_cents
    for scores in product((-1, 0, 1), repeat=5):
        expected = []
        for score in scores:
            above = sum(other > score for other in scores)
            tied = scores.count(score)
            expected.append(Fraction(sum(prizes[above:above+tied]), tied))
        result = evaluator.evaluate_portfolio(scores, [])
        assert result.entry_payouts_cents == tuple(expected)
        assert result.gross_cents == sum(prizes)
        for k in (1, 2, 4):
            partial = evaluator.evaluate_portfolio(
                scores[:k], [ScoreMultiplicity(score, 1) for score in scores[k:]],
            )
            assert partial.entry_payouts_cents == tuple(expected[:k])


def test_random_fields_conserve_all_prizes():
    rng = random.Random(20260928)
    for _ in range(75):
        n = rng.randint(1, 30)
        prizes = tuple(sorted((rng.randint(0, 10000) for _ in range(n)), reverse=True))
        spec = contest(modeled_entries=n, capacity=n, entry_limit=n, prizes_cents=prizes)
        scores = [rng.randint(-20, 20) for _ in range(n)]
        result = CashPayoutEvaluator(spec).evaluate_portfolio(scores, [])
        assert result.gross_cents == sum(prizes)
        assert result.net_cents == sum(prizes) - n * spec.entry_fee_cents


def test_classic_permutations_share_identity_and_slates_do_not():
    ids = tuple(f"p{i}" for i in range(9))
    assert key(ids) == key(reversed(ids))
    assert key(ids) != key(ids, slate="other-snapshot")


def test_showdown_captain_changes_identity_flex_order_does_not():
    ids = tuple(f"p{i}" for i in range(6))
    assert key(ids, style="showdown", captain="p0") == key(reversed(ids), style="showdown", captain="p0")
    assert key(ids, style="showdown", captain="p0") != key(ids, style="showdown", captain="p1")


@pytest.mark.parametrize("ids,style,captain", [
    (("a",) * 9, "classic", None), (tuple("abcdefghi"), "classic", "a"),
    (tuple("abcdef"), "showdown", None), (tuple("abcdef"), "showdown", "z"),
    (tuple("abcdef") + ("a",), "showdown", "a"),
    (tuple("abcdefgh") + ("",), "classic", None),
    (tuple("abcdefgh") + (1,), "classic", None),
    (tuple("abcdefghi"), "cash", None), ("abcdefghi", "classic", None),
])
def test_bad_scoring_identities(ids, style, captain):
    with pytest.raises((TypeError, ValueError)):
        key(ids, style=style, captain=captain)


def test_unsupported_site_and_empty_slate_rejected():
    for site, slate in (("fanduel", "x"), ("draftkings", "")):
        with pytest.raises(ValueError):
            scoring_lineup_key(site=site, slate_snapshot_id=slate, game_style="classic", player_ids=tuple("abcdefghi"))


def test_missing_ownership_does_not_silently_fulfill_payout_request():
    report = assess_readiness(ready(ownership_complete=False), game_style="classic", requested_capability="contest_research")
    assert report.effective_capability is None
    assert not report.allowed
    assert "joint_score_model" in report.available_capabilities
    assert "missing:ownership_complete" in report.blocking_reasons


@pytest.mark.parametrize("missing", [
    "verified_rule_and_scoring_profile", "fresh_inputs", "full_distributions_available",
    "dependence_validated", "all_field_players_supported", "dst_distribution_supported",
    "ownership_complete", "joint_field_model_available", "complete_cash_payouts",
])
def test_missing_dependency_blocks_research_but_not_legacy(missing):
    evidence = ready(**{missing: False})
    report = assess_readiness(evidence, game_style="classic", requested_capability="contest_research")
    assert not report.allowed
    assert f"missing:{missing}" in report.blocking_reasons
    assert "legacy_projection" in report.available_capabilities


def test_showdown_requires_kickers_classic_does_not():
    evidence = ready(kicker_distribution_supported=False)
    assert assess_readiness(evidence, game_style="classic", requested_capability="joint_score_model").allowed
    assert not assess_readiness(evidence, game_style="showdown", requested_capability="joint_score_model").allowed


@pytest.mark.parametrize("flag", [
    "held_out_football_validation", "held_out_field_validation", "payout_validation", "contest_family_validation",
])
def test_research_is_not_production_validation(flag):
    evidence = ready(**{flag: False})
    assert assess_readiness(evidence, game_style="classic", requested_capability="contest_research").allowed
    assert not assess_readiness(evidence, game_style="classic", requested_capability="contest_validated").allowed


def test_late_swap_unavailable_even_with_every_other_evidence_flag():
    report = assess_readiness(ready(), game_style="classic", requested_capability="late_swap_ready")
    assert report.blocking_reasons == ("late_swap_not_implemented",)
    assert report.effective_capability is None


def test_defaults_fail_closed_and_requirement_raises_with_report():
    with pytest.raises(CapabilityUnavailable) as error:
        require_capability(ReadinessEvidence(), game_style="showdown", requested_capability="contest_research")
    assert error.value.report.available_capabilities == ()
    assert error.value.report.requested_capability == "contest_research"
    assert require_capability(ready(), game_style="classic", requested_capability="contest_validated").allowed


def test_truthy_strings_and_unknown_requests_are_rejected():
    with pytest.raises(TypeError):
        ReadinessEvidence(ownership_complete="false")
    with pytest.raises(ValueError):
        assess_readiness(ready(), game_style="classic", requested_capability="gpp_magic")
    with pytest.raises(ValueError):
        assess_readiness(ready(), game_style="simulated_nfl", requested_capability="legacy_projection")


def test_cached_payout_table_cannot_drift_from_contest():
    evaluator = CashPayoutEvaluator(contest())
    with pytest.raises(FrozenInstanceError):
        evaluator.contest = contest(entry_fee_cents=0)
    with pytest.raises(TypeError):
        CashPayoutEvaluator(None)
