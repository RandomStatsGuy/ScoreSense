"""Explicit synthetic Classic constructions; no role or forecast claims."""
import pandas as pd
import pytest

from src.products.dfs_stack_rules import normalize_classic_stack_rules, audit_classic_stack
from src.products.lineup_optimizer import optimize_from_pool_dataframe


def rules(attachment="optional", attachment_count=0, bring_back="optional", bring_count=0, rbs=()):
    return {"version": 1, "attachments": {"mode": attachment, "count": attachment_count,
        "receiving_rb_ids": list(rbs)}, "bring_back": {"mode": bring_back, "count": bring_count}}


def pool():
    rows = []
    for position, count, score in [("QB", 4, 25), ("RB", 10, 20), ("WR", 14, 19), ("TE", 7, 15), ("DST", 4, 9)]:
        for i in range(count):
            team = ["BUF", "NYJ", "MIA", "NE"][i % 4]
            rows.append({"player_id": f"{position}{i}", "Player": f"Synthetic {position}{i}",
                "Position": position, "Team": team,
                "Opponent": {"BUF": "NYJ", "NYJ": "BUF", "MIA": "NE", "NE": "MIA"}[team],
                "salary": 4500, "dfs_id": str(20000+len(rows)), "Projected Points": score-i*.3,
                "Low (P10)": score-5-i*.3, "High (P90)": score+6-i*.3})
    return pd.DataFrame(rows)


def build(stack_rules, **kwargs):
    return optimize_from_pool_dataframe(pool(), site="draftkings", portfolio_mode="global",
        lineup_count=1, max_overlap=8, locked_player_ids=kwargs.pop("locked_player_ids", ["QB0"]),
        classic_stack_rules=stack_rules, **kwargs)


@pytest.mark.parametrize("mode,count,lower,upper", [
    ("minimum", 1, 1, 7), ("maximum", 1, 0, 1), ("exact", 1, 1, 1),
    ("optional", 0, 0, 7), ("forbidden", 0, 0, 0),
])
def test_all_attachment_modes_generate_and_audit(mode, count, lower, upper):
    result = build(rules(mode, count))
    assert result["ok"] and result["validation"]["ok"]
    audit = result["portfolio_selection"]["stack_audit"][0]
    assert audit["ok"]
    assert lower <= audit["attachments"]["actual_count"] <= upper
    assert result["build_snapshot"]["content"]["parameters"]["classic_stack_rules"] == rules(mode, count)


@pytest.mark.parametrize("mode,count,lower,upper", [
    ("minimum", 1, 1, 7), ("maximum", 1, 0, 1), ("exact", 1, 1, 1),
    ("optional", 0, 0, 7), ("forbidden", 0, 0, 0),
])
def test_all_bring_back_modes_generate_and_audit(mode, count, lower, upper):
    result = build(rules(bring_back=mode, bring_count=count))
    assert result["ok"]
    audit = result["portfolio_selection"]["stack_audit"][0]
    assert audit["ok"] and lower <= audit["bring_back"]["actual_count"] <= upper


def test_locked_receiver_and_opponent_each_satisfy_exact_one_without_another():
    result = build(rules("exact", 1, "exact", 1), locked_player_ids=["QB0", "WR0", "RB1"])
    assert result["ok"]
    audit = result["portfolio_selection"]["stack_audit"][0]
    assert audit["attachments"]["player_ids"] == ["WR0"]
    assert audit["bring_back"]["player_ids"] == ["RB1"]


def test_unknown_selected_receiver_team_cannot_pass_forbidden_membership():
    from src.products.lineup_optimizer import _players_from_pool
    frame = pool()
    frame.loc[frame.player_id == "WR0", "Team"] = ""
    audit = audit_classic_stack({"lineup": [{"player_id": "QB0"}, {"player_id": "WR0"}]},
        _players_from_pool(frame), rules("forbidden"))
    assert not audit["ok"] and "attachments_unknown_relationship" in audit["issues"]


@pytest.mark.parametrize("qb_team,opponent", [("", "NYJ"), ("BUF", "BUF")])
def test_bring_back_needs_distinct_known_qb_and_opponent_teams(qb_team, opponent):
    from src.products.lineup_optimizer import _players_from_pool
    frame = pool()
    frame.loc[frame.player_id == "QB0", ["Team", "Opponent"]] = [qb_team, opponent]
    ids = ["QB0", "RB1" if opponent == "NYJ" else "RB0"]
    audit = audit_classic_stack({"lineup": [{"player_id": pid} for pid in ids]},
        _players_from_pool(frame), rules(bring_back="exact", bring_count=1))
    assert not audit["ok"] and "bring_back_unknown_relationship" in audit["issues"]


def test_only_explicitly_declared_receiving_rb_qualifies():
    from src.products.lineup_optimizer import _players_from_pool
    players = _players_from_pool(pool())
    lineup = {"lineup": [{"player_id": pid} for pid in ["QB0", "RB0", "DST1"]]}
    unknown_rb = audit_classic_stack(lineup, players, rules("exact", 1))
    approved_rb = audit_classic_stack(lineup, players, rules("exact", 1, rbs=["RB0"]))
    assert not unknown_rb["ok"] and approved_rb["ok"]
    assert approved_rb["attachments"]["player_ids"] == ["RB0"]
    assert approved_rb["bring_back"]["actual_count"] == 0  # opposing DST never counts
    result = build(rules("exact", 1, rbs=["RB0"]), locked_player_ids=["QB0", "RB0"])
    assert result["ok"] and result["portfolio_selection"]["stack_audit"][0]["attachments"]["player_ids"] == ["RB0"]


