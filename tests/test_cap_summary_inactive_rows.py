"""Cut / dropped rows never count toward position limits, and cuts charge only dead cap."""

from __future__ import annotations

from src.draft_hub.presets import load_preset
from src.draft_hub.rules_engine import blocking_acquisition_errors, cap_summary
from src.draft_hub.schemas import LeagueRules


def _rules() -> LeagueRules:
    rules = LeagueRules.model_validate(load_preset("salary_cap_auction_v1"))
    roster = dict(rules.roster or {})
    roster["qb"] = {**(roster.get("qb") or {}), "min": 1, "max": 3}
    return rules.model_copy(update={"roster": roster})


def _qb(pid: str, salary: float, status: str = "active") -> dict:
    return {
        "player_id": pid,
        "player_name": pid,
        "position": "QB",
        "salary": salary,
        "contract_years": 1,
        "roster_status": status,
    }


def test_cut_and_waived_qbs_do_not_count_toward_qb_max():
    rules = _rules()
    roster = [
        _qb("a", 9),
        _qb("b", 11),
        _qb("cut1", 2, "cut_before_draft"),
        _qb("cut2", 4, "cut_before_draft"),
        _qb("dropped", 5, "waived"),
        _qb("new", 1),
    ]
    errors = blocking_acquisition_errors(rules, roster)
    assert not any("too many QB" in e for e in errors)
    assert cap_summary(rules, roster)["by_position_count"]["QB"] == 3


def test_pre_draft_cut_charges_only_floored_dead_cap():
    rules = _rules()
    summary = cap_summary(rules, [_qb("live", 9), _qb("cut", 14, "cut_before_draft"), _qb("gone", 20, "waived")])
    pct = float(rules.contracts.cut_refund_pct)
    import math

    assert summary["spent"] == 9 + math.floor(14 * (1 - pct) + 1e-9)
    assert summary["roster_size"] == 1
