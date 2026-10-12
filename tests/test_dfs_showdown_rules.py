"""Synthetic Showdown cases; no claim to reproduce an unavailable live build."""
from copy import deepcopy
from itertools import combinations

import pandas as pd
import pytest

from src.products import lineup_optimizer as optimizer
from src.products.dfs_showdown_rules import resolve_showdown_rules
from src.products.dfs_validation import validate_generated_lineups


def showdown_pool():
    rows = []
    for pid, team, pos, proj in [
        ("qa", "BUF", "QB", 5), ("backup", "BUF", "QB", 24), ("qb", "LA", "QB", 18),
        ("wa", "BUF", "WR", 30), ("ta", "BUF", "TE", 19), ("ra", "BUF", "RB", 22),
        ("wb", "LA", "WR", 25), ("rb", "LA", "RB", 20), ("db", "LA", "DST", 12),
        ("cheap", "LA", "TE", 2),
    ]:
        rows.append({"player_id": pid, "Player": pid, "Team": team, "Position": pos,
                     "Projected Points": proj, "Low (P10)": proj / 2, "High (P90)": proj + 10,
                     "salary": 6000 if pid != "cheap" else 1000,
                     "cpt_salary": 9000 if pid != "cheap" else 1500,
                     "dfs_id": str(100 + len(rows)), "cpt_dfs_id": str(200 + len(rows)),
                     "projection_statistic": "median", "availability_conditioning": "conditional_active"})
    return pd.DataFrame(rows)


def build(pool=None, **options):
    return optimizer.optimize_from_pool_dataframe(showdown_pool() if pool is None else pool,
                                                  site="draftkings_showdown", **options)


def rules(policy="require"):
    return {"receiver_captain_qb": policy, "approved_qb_ids": {"BUF": ["qa"], "LAR": ["qb"]}}


def ids(result):
    return {row["player_id"] for row in result["lineup"]}


def test_require_pairs_verified_identity_and_never_substitutes_high_scoring_backup():
    result = build(showdown_rules=rules(), locked_captain_id="wa")
    assert result["ok"]
    assert "qa" in ids(result)
    assert result["showdown_rules"]["qb_by_team"]["BUF"] == ["qa"]
    assert result["build_snapshot"]["content"]["parameters"]["resolved_showdown_rules"] == result["showdown_rules"]


def test_verified_starter_evidence_is_used_without_pool_order_guess():
    pool = showdown_pool()
    pool["verified_starting_qb"] = pool.player_id.isin(["qa", "qb"])
    result = build(pool, showdown_rules={"receiver_captain_qb": "require"}, locked_captain_id="wa")
    assert result["ok"] and "qa" in ids(result)
    assert result["showdown_rules"]["qb_evidence"]["qa"] == "verified_starter_role"


@pytest.mark.parametrize("policy", ["warn", "off"])
def test_nonbinding_pairing_preserves_legal_unpaired_receiver(policy):
    result = build(showdown_rules=rules(policy), locked_captain_id="wa", excluded_player_ids=["qa"])
    assert result["ok"]
    assert "qa" not in ids(result)
    assert result["showdown_review"]["needs_review_count"] == 1


def test_missing_mapping_blocks_locked_receiver_with_actionable_diagnosis():
    result = build(showdown_rules={"receiver_captain_qb": "require"}, locked_captain_id="wa")
    assert not result["ok"]
    assert result["strategy_diagnostics"][0]["code"] == "receiver_captain_qb_mapping_unavailable"
    assert result["showdown_rules"]["unresolved_receiver_ids"]


def test_missing_mapping_does_not_invent_starter_for_unlocked_captain():
    result = build(showdown_rules={"receiver_captain_qb": "require"})
    assert result["ok"]
    assert result["lineup"][0]["position"] not in {"WR", "TE"}
    assert result["showdown_rules"]["qb_by_team"] == {}


def test_excluded_approved_qb_is_not_reintroduced():
    result = build(showdown_rules=rules(), locked_captain_id="wa", excluded_player_ids=["qa"])
    assert not result["ok"]
    assert result["showdown_rules"]["unavailable_approved_qb_ids"] == ["qa"]


