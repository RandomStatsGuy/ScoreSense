"""Exact cash payouts for shared scenarios; no forecasts or simulation claims."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from fractions import Fraction
from itertools import accumulate
from typing import Iterable

from .contracts import CashContest, ScoreMultiplicity, require_int


@dataclass(frozen=True)
class PortfolioPayout:
    entry_payouts_cents: tuple[Fraction, ...]
    entry_fees_cents: int

    @property
    def gross_cents(self) -> Fraction:
        return sum(self.entry_payouts_cents, Fraction(0))

    @property
    def net_cents(self) -> Fraction:
        return self.gross_cents - self.entry_fees_cents

    @property
    def net_roi(self) -> Fraction | None:
        return self.net_cents / self.entry_fees_cents if self.entry_fees_cents else None


@dataclass(frozen=True)
class CashPayoutEvaluator:
    """Reuse a prize prefix sum across many scenarios of the same contest.

    The caller scores every entry on ONE common player-outcome vector per draw.
    This module cannot prove that upstream invariant and does not estimate ROI
    expectations, ownership, confidence intervals, or globally optimal portfolios.
    """

    contest: CashContest
    _prefix: tuple[int, ...] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        if not isinstance(self.contest, CashContest):
            raise TypeError("contest must be a validated CashContest")
        object.__setattr__(self, "_prefix", (0, *accumulate(self.contest.prizes_cents)))

    def tied_payout_cents(self, strictly_above: int, equal_other: int) -> Fraction:
        require_int(strictly_above, "strictly_above", 0)
        require_int(equal_other, "equal_other", 0)
        stop = strictly_above + equal_other + 1
        if stop > self.contest.modeled_entries:
            raise ValueError("tie interval exceeds the modeled field")
        return Fraction(self._prefix[stop] - self._prefix[strictly_above], equal_other + 1)

    def evaluate_portfolio(
        self,
        own_scores: Iterable[int],
        opponent_scores: Iterable[ScoreMultiplicity],
    ) -> PortfolioPayout:
        """Include ALL own entries (including existing duplicates) together.

        Opponent multiplicities must sum to N-K, never a downsampled field. This
        method returns one scenario's realized arithmetic, not expected returns.
        """
        own = tuple(own_scores)
        k = len(own)
        if not 1 <= k <= min(self.contest.entry_limit, self.contest.modeled_entries):
            raise ValueError("own entry count is empty or exceeds contest limits")
        for score in own:
            require_int(score, "own score_units")
        counts: Counter[int] = Counter()
        for bucket in opponent_scores:
            if not isinstance(bucket, ScoreMultiplicity):
                raise TypeError("opponent_scores requires ScoreMultiplicity records")
            counts[bucket.score_units] += bucket.count
        if sum(counts.values()) != self.contest.modeled_entries - k:
            raise ValueError("opposing entry multiplicities must sum to N-K")
        counts.update(own)
        own_keys = set(own)
        shares: dict[int, Fraction] = {}
        above = 0
        for score, count in sorted(counts.items(), reverse=True):
            if score in own_keys:
                shares[score] = self.tied_payout_cents(above, count - 1)
            above += count
        return PortfolioPayout(tuple(shares[score] for score in own), k * self.contest.entry_fee_cents)
