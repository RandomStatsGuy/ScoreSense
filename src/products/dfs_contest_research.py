"""Conditional contest replay of supplied legal fields and shared game events.

No fitted ownership model, future-return forecast, selection or account writes.
Exact payout arithmetic is separate from the declared probability assumptions.
"""
from collections import Counter
from copy import deepcopy
from decimal import Decimal
from fractions import Fraction
import hashlib
import random
from time import monotonic

from src.products.dfs_shared_outcomes import _hash, _lineups, _verified_bank, _time
from src.products.dfs_contest_field import prepare_contest_field, field_summary, iter_field_draws, verified_contest_field
from src.products.dfs_contest_payouts import validate_payout_contract, evaluate_payouts

RESULT_VERSION = "dfs_contest_research_review_v1"
SEMANTICS = "conditional_supplied_field_and_game_replay_not_forecast_ev"
CAPABILITIES = {
    "legal_declared_field": True, "full_field_multiplicity": True,
    "exact_conditional_cash_ties": True, "ownership_calibrated": False,
    "joint_outcomes_calibrated": False, "expected_payout": False,
    "forward_forecast": False, "platform_settlement_verified": False,
    "portfolio_selection": False, "untouched_evaluation_verified": False,
}
WARNINGS = [
    "Results depend on supplied game and opponent-lineup weights; they are not forecast returns.",
    "Every opponent entry is represented. Limited template coverage can still omit important competing constructions.",
    "Ownership assumptions change the opponent field, never player performance.",
    "Sampling error measures replay noise only; it excludes data, ownership and game-model uncertainty.",
    "Source and tie-policy receipts are declarations; platform settlement and historical availability are unverified.",
    "Purpose-separated streams do not prove that evaluation was untouched during lineup selection.",
]


def prepare_contest_research(bank, field_payload, payout_payload):
    bank = _verified_bank(bank)
    field = prepare_contest_field(field_payload, context=bank["context"], pool=bank["pool"])
    payout = validate_payout_contract(payout_payload)
    if any(field["contest"][key] != payout[key] for key in ("contest_id", "entrant_count")):
        raise ValueError("Opponent field and payout schedule must describe the exact same contest and entry count.")
    if field["decision_at"] != bank["decision_at"]:
        raise ValueError("Game and opponent assumptions must use the same declared decision timestamp.")
    # A tie policy must point to an admitted source, not an unrelated bare hash.
    source = payout["tie_policy"]["source"]
    if _time(source["as_of"], "Payout source time") > _time(bank["decision_at"], "Decision time"):
        raise ValueError("Payout rules must be declared available by the decision time.")
    if not any(row["uri"] == source["source_uri"] and row["content_sha256"] == source["content_sha256"]
               for row in field["sources"]):
        raise ValueError("The payout tie policy needs a matching admitted source receipt.")
    package = {"bank_id": bank["content_id"], "field_id": field["content_id"], "payout_contract": payout}
    return {"content_id": _hash(package), "field": field, "payout_contract": payout,
            "bank_id": bank["content_id"]}


def contest_research_summary(prepared):
    payout = prepared["payout_contract"]
    return {"schema_version": "dfs_contest_research_preview_v1", "content_id": prepared["content_id"],
            "bank_id": prepared["bank_id"], "field": field_summary(prepared["field"]),
            "payout_contract": deepcopy(payout), "semantics": SEMANTICS,
            "capabilities": deepcopy(CAPABILITIES), "warnings": list(WARNINGS)}


def _money(value):
    value = Fraction(value)
    return {"unit": "USD_cents", "numerator": str(value.numerator), "denominator": str(value.denominator)}


def _fraction(value):
    return Fraction(int(value["numerator"]), int(value["denominator"]))


def _distribution(values):
    ordered = sorted(values)
    def quantile(numerator):
        at = Fraction((len(values) - 1) * numerator, 10)
        lo = at.numerator // at.denominator
        return ordered[lo] + (ordered[min(lo + 1, len(values) - 1)] - ordered[lo]) * (at - lo)
    mean = sum(values, Fraction()) / len(values)
    # Finite sampling-error estimate; no confidence interval or future inference.
    variance = sum((float(value - mean) ** 2 for value in values)) / max(1, len(values) - 1)
    return {"mean_cents": _money(mean), "p10_cents": _money(quantile(1)),
            "p50_cents": _money(quantile(5)), "p90_cents": _money(quantile(9)),
            "min_cents": _money(ordered[0]), "max_cents": _money(ordered[-1]),
            "replay_standard_error_cents": (variance / len(values)) ** .5}