@pytest.mark.parametrize("bad", [[], 4, {"receiver_captain_qb": "sometimes"},
    {"qb_by_team": {"BUF": ["backup"]}},
    {"approved_qb_ids": {"BUF": ["wb"]}}, {"approved_qb_ids": {"BUF": ["qa", "qa"]}},
    {"approved_qb_ids": {"BUF": "qa"}}])
def test_untrusted_or_malformed_pairing_rules_rejected(bad):
    with pytest.raises(ValueError):
        build(showdown_rules=bad)


def test_legacy_missing_policy_has_advice_and_no_new_hard_rule():
    result = build(locked_captain_id="wa", excluded_player_ids=["qa"])
    assert result["ok"]
    assert result["showdown_rules"]["legacy_policy"] is True
    assert result["showdown_rules"]["receiver_captain_qb"] == "warn"
    assert result["build_snapshot"]["content"]["parameters"]["showdown_rules"] is None


@pytest.mark.parametrize("raw,normalized,inactive", [
    ("O", "Out", True), ("IR", "IR", True),
    ("Q", "Questionable", False), ("D", "Doubtful", False),
    (None, "Unknown", False),
])
def test_pool_status_variants_reach_solver_and_frozen_diagnostics(raw, normalized, inactive):
    pool = showdown_pool()
    pool["Injury Status"] = "Active"
    pool.loc[pool.player_id == "wa", "Injury Status"] = raw
    players = optimizer._players_from_pool(pool)
    if inactive:
        assert "wa" not in {player.player_id for player in players}
        unlocked = build(pool)
        assert unlocked["ok"] and "wa" not in ids(unlocked)
        # The existing explicit player-lock exception remains inspectable; it
        # is not current availability clearance or permission to export.
        result = build(pool, locked_player_ids=["wa"], locked_captain_id="wa")
        assert result["build_snapshot"]["content"]["parameters"]["locked_player_ids"] == ["wa"]
        assert any(finding["code"] == "selected_availability"
                   for finding in result["showdown_review"]["lineups"][0]["findings"])
    else:
        assert "wa" in {player.player_id for player in players}
        result = build(pool, locked_captain_id="wa", include_captain_comparison=True)
        candidate = next(row for row in result["captain_comparison"]["candidates"] if row["captain_id"] == "wa")
        assert candidate["status"] == "optimal"
        comparison_player = next(row for row in candidate["result"]["lineup"] if row["player_id"] == "wa")
        assert comparison_player["injury_status"] == normalized
        assert comparison_player["diagnostics"]["build_injury_status"] == normalized
    assert result["ok"]
    selected = next(row for row in result["lineup"] if row["player_id"] == "wa")
    assert selected["injury_status"] == normalized
    assert selected["diagnostics"]["build_injury_status"] == normalized
    saved = result["build_snapshot"]["content"]
    assert next(row for row in saved["input_pool"] if row["player_id"] == "wa")["Injury Status"] == raw
    assert next(row for row in saved["eligible_players"] if row["player_id"] == "wa")["diagnostics"]["build_injury_status"] == normalized


def test_pairing_is_independently_checked_after_generation():
    pool = showdown_pool()
    bad = build(showdown_rules=rules("warn"), locked_captain_id="wa", excluded_player_ids=["qa"])
    players = optimizer._players_from_pool(pool)
    resolved = resolve_showdown_rules(rules(), site="draftkings_showdown", players=players, pool=pool)
    checked = validate_generated_lineups(bad, players, site="draftkings_showdown", salary_cap=50000,
                                        locked_captain_id="wa", showdown_rules=resolved)
    assert not checked["ok"]
    assert "receiver_captain_qb_required" in {issue["code"] for issue in checked["validation"]["issues"]}


def test_pairing_and_real_milp_objective_match_exhaustive_search():
    pool = showdown_pool()
    result = build(pool, showdown_rules=rules(), objective="ceiling", locked_captain_id="wa", salary_cap=36000)
    records = pool.to_dict("records")
    captain = next(row for row in records if row["player_id"] == "wa")
    scores = [captain["High (P90)"] * 1.5 + sum(row["High (P90)"] for row in flex)
              for flex in combinations([row for row in records if row is not captain], 5)
              if "qa" in {row["player_id"] for row in flex}
              and captain["cpt_salary"] + sum(row["salary"] for row in flex) <= 36000
              and len({captain["Team"], *(row["Team"] for row in flex)}) == 2]
    assert result["ok"]
    assert result["objective_score"] == pytest.approx(max(scores))
    assert result["objective_label"] == "P90-input score"
    assert result["objective_score"] != result["projection_sum"]


