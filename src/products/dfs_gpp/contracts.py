"""Immutable, explicit-unit contracts shared by Classic and Showdown research."""

from __future__ import annotations

from dataclasses import dataclass


def require_int(value: int, name: str, minimum: int | None = None) -> None:
    """Reject booleans and lossy float coercion at the arithmetic boundary."""
    if type(value) is not int:
        raise TypeError(f"{name} must be a Python integer")
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")


@dataclass(frozen=True)
class CashContest:
    """One modeled cash contest, not its lobby capacity or current fill.

    Prizes are nonnegative integer cents, explicitly zero-padded through every
    modeled rank. Ticket contests and platform currency rounding are unsupported.
    IDs/ownership/provenance are the responsibility of the snapshot adapter.
    """

    modeled_entries: int
    entry_fee_cents: int
    entry_limit: int
    prizes_cents: tuple[int, ...]
    capacity: int
    current_entries: int | None = None
    advertised_prize_pool_cents: int | None = None

    def __post_init__(self) -> None:
        for name in ("modeled_entries", "entry_limit", "capacity"):
            require_int(getattr(self, name), name, 1)
        require_int(self.entry_fee_cents, "entry_fee_cents", 0)
        if self.modeled_entries > self.capacity:
            raise ValueError("modeled_entries exceeds capacity")
        if self.entry_limit > self.capacity:
            raise ValueError("entry_limit exceeds capacity")
        if self.current_entries is not None:
            require_int(self.current_entries, "current_entries", 0)
            if self.current_entries > self.modeled_entries:
                raise ValueError("modeled_entries cannot be below current_entries")
        # Copy mutable caller inputs so frozen instances are actually immutable.
        prizes = tuple(self.prizes_cents)
        object.__setattr__(self, "prizes_cents", prizes)
        if len(prizes) != self.modeled_entries:
            raise ValueError("prizes_cents must cover every modeled rank, including zeros")
        for prize in prizes:
            require_int(prize, "prize cents", 0)
        if any(a < b for a, b in zip(prizes, prizes[1:])):
            raise ValueError("cash prizes must be nonincreasing by rank")
        if self.advertised_prize_pool_cents is not None:
            require_int(self.advertised_prize_pool_cents, "advertised_prize_pool_cents", 0)
            if sum(prizes) != self.advertised_prize_pool_cents:
                raise ValueError("prizes do not reconcile to advertised cash pool")


@dataclass(frozen=True)
class ScoreMultiplicity:
    """A fixed-point final score and its number of opposing entries.

    All scores in an evaluation must use the same verified scoring unit. Negative
    scores are valid. Equal scores may belong to different underlying lineups.
    """

    score_units: int
    count: int

    def __post_init__(self) -> None:
        require_int(self.score_units, "score_units")
        require_int(self.count, "count", 1)