def evaluate_contest_research(bank, prepared, lineups, *, seed=0, draw_count=128, top_k=10):
    start = monotonic()
    bank = _verified_bank(bank)
    verified_contest_field(prepared["field"])
    # Revalidate raw fields outside this function; the prepared content is also
    # verified by the field sampler and bound to the selected package here.
    if prepared["bank_id"] != bank["content_id"] or prepared["content_id"] != _hash({
            "bank_id": bank["content_id"], "field_id": prepared["field"]["content_id"],
            "payout_contract": prepared["payout_contract"]}):
        raise ValueError("The selected contest assumptions changed; preview and select them again.")
    if type(seed) is not int or not 0 <= seed <= 2**31 - 1 or type(draw_count) is not int or not 32 <= draw_count <= 256:
        raise ValueError("Contest research supports 32–256 draws and a nonnegative 31-bit seed.")
    payout, field = prepared["payout_contract"], prepared["field"]
    if type(top_k) is not int or not 1 <= top_k <= payout["entrant_count"]:
        raise ValueError("Top finish cutoff must fit the supplied contest.")
    entries = _lineups(lineups, {p["player_id"]: p for p in bank["pool"]})
    opponent_count = payout["entrant_count"] - len(entries)
    if opponent_count < 1:
        raise ValueError("The actual contest must include at least one opponent beyond all reviewed own entries.")
    stream = hashlib.sha256(f"{bank['content_id']}:{seed}:evaluation:dfs-shared-v1".encode()).hexdigest()
    rng, choices = random.Random(int(stream, 16)), []
    state = {s["scenario_id"]: {"gross": [], "net": [], "coverage": Counter(),
             "lineups": {e["lineup_id"]: [] for e in entries}, "field_streams": []} for s in field["scenarios"]}
    field_draws = {s["scenario_id"]: iter_field_draws(field, opponent_count, scenario_id=s["scenario_id"],
        seed=seed, draw_count=draw_count, purpose="evaluation") for s in field["scenarios"]}
    for draw in range(draw_count):
        scores, selected = {}, []
        for game in bank["games"]:
            profile = rng.choices(game["profiles"], weights=[p["weight"] for p in game["profiles"]], k=1)[0]
            selected.append((game["game_id"], profile["profile_id"]))
            scores.update({pid: Decimal(str(value)) for pid, value in profile["player_scores"].items()})
        choices.append(selected)
        total = lambda ids: str(sum((scores[pid] for pid in ids), Decimal(0)))
        own = [{"entry_id": e["lineup_id"], "score": total(e["player_ids"])} for e in entries]
        for scenario in field["scenarios"]:
            sampled = next(field_draws[scenario["scenario_id"]])
            opponents = [{"score": total(row["player_ids"]), "count": row["multiplicity"]}
                         for row in sampled["template_counts"] if row["multiplicity"]]
            result = evaluate_payouts(own, opponents, payout, top_k=top_k)
            values = state[scenario["scenario_id"]]
            values["gross"].append(_fraction(result["aggregate"]["gross_cents"]))
            values["net"].append(_fraction(result["aggregate"]["net_cents"]))
            for key in ("first_place_finish", "first_place_tie", "sole_first", "top_k", "cash", "net_positive"):
                values["coverage"][key] += int(result["coverage"][key])
            for row in result["per_entry"]:
                values["lineups"][row["entry_id"]].append(_fraction(row["net_cents"]))
            values["field_streams"].append(sampled["stream_id"])
    rows = []
    for scenario in field["scenarios"]:
        values = state[scenario["scenario_id"]]
        rows.append({"scenario_id": scenario["scenario_id"], "provider": scenario["provider"],
            "injury_assumption": scenario["injury_assumption"], "gross": _distribution(values["gross"]),
            "net": _distribution(values["net"]), "fees_cents": _money(payout["entry_fee_cents"] * len(entries)),
            "sampled_finish_fractions": {k: v / draw_count for k, v in values["coverage"].items()},
            "lineups": [{"lineup_id": e["lineup_id"], "net": _distribution(values["lineups"][e["lineup_id"]])} for e in entries],
            "field_draw_content_id": _hash(values["field_streams"])})
    return {"schema_version": RESULT_VERSION, "semantics": SEMANTICS, "context": deepcopy(bank["context"]),
        "bank_id": bank["content_id"], "contest_research_id": prepared["content_id"],
        "scoring_version": bank["scoring_version"], "contest": deepcopy(field["contest"]),
        "capabilities": deepcopy(CAPABILITIES), "draw_count": draw_count, "top_k": top_k,
        "own_entry_count": len(entries), "opponent_entry_count": opponent_count,
        "stream_manifest": {"purpose": "evaluation", "seed": seed, "game_stream_id": stream,
            "game_draw_content_id": _hash(choices), "common_game_draws_across_assumptions": True,
            "full_opponent_count": True, "finalist_choice_independence_verified": False},
        "assumptions": rows, "runtime_seconds": monotonic() - start, "warnings": list(WARNINGS)}