@pytest.mark.parametrize("objective", ["median", "floor", "ceiling", "value"])
def test_captain_multiplier_and_shared_score_contract_applied_once(objective):
    result = build(showdown_rules=rules(), objective=objective, locked_captain_id="wa")
    captain = result["lineup"][0]
    assert captain["proj"] == 45 and captain["salary"] == 9000
    assert result["objective_score"] == pytest.approx(sum(row["objective_coefficient"] for row in result["lineup"]))
    assert result["projection_sum"] == pytest.approx(sum(row["projection_coefficient"] for row in result["lineup"]))
    assert (result["objective_units"] == "points_per_1000_salary_sum") == (objective == "value")


def test_qb_exposure_cap_can_cause_diagnosed_shortfall_without_pairing_exemption():
    result = build(showdown_rules=rules(), locked_captain_id="wa", lineup_count=4,
                   max_exposure=.5, max_overlap=6)
    assert result["ok"] and result["count"] == 2 and result["shortfall"] == 2
    assert result["shortfall_reason"]
    assert "receiver_captain_qb_exposure_exhausted" in {item["code"] for item in result["strategy_diagnostics"]}
    assert all("qa" in ids(entry) for entry in result["lineups"])
    assert "qa" not in result["exposure_basis"]["locks_exempt"]
    wa = next(row for row in result["exposure"] if row["player_id"] == "wa")
    assert wa["legacy_total_lock_exempt"] is True
    assert wa["count"] == wa["captain_count"] + wa["flex_count"]


def test_classic_rejects_showdown_strategy_instead_of_inheriting_rules():
    with pytest.raises(ValueError, match="single-game"):
        optimizer.optimize_from_pool_dataframe(showdown_pool(), site="draftkings", showdown_rules=rules())


def test_captain_cap_stays_binding_even_when_captain_is_locked():
    result = build(showdown_rules=rules(), locked_captain_id="wa", lineup_count=4,
                   captain_exposure_limits={"wa": .5}, max_overlap=6)
    assert result["ok"] and result["count"] == 2
    assert result["shortfall"] == 2
    assert not result["exposure_valid"]
    assert any(item["player_id"] == "wa" and item["scope"] == "captain"
               for item in result["exposure_violations"])


def test_existing_total_lock_exemption_is_explicit_for_a_locked_pairing_qb():
    result = build(showdown_rules=rules(), locked_captain_id="wa", locked_player_ids=["qa"],
                   lineup_count=4, max_exposure=.75, max_overlap=6)
    assert result["ok"]
    assert "qa" in result["exposure_basis"]["locks_exempt"]
    qb = next(row for row in result["exposure"] if row["player_id"] == "qa")
    assert qb["legacy_total_lock_exempt"]
    assert qb["count"] == result["count"]


def test_every_captain_comparison_keeps_pairing_and_reports_missing_map_infeasible():
    result = build(showdown_rules=rules(), include_captain_comparison=True)
    for candidate in result["captain_comparison"]["candidates"]:
        if candidate["status"] == "optimal" and candidate["result"]["lineup"][0]["team"] == "BUF":
            if candidate["result"]["lineup"][0]["position"] in {"WR", "TE"}:
                assert "qa" in ids(candidate["result"])
    assert result["captain_comparison"]["showdown_rules"] == result["showdown_rules"]


@pytest.mark.parametrize("slot", ["flex", "captain"])
def test_forced_player_comparison_is_frozen_deterministic_and_read_only(slot):
    pool = showdown_pool()
    before = pool.copy(deep=True)
    options = dict(showdown_rules=rules(), comparison_player_id="cheap", comparison_player_slot=slot)
    first, second = build(pool, **options), build(pool, **options)
    report = first["player_comparison"]
    assert report["snapshot_id"] == first["build_snapshot"]["id"]
    assert report["forced"]["status"] == "optimal"
    assert "cheap" in ids(report["forced"]["result"])
    captain = report["forced"]["result"]["lineup"][0]["player_id"]
    assert (captain == "cheap") == (slot == "captain")
    assert report == second["player_comparison"]
    pd.testing.assert_frame_equal(pool, before)
    assert first["lineup"] == report["baseline"]["result"]["lineup"]
    assert "cheap" in report["tradeoff"]["added_player_ids"]