@pytest.mark.parametrize("invalid", [
    {"version": 2}, {"version": True}, {"version": 1, "unexpected": 1},
    rules("exact", 1.2), rules("optional", 1), rules("forbidden", 1),
    rules("minimum", True), rules("unknown", 1), rules(rbs=["RB0", "RB0"]),
    rules(rbs=["x"*101]),
])
def test_invalid_native_rules_reject(invalid):
    with pytest.raises(ValueError):
        normalize_classic_stack_rules(invalid)


@pytest.mark.parametrize("pid", ["missing", "WR0"])
def test_declared_receiving_rb_must_be_an_eligible_rb(pid):
    with pytest.raises(ValueError, match="eligible RB"):
        build(rules(rbs=[pid]))


@pytest.mark.parametrize("mode,count", [("minimum", 1), ("maximum", 1), ("exact", 1), ("forbidden", 0)])
def test_unknown_opponent_never_passes_constrained_bring_back(mode, count):
    frame = pool()
    frame.loc[frame.player_id == "QB0", "Opponent"] = ""
    result = optimize_from_pool_dataframe(frame, site="draftkings", portfolio_mode="global", lineup_count=1,
        locked_player_ids=["QB0"], block_qb_opposing_dst=False,
        classic_stack_rules=rules(bring_back=mode, bring_count=count))
    assert not result["ok"]
    assert "unknown" in result["error"].lower()


def test_forbidden_stack_conflicts_with_locked_receiver_without_relaxation():
    result = build(rules("forbidden"), locked_player_ids=["QB0", "WR0"])
    assert not result["ok"] and result["count"] == 0
    assert result["portfolio_selection"]["solver_status"] == "constraint_conflict"


def test_independent_audit_rejects_candidate_that_ignored_stack_rule(monkeypatch):
    from src.products import lineup_optimizer as optimizer
    from src.products import dfs_portfolio_selection as selection
    frame = pool()
    invalid = optimizer.optimize_from_pool_dataframe(frame, site="draftkings", locked_player_ids=["QB0", "WR0", "TE0"])
    assert invalid["ok"]
    monkeypatch.setattr(optimizer, "optimize_lineup", lambda *a, **k: invalid)
    monkeypatch.setattr(selection, "GENERATION_SECONDS", .05)
    result = build(rules("exact", 1))
    assert not result["ok"]
    assert not result["portfolio_selection"]["stack_audit"][0]["ok"]


def test_native_rules_are_global_classic_only_and_legacy_mixing_rejects():
    with pytest.raises(ValueError, match="global"):
        optimize_from_pool_dataframe(pool(), site="draftkings", classic_stack_rules=rules())
    with pytest.raises(ValueError, match="legacy"):
        build(rules("exact", 1), qb_stack_count=1)


def test_api_rejects_malformed_rules_before_fetching_pool(monkeypatch):
    import app.api as api
    from fastapi import HTTPException
    monkeypatch.setattr(api, "build_lineup_pool", lambda **k: pytest.fail("Invalid rules must not fetch forecasts"))
    with pytest.raises(HTTPException) as error:
        api.lineup_optimize(api.LineupOptimizeRequest(site="draftkings", portfolio_mode="global",
            classic_stack_rules=rules("exact", -1)), {})
    assert error.value.status_code == 400


def test_api_preserves_native_rules_and_receiving_rb_pool_identity(monkeypatch):
    import app.api as api
    seen = {}
    def load_pool(**kwargs):
        seen.update(kwargs)
        return pool(), {"season": 2026, "week": 1}
    monkeypatch.setattr(api, "build_lineup_pool", load_pool)
    stack_rules = rules("exact", 1, rbs=["RB0"])
    result = api.lineup_optimize(api.LineupOptimizeRequest(site="draftkings", portfolio_mode="global",
        lineup_count=1, max_overlap=8, classic_stack_rules=stack_rules), {})
    assert result["ok"] and "RB0" in seen["keep_player_ids"]
    assert result["build_snapshot"]["content"]["parameters"]["classic_stack_rules"] == stack_rules
    assert result["portfolio_selection"]["stack_audit"][0]["ok"]


def test_positive_pair_cap_gets_candidates_that_omit_the_core():
    result = optimize_from_pool_dataframe(pool(), site="draftkings", portfolio_mode="global", lineup_count=6,
        max_overlap=8, classic_stack_rules=rules("minimum", 1), seed=5,
        group_exposure_limits=[{"id": "rb-core", "player_ids": ["RB0", "RB1"],
            "min": {"count": 2}, "max": {"count": 2}}])
    assert result["ok"] and result["count"] == 6
    assert sum({"RB0", "RB1"}.issubset({row["player_id"] for row in entry["lineup"]}) for entry in result["lineups"]) == 2
    assert result["portfolio_selection"]["generation"]["group_omission_attempts"] > 0
