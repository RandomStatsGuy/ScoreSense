"""SCORE-6 Personalized Weekly Hub Command Center — unit + API payload tests."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.presets import load_preset
from src.draft_hub.weekly_command_center import (
    build_lineup_decisions,
    build_weekly_command_center,
    infer_starters_and_bench,
)


def _pool(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


WR_POOL = _pool(
    [
        {
            "Player": "WR Ace",
            "Projected Points": 18.0,
            "Low (P10)": 8.0,
            "High (P90)": 28.0,
            "Team": "MIA",
            "Opponent": "NE",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-ace",
            "Position": "WR",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "WR Co",
            "Projected Points": 17.0,
            "Low (P10)": 7.0,
            "High (P90)": 26.0,
            "Team": "KC",
            "Opponent": "DEN",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-co",
            "Position": "WR",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "Garrett Wilson",
            "Projected Points": 16.4,
            "Low (P10)": 6.0,
            "High (P90)": 28.0,
            "Team": "NYJ",
            "Opponent": "BUF",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-wilson",
            "Position": "WR",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "Volatile WR",
            "Projected Points": 12.0,
            "Low (P10)": 2.0,
            "High (P90)": 30.0,
            "Team": "CIN",
            "Opponent": "BAL",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-volatile",
            "Position": "WR",
            "Injury Status": "",
            "Injury Note": "",
        },
    ]
)

RB_POOL = _pool(
    [
        {
            "Player": "RB Starter",
            "Projected Points": 17.0,
            "Low (P10)": 8.0,
            "High (P90)": 26.0,
            "Team": "SF",
            "Opponent": "SEA",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-starter",
            "Position": "RB",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "RB Two",
            "Projected Points": 15.5,
            "Low (P10)": 7.0,
            "High (P90)": 24.0,
            "Team": "DET",
            "Opponent": "CHI",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-two",
            "Position": "RB",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "RB Flex",
            "Projected Points": 14.0,
            "Low (P10)": 6.0,
            "High (P90)": 22.0,
            "Team": "PHI",
            "Opponent": "DAL",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-flex",
            "Position": "RB",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "RB Bye",
            "Projected Points": 10.0,
            "Low (P10)": 4.0,
            "High (P90)": 18.0,
            "Team": "GB",
            "Opponent": "BYE",
            "Week": 1,
            "Season": 2026,
            "player_id": "rb-bye",
            "Position": "RB",
            "Injury Status": "",
            "Injury Note": "",
        },
    ]
)

QB_POOL = _pool(
    [
        {
            "Player": "Jordan Love",
            "Projected Points": 19.5,
            "Low (P10)": 12.0,
            "High (P90)": 28.0,
            "Team": "GB",
            "Opponent": "CHI",
            "Week": 1,
            "Season": 2026,
            "player_id": "qb-love",
            "Position": "QB",
            "Injury Status": "",
            "Injury Note": "",
        },
        {
            "Player": "Backup QB",
            "Projected Points": 12.0,
            "Low (P10)": 6.0,
            "High (P90)": 20.0,
            "Team": "NYJ",
            "Opponent": "BUF",
            "Week": 1,
            "Season": 2026,
            "player_id": "qb-backup",
            "Position": "QB",
            "Injury Status": "Out",
            "Injury Note": "",
        },
    ]
)


def _fake_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True):
    assert allow_compute is False, "command center must not live-compute weekly projections"
    pos = str(position).lower()
    if pos == "wr":
        df = WR_POOL.copy()
    elif pos == "rb":
        df = RB_POOL.copy()
    elif pos == "qb":
        df = QB_POOL.copy()
    else:
        return pd.DataFrame()
    df.attrs["built_at"] = "2026-08-13T12:00:00+00:00"
    return df


def _empty_load(position, season=None, week=None, apply_injury_adjustments=True, allow_compute=True):
    return pd.DataFrame()


def _client_for(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _seed_league_roster(hub_db):
    comm = "week-comm"
    ws = storage.get_or_create_workspace(comm, season=2026)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Week League", 2026, rules, workspace_id=ws["id"])
    team = storage.get_team_by_user(league["id"], comm)
    storage.update_league_sleeper_id(league["id"], "sleeper-league-1")
    storage.update_team_sleeper_link(
        team["id"],
        sleeper_roster_id="1",
        sleeper_team_name="Comm Team",
        sleeper_player_ids=[
            "wr-wilson",
            "wr-ace",
            "wr-co",
            "rb-starter",
            "rb-two",
            "rb-flex",
            "qb-love",
            "te-none",
        ],
    )
    roster_ws = storage.roster_workspace_for_league(league)
    slots = [
        ("wr-ace", "WR Ace", "MIA", "WR", 45),
        ("wr-co", "WR Co", "KC", "WR", 38),
        # Cheaper than FLEX RB so salary-based inference leaves Wilson on bench.
        ("wr-wilson", "Garrett Wilson", "NYJ", "WR", 20),
        ("wr-volatile", "Volatile WR", "CIN", "WR", 18),
        ("rb-starter", "RB Starter", "SF", "RB", 35),
        ("rb-two", "RB Two", "DET", "RB", 28),
        ("rb-flex", "RB Flex", "PHI", "RB", 22),
        ("rb-bye", "RB Bye", "GB", "RB", 10),
        ("qb-love", "Jordan Love", "GB", "QB", 25),
        ("qb-backup", "Backup QB", "NYJ", "QB", 5),
        ("te-none", "TE Missing", "DAL", "TE", 8),
    ]
    for pid, name, team_code, pos, salary in slots:
        storage.add_roster_slot(
            roster_ws,
            {
                "player_id": pid,
                "player_name": name,
                "team": team_code,
                "position": pos,
                "salary": salary,
                "contract_years": 2,
            },
            team_id=team["id"],
        )
    return league, team, ws, comm


def test_infer_starters_fills_rules_slots():
    rules = load_preset("salary_cap_auction_v1")
    players = [
        {"player_id": "qb1", "position": "QB", "salary": 30, "p50": 20.0, "p90": 28.0, "has_projection": True},
        {"player_id": "qb2", "position": "QB", "salary": 5, "p50": 10.0, "p90": 16.0, "has_projection": True},
        {"player_id": "rb1", "position": "RB", "salary": 40, "p50": 15.0, "p90": 22.0, "has_projection": True},
        {"player_id": "rb2", "position": "RB", "salary": 25, "p50": 12.0, "p90": 20.0, "has_projection": True},
        {"player_id": "rb3", "position": "RB", "salary": 18, "p50": 11.0, "p90": 18.0, "has_projection": True},
        {"player_id": "wr1", "position": "WR", "salary": 35, "p50": 16.0, "p90": 26.0, "has_projection": True},
        {"player_id": "wr2", "position": "WR", "salary": 8, "p50": 9.0, "p90": 15.0, "has_projection": True},
        {"player_id": "wr3", "position": "WR", "salary": 22, "p50": 14.0, "p90": 24.0, "has_projection": True},
        {"player_id": "te1", "position": "TE", "salary": 12, "p50": 8.0, "p90": 14.0, "has_projection": True},
    ]
    starters, bench = infer_starters_and_bench(players, rules)
    slots = {s["slot"] for s in starters}
    assert "QB" in slots
    assert "RB1" in slots and "RB2" in slots
    assert "WR1" in slots and "WR2" in slots
    assert "TE" in slots
    assert "FLEX" in slots
    # Salary-desc: WR1=wr1(35), WR2=wr3(22); FLEX leftover max salary is rb3(18).
    flex = next(s for s in starters if s["slot"] == "FLEX")
    assert flex["player_id"] == "rb3"
    assert {b["player_id"] for b in bench} == {"qb2", "wr2"}


def test_bench_over_starter_decision():
    starters = [
        {
            "player_id": "wr-quiet",
            "player_name": "Quiet WR",
            "position": "WR",
            "slot": "WR2",
            "p50": 8.0,
            "p10": 3.0,
            "has_projection": True,
            "volatility": 0.4,
        }
    ]
    bench = [
        {
            "player_id": "wr-wilson",
            "player_name": "Garrett Wilson",
            "position": "WR",
            "slot": "BN",
            "p50": 16.4,
            "p10": 6.0,
            "has_projection": True,
            "volatility": 0.67,
        }
    ]
    decisions = build_lineup_decisions(starters, bench, threshold=2.0)
    assert len(decisions) == 1
    assert decisions[0]["type"] == "bench_over_starter"
    assert decisions[0]["delta_p50"] == pytest.approx(8.4)
    assert "Garrett Wilson" in decisions[0]["message"]
    assert "bench_p50_above_threshold" in decisions[0]["reasons"]


def test_no_illegal_flex_swap_onto_te_or_rb_slot():
    starters = [
        {
            "player_id": "te-start",
            "player_name": "TE Starter",
            "position": "TE",
            "slot": "TE",
            "p50": None,
            "has_projection": False,
        },
        {
            "player_id": "rb-start",
            "player_name": "RB Starter",
            "position": "RB",
            "slot": "RB2",
            "p50": 8.0,
            "p10": 3.0,
            "has_projection": True,
            "volatility": 0.3,
        },
        {
            "player_id": "flex-start",
            "player_name": "FLEX RB",
            "position": "RB",
            "slot": "FLEX",
            "p50": 8.0,
            "p10": 3.0,
            "has_projection": True,
            "volatility": 0.3,
        },
    ]
    bench = [
        {
            "player_id": "wr-bench",
            "player_name": "Bench WR",
            "position": "WR",
            "slot": "BN",
            "p50": 16.0,
            "p10": 7.0,
            "has_projection": True,
            "volatility": 0.4,
        }
    ]
    decisions = build_lineup_decisions(starters, bench, threshold=2.0)
    assert [d["starter_slot"] for d in decisions] == ["FLEX"]
    assert decisions[0]["bench_player_id"] == "wr-bench"


def test_bye_and_injured_bench_not_recommended():
    starters = [
        {
            "player_id": "wr-start",
            "player_name": "Healthy WR",
            "position": "WR",
            "slot": "WR2",
            "p50": 10.0,
            "p10": 4.0,
            "has_projection": True,
            "volatility": 0.4,
            "on_bye": False,
            "injured": False,
        }
    ]
    bench = [
        {
            "player_id": "wr-bye",
            "player_name": "Bye WR",
            "position": "WR",
            "slot": "BN",
            "p50": 20.0,
            "p10": 8.0,
            "has_projection": True,
            "volatility": 0.4,
            "on_bye": True,
            "injured": False,
        },
        {
            "player_id": "wr-out",
            "player_name": "Out WR",
            "position": "WR",
            "slot": "BN",
            "p50": 19.0,
            "p10": 8.0,
            "has_projection": True,
            "volatility": 0.4,
            "on_bye": False,
            "injured": True,
        },
    ]
    decisions = build_lineup_decisions(starters, bench, threshold=2.0)
    assert decisions == []


def test_one_decision_per_bench_player():
    starters = [
        {
            "player_id": "wr1",
            "player_name": "WR1",
            "position": "WR",
            "slot": "WR1",
            "p50": 10.0,
            "p10": 4.0,
            "has_projection": True,
            "volatility": 0.3,
        },
        {
            "player_id": "wr2",
            "player_name": "WR2",
            "position": "WR",
            "slot": "WR2",
            "p50": 8.0,
            "p10": 3.0,
            "has_projection": True,
            "volatility": 0.3,
        },
    ]
    bench = [
        {
            "player_id": "wr-bench",
            "player_name": "Bench WR",
            "position": "WR",
            "slot": "BN",
            "p50": 20.0,
            "p10": 9.0,
            "has_projection": True,
            "volatility": 0.4,
        }
    ]
    decisions = build_lineup_decisions(starters, bench, threshold=2.0)
    assert len(decisions) == 1
    assert decisions[0]["bench_player_id"] == "wr-bench"
    assert decisions[0]["starter_player_id"] == "wr2"


def test_build_command_center_payload(hub_db):
    league, team, ws, comm = _seed_league_roster(hub_db)
    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context(comm)
    with patch(
        "src.draft_hub.weekly_command_center.load_weekly_prediction",
        side_effect=_fake_load,
    ), patch(
        "src.draft_hub.weekly_command_center.resolve_week_context",
        return_value=(2026, 1),
    ):
        payload = build_weekly_command_center(ctx, season=2026, week=1)

    assert payload["meta"]["season"] == 2026
    assert payload["meta"]["week"] == 1
    assert payload["meta"]["projections_available"] is True
    assert payload["meta"]["persists_projections"] is False
    assert payload["sync"]["linked"] is True
    assert payload["sync"]["sleeper_synced_at"]
    assert payload["sync"]["sync_endpoint"] == f"/api/hub/league/{league['id']}/sleeper/sync"
    assert payload["counts"]["roster"] == 11
    assert payload["counts"]["starters"] >= 6
    assert payload["counts"]["decisions"] >= 1
    # Ace/Co lock WR slots and RBs fill FLEX, so Wilson (16.4) is on the bench
    # and projects +2.4 above the current FLEX — ticket-style decision.
    wilson_decision = next(
        d
        for d in payload["decisions"]
        if d["bench_player_id"] == "wr-wilson" and d["type"] == "bench_over_starter"
    )
    assert wilson_decision["starter_player_id"] == "rb-flex"
    assert wilson_decision["starter_slot"] == "FLEX"
    assert wilson_decision["delta_p50"] == pytest.approx(2.4)
    assert "Garrett Wilson" in wilson_decision["message"]
    assert "FLEX" in wilson_decision["message"]
    assert any(p["player_id"] == "rb-bye" for p in payload["roster"]["on_bye"])
    assert any(p["player_id"] == "qb-backup" for p in payload["roster"]["injured"])
    assert any(p["player_id"] == "te-none" for p in payload["roster"]["missing_projections"])
    assert any(r["player_id"] == "wr-volatile" for r in payload["wide_ranges"])
    assert payload["projection_changes"]["available"] is False
    assert "lineup decision" in payload["summary"]["headline"]


def test_missing_artifacts_graceful(hub_db):
    _seed_league_roster(hub_db)
    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context("week-comm")
    with patch(
        "src.draft_hub.weekly_command_center.load_weekly_prediction",
        side_effect=_empty_load,
    ), patch(
        "src.draft_hub.weekly_command_center.resolve_week_context",
        return_value=(2026, 1),
    ):
        payload = build_weekly_command_center(ctx, season=2026, week=1)

    assert payload["meta"]["projections_available"] is False
    assert payload["status"]["projections_missing"] is True
    assert payload["counts"]["roster"] == 11
    assert payload["counts"]["missing_projections"] == 11


def test_empty_roster_unlinked_solo(hub_db):
    sub = "solo-empty"
    storage.get_or_create_workspace(sub, season=2026)
    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context(sub)
    with patch(
        "src.draft_hub.weekly_command_center.load_weekly_prediction",
        side_effect=_empty_load,
    ), patch(
        "src.draft_hub.weekly_command_center.resolve_week_context",
        return_value=(2026, 1),
    ):
        payload = build_weekly_command_center(ctx, season=2026, week=1)

    assert payload["status"]["empty_roster"] is True
    assert payload["status"]["unlinked_league"] is True
    assert payload["counts"]["decisions"] == 0
    assert payload["sync"]["sync_endpoint"] == "/api/hub/sleeper/sync"


def test_api_hub_week_endpoint(hub_db):
    league, team, ws, comm = _seed_league_roster(hub_db)
    client = _client_for(comm)
    try:
        with patch(
            "src.draft_hub.weekly_command_center.load_weekly_prediction",
            side_effect=_fake_load,
        ), patch(
            "src.draft_hub.weekly_command_center.resolve_week_context",
            return_value=(2026, 1),
        ), patch(
            "src.draft_hub.league_sleeper_sync.compose_team_roster_from_live_snapshot",
        ) as live_sleeper:
            res = client.get("/api/hub/week", params={"season": 2026, "week": 1})
            assert res.status_code == 200
            data = res.json()
            assert data["meta"]["week"] == 1
            assert data["hub_context"]["league_id"] == league["id"]
            assert data["counts"]["decisions"] >= 1
            assert data["sync"]["linked"] is True
            live_sleeper.assert_not_called()
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_health_feature_flag():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["features"]["weekly_command_center"] is True


def test_list_roster_for_context_not_called_with_live_sleeper(hub_db):
    _seed_league_roster(hub_db)
    from src.draft_hub.hub_context import resolve_hub_context

    ctx = resolve_hub_context("week-comm")
    with patch(
        "src.draft_hub.weekly_command_center.list_roster_for_context",
        return_value=[],
    ) as roster_fn, patch(
        "src.draft_hub.weekly_command_center.load_weekly_prediction",
        side_effect=_empty_load,
    ), patch(
        "src.draft_hub.weekly_command_center.resolve_week_context",
        return_value=(2026, 1),
    ):
        build_weekly_command_center(ctx, season=2026, week=1)
    roster_fn.assert_called_once()
    assert roster_fn.call_args.kwargs.get("live_sleeper") is False