@pytest.mark.parametrize("options", [
    {"excluded_player_ids": ["cheap"], "comparison_player_id": "cheap", "comparison_player_slot": "flex"},
    {"locked_captain_id": "wa", "comparison_player_id": "cheap", "comparison_player_slot": "captain"},
    {"locked_captain_id": "wa", "comparison_player_id": "wa", "comparison_player_slot": "flex"},
])
def test_forced_comparison_reports_conflicts_without_overriding_saved_controls(options):
    result = build(showdown_rules=rules(), **options)
    report = result["player_comparison"]
    assert report["forced"]["status"] == "conflict"
    assert report["tradeoff"] is None
    if options.get("locked_captain_id"):
        assert result["lineup"][0]["player_id"] == options["locked_captain_id"]


def test_forced_comparison_timeout_is_unresolved_not_infeasible(monkeypatch):
    real = optimizer.optimize_lineup
    def solve(*args, **kwargs):
        if kwargs.get("solver_time_limit") is not None:
            return {"ok": False, "solver_status": 1, "error": "Time limit"}
        return real(*args, **kwargs)
    monkeypatch.setattr(optimizer, "optimize_lineup", solve)
    report = build(comparison_player_id="cheap", comparison_player_slot="flex")["player_comparison"]
    assert not report["complete"]
    assert report["baseline"]["status"] == report["forced"]["status"] == "unresolved"


@pytest.mark.parametrize("options", [{"include_captain_comparison": True},
    {"comparison_player_id": "cheap", "comparison_player_slot": "flex"}])
def test_comparison_never_runs_an_unbounded_initial_solve(monkeypatch, options):
    calls = []
    def unresolved(_players, **solve_options):
        calls.append(solve_options)
        assert 0 < solve_options["solver_time_limit"] <= 1
        return {"ok": False, "solver_status": 1, "error": "Synthetic bounded timeout"}
    monkeypatch.setattr(optimizer, "optimize_lineup", unresolved)
    result = build(showdown_rules=rules(), **options)
    assert result["ok"] and result["comparison_only"] and result["lineup"] == []
    assert calls


def test_comparison_modes_cannot_double_the_declared_work_budget():
    with pytest.raises(ValueError, match="either Captain"):
        build(include_captain_comparison=True, comparison_player_id="cheap", comparison_player_slot="flex")


def test_frozen_explicit_zero_captain_cap_remains_an_exclusion_in_single_lineup_comparison():
    result = build(showdown_rules=rules(), comparison_player_id="wa", comparison_player_slot="captain",
                   snapshot_context={"original_captain_exclusions": ["wa"]})
    report = result["player_comparison"]
    assert report["baseline"]["status"] == "optimal"
    assert report["baseline"]["result"]["lineup"][0]["player_id"] != "wa"
    assert report["forced"]["status"] == "conflict"
    assert "Captain limit" in report["forced"]["reason"]


def test_forced_completion_preserves_minimum_salary_and_can_be_genuinely_infeasible():
    result = build(showdown_rules=rules(), min_salary=37000,
                   comparison_player_id="cheap", comparison_player_slot="flex")
    assert result["ok"]
    report = result["player_comparison"]
    assert report["baseline"]["status"] == "optimal"
    assert report["forced"]["status"] == "infeasible"
    assert report["forced"]["solver_status"] == 2
    assert report["tradeoff"] is None
    assert "cheap" not in ids(result)


@pytest.mark.parametrize("options", [{"comparison_player_id": "cheap"},
    {"comparison_player_slot": "flex"}, {"comparison_player_id": "cheap", "comparison_player_slot": "qb"},
    {"comparison_player_id": "cheap", "comparison_player_slot": "flex", "lineup_count": 2}])
def test_forced_comparison_rejects_ambiguous_or_portfolio_request(options):
    with pytest.raises(ValueError):
        build(**options)
