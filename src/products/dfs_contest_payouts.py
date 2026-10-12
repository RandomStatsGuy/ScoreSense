"""Exact conditional cash arithmetic for a declared, fully represented field.

This adapter does not authenticate a contest contract or estimate future payout.
Rank groups include every own entry and opponent multiplicity. A fractional
share is preserved until the explicitly declared cash rounding policy is used.
No account ledger, contest entries, or saved lineup is read or changed.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from fractions import Fraction
import math
import re

SCHEMA_VERSION = "dfs_cash_payout_contract_v1"
RESULT_VERSION = "dfs_cash_payout_review_v1"
MAX_ENTRANTS = 1_000_000_000
MAX_TIERS = 20_000
MAX_SCORE_GROUPS = 20_000
MAX_OWN_ENTRIES = 150
MAX_CENTS = 1_000_000_000_000
ROUNDING_POLICIES = {"exact_fraction", "floor_cent", "half_up_cent"}


def _fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(f"{label} contains unsupported fields.")
    return value


def _integer(value, label, lower, upper):
    if type(value) is not int or not lower <= value <= upper:
        raise ValueError(f"{label} requires a whole integer from {lower} to {upper}.")
    return value


def _identity(value, label, maximum=2000):
    if (not isinstance(value, str) or not value or value != value.strip() or len(value) > maximum
            or any(ord(char) < 32 or ord(char) == 127 for char in value)):
        raise ValueError(f"{label} requires an explicit identity without padding.")
    return value


def _source(value):
    _fields(value, {"source_uri", "content_sha256", "as_of"}, "Payout source")
    uri = _identity(value.get("source_uri"), "Payout source URI")
    digest = value.get("content_sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
        raise ValueError("Payout source requires its declared SHA-256 content hash.")
    stamp = _identity(value.get("as_of"), "Payout as-of time", 80)
    try:
        parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Payout as-of time requires an ISO timestamp with a timezone.") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Payout as-of time requires an ISO timestamp with a timezone.")
    return {"source_uri": uri, "content_sha256": digest.lower(),
            "as_of": parsed.astimezone(timezone.utc).isoformat()}


def validate_payout_contract(raw):
    """Validate a cash-only contract; declarations remain unauthenticated.

    Tiers must explicitly cover all ranks through ``paid_places``. Later ranks
    are explicitly declared zero. A known zero-prize contract is represented by
    ``paid_places=0`` and an empty tier list; missing payouts are never zero.
    """
    _fields(raw, {"schema_version", "contest_id", "entrant_count", "currency", "entry_fee_cents",
                  "paid_places", "payout_tiers", "unpaid_ranks", "tie_policy", "noncash_prizes"},
            "Cash payout contract")
    if raw.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported cash payout contract version.")
    contest_id = _identity(raw.get("contest_id"), "Contest ID", 120)
    entrants = _integer(raw.get("entrant_count"), "Actual/scenario entrant count", 1, MAX_ENTRANTS)
    if raw.get("currency") != "USD":
        raise ValueError("Cash payout arithmetic currently supports USD cents only.")
    fee = _integer(raw.get("entry_fee_cents"), "Entry fee cents", 0, MAX_CENTS)
    paid = _integer(raw.get("paid_places"), "Declared paid-place range", 0, entrants)
    if raw.get("unpaid_ranks") != "zero":
        raise ValueError("Ranks outside the declared payout schedule require explicit zero cash payout.")
    if raw.get("noncash_prizes") != []:
        raise ValueError("Noncash prizes need an unsupported award/tie adapter; missing is not cash-only.")
    tiers = raw.get("payout_tiers")
    if not isinstance(tiers, list) or len(tiers) > MAX_TIERS or bool(tiers) != bool(paid):
        raise ValueError("Supply the complete bounded payout tier schedule, including explicit zero tiers.")
    normalized, next_rank = [], 1
    for tier in tiers:
        _fields(tier, {"start_rank", "end_rank", "prize_cents"}, "Payout tier")
        first = _integer(tier.get("start_rank"), "Tier start rank", 1, paid)
        last = _integer(tier.get("end_rank"), "Tier end rank", first, paid)
        prize = _integer(tier.get("prize_cents"), "Tier prize cents", 0, MAX_CENTS)
        if first != next_rank:
            raise ValueError("Payout tiers must cover ranks 1 through paid_places without gaps or overlap.")
        normalized.append({"start_rank": first, "end_rank": last, "prize_cents": prize})
        next_rank = last + 1
    if next_rank != paid + 1:
        raise ValueError("Payout tiers do not cover all declared paid places.")
    tie = _fields(raw.get("tie_policy"), {"cash_split", "rounding", "source"}, "Cash tie policy")
    if tie.get("cash_split") != "occupied_rank_mean" or tie.get("rounding") not in ROUNDING_POLICIES:
        raise ValueError("Declare the supported occupied-rank mean and exact cash rounding policy.")
    return {"schema_version": SCHEMA_VERSION, "contest_id": contest_id, "entrant_count": entrants,
            "currency": "USD", "entry_fee_cents": fee, "paid_places": paid,
            "payout_tiers": normalized, "unpaid_ranks": "zero", "noncash_prizes": [],
            "tie_policy": {"cash_split": "occupied_rank_mean", "rounding": tie["rounding"],
                           "source": _source(tie.get("source"))}}


def _score(value):
    # A JSON float uses its shortest round-trip decimal text. No epsilon or
    # display rounding ever creates ties. Callers with exact point integers
    # should supply decimal strings so their source precision survives JSON.
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        raise ValueError("Every score requires an explicit finite decimal value.")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Every score requires an explicit finite decimal value.")
    text = str(value)
    if (len(text) > 80 or text != text.strip() or not re.fullmatch(
            r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", text)):
        raise ValueError("Every score requires a bounded exact decimal value.")
    try:
        decimal = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError("Every score requires an explicit finite decimal value.") from exc
    if (not decimal.is_finite() or decimal.copy_abs() > Decimal(1_000_000_000)
            or decimal.as_tuple().exponent < -24 or len(decimal.as_tuple().digits) > 40):
        raise ValueError("Score magnitude or decimal precision exceeds the supported bound.")
    return Fraction(decimal)


def _decimal(fraction):
    """Return an exact terminating decimal, or None for repeating fractions."""
    denominator, twos, fives = fraction.denominator, 0, 0
    while denominator % 2 == 0:
        denominator //= 2
        twos += 1
    while denominator % 5 == 0:
        denominator //= 5
        fives += 1
    if denominator != 1:
        return None
    scale = max(twos, fives)
    integer = abs(fraction.numerator) * (2 ** (scale - twos)) * (5 ** (scale - fives))
    digits = str(integer).zfill(scale + 1)
    result = digits if not scale else f"{digits[:-scale]}.{digits[-scale:]}".rstrip("0").rstrip(".")
    return ("-" if fraction < 0 else "") + result


def _money(value):
    fraction = Fraction(value)
    return {"unit": "USD_cents", "numerator": str(fraction.numerator),
            "denominator": str(fraction.denominator), "decimal": _decimal(fraction)}


def _round_share(share, policy):
    if policy == "exact_fraction":
        return share
    if policy == "floor_cent":
        return Fraction(share.numerator // share.denominator)
    # Cash awards are nonnegative. Integer arithmetic implements decimal half-up
    # without binary floating point or the process Decimal context.
    return Fraction((2 * share.numerator + share.denominator) // (2 * share.denominator))


def evaluate_payouts(own_scores, opponent_scores, contract, *, top_k=None):
    """Rank the entire supplied field and split each occupied prize pool once.

    ``own_scores`` has distinct ``entry_id`` identities, not necessarily unique
    scores or lineups. Opponents are compressed ``{score, count}`` rows and keep
    their full multiplicity. Work is bounded by rows/tiers, never field size.
    Top-k includes ties whose first occupied rank is at or above the cutoff.
    """
    contract = validate_payout_contract(contract)
    entrants = contract["entrant_count"]
    top_k = _integer(min(10, entrants) if top_k is None else top_k, "Top-finish rank cutoff", 1, entrants)
    if not isinstance(own_scores, list) or not 1 <= len(own_scores) <= MAX_OWN_ENTRIES:
        raise ValueError("Supply 1–150 explicit own entry scores.")
    if not isinstance(opponent_scores, list) or len(opponent_scores) > MAX_SCORE_GROUPS:
        raise ValueError("Supply a bounded compressed opponent score field.")
    own_by_score, own_order, identities = defaultdict(list), [], set()
    for row in own_scores:
        _fields(row, {"entry_id", "score"}, "Own entry score")
        identity = _identity(row.get("entry_id"), "Own entry ID", 120)
        if identity in identities:
            raise ValueError("Own entry identities must be distinct; tied scores are allowed.")
        identities.add(identity)
        score = _score(row.get("score"))
        own_order.append(identity)
        own_by_score[score].append(identity)
    opponents = Counter()
    for row in opponent_scores:
        _fields(row, {"score", "count"}, "Opponent score group")
        score = _score(row.get("score"))
        count = _integer(row.get("count"), "Opponent multiplicity", 1, MAX_ENTRANTS)
        opponents[score] += count
    if len(own_scores) + sum(opponents.values()) != entrants:
        raise ValueError("Actual/scenario entrant count must equal every own entry plus opponent multiplicities.")

    tiers, tier_index, above = contract["payout_tiers"], 0, 0
    policy, fees = contract["tie_policy"]["rounding"], contract["entry_fee_cents"]
    per_entry, score_groups = {}, []
    gross, unrounded_gross = Fraction(0), Fraction(0)
    first_finish, first_tie, sole_first, top_finish, cash = False, False, False, False, False
    for score in sorted(set(own_by_score) | set(opponents), reverse=True):
        own_ids = own_by_score.get(score, [])
        opponent_count = opponents[score]
        count = len(own_ids) + opponent_count
        first, last = above + 1, above + count
        prize_pool, cursor = 0, first
        while tier_index < len(tiers) and cursor <= last:
            tier = tiers[tier_index]
            if tier["end_rank"] < cursor:
                tier_index += 1
                continue
            if tier["start_rank"] > last:
                break
            end = min(last, tier["end_rank"])
            prize_pool += (end - cursor + 1) * tier["prize_cents"]
            cursor = end + 1
            if cursor > tier["end_rank"]:
                tier_index += 1
        share = Fraction(prize_pool, count)
        rounded_share = _round_share(share, policy)
        detail = {"score": _decimal(score), "rank_start": first, "rank_end": last,
                  "tied_entries": count, "own_tied_entries": len(own_ids),
                  "opponent_tied_entries": opponent_count, "prize_pool_cents": _money(prize_pool),
                  "unrounded_share_cents": _money(share), "gross_cents": _money(rounded_share),
                  "rounding_remainder_cents": _money(Fraction(prize_pool) - rounded_share * count)}
        score_groups.append(detail)
        if own_ids:
            first_finish |= first == 1
            first_tie |= first == 1 and count > 1
            sole_first |= first == 1 and count == 1
            top_finish |= first <= top_k
            cash |= rounded_share > 0
            gross += rounded_share * len(own_ids)
            unrounded_gross += share * len(own_ids)
            for identity in own_ids:
                per_entry[identity] = {"entry_id": identity, **detail,
                                       "fee_cents": _money(fees), "net_cents": _money(rounded_share - fees)}
        above = last
    total_fees = fees * len(own_scores)
    return {"schema_version": RESULT_VERSION, "contest_id": contract["contest_id"],
            "semantics": "exact_conditional_cash_arithmetic_not_forecast_ev_or_settled_returns",
            "entrant_count": entrants, "own_entry_count": len(own_scores),
            "opponent_entry_count": entrants - len(own_scores), "currency": "USD", "rounding": policy,
            "per_entry": [per_entry[identity] for identity in own_order], "score_groups": score_groups,
            "aggregate": {"gross_cents": _money(gross), "fees_cents": _money(total_fees),
                          "net_cents": _money(gross - total_fees), "unrounded_gross_cents": _money(unrounded_gross)},
            "coverage": {"first_place_finish": first_finish, "first_place_tie": first_tie,
                         "sole_first": sole_first, "top_k": top_finish, "top_k_cutoff": top_k,
                         "top_k_includes_boundary_ties": True, "cash": cash,
                         "net_positive": gross > total_fees},
            "capabilities": {"exact_conditional_math": True, "declared_cash_rounding": policy != "exact_fraction",
                             "platform_verified": False, "settlement": False, "forecast_expected_value": False},
            "warnings": ["The supplied payout schedule, source hash and rounding rule are declarations, not platform authentication.",
                         "Exact fractional shares precede platform settlement; this result is conditional research, not account revenue or expected return."]}
