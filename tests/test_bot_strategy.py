"""Human-like snake/linear bot picks — delay QBs, K, DEF; VORP over raw points."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.bot_strategy import (
    ARCHETYPES,
    archetype_for_team,
    is_superflex,
    select_pick_draft_player,
)
from src.draft_hub.mock_draft import start_mock_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.rules_engine import count_at_position
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.test_draft import simulate_draft


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _team_id(archetype: str) -> str:
    for i in range(4000):
        tid = f"{archetype}-{i}"
        if archetype_for_team(tid) == archetype:
            return tid
    raise AssertionError(f"no team id for {archetype}")


def _row(pid: str, pos: str, proj: float, **extra) -> dict:
    return {
        "player_id": pid,
        "player": pid,
        "player_name": pid,
        "team": "KC",
        "position": pos,
        "season_proj": proj,
        "season_p50": proj,
        "fair_value": extra.pop("fair_value", max(1.0, proj / 10.0)),
        "source": "draft",
        "contract_years": 1,
        "salary": 0,
        **extra,
    }


def _ladder(pos: str, n: int, top: float, step: float) -> list[dict]:
    return [_row(f"{pos.lower()}-{i}", pos, top - i * step) for i in range(n)]


def _one_qb_pool() -> list[dict]:
    return (
        _ladder("QB", 16, 390, 12)
        + _ladder("RB", 28, 350, 9)
        + _ladder("WR", 32, 340, 8)
        + _ladder("TE", 14, 240, 12)
        + _ladder("K", 12, 145, 3)
        + _ladder("DEF", 12, 140, 3)
    )


def _session(round_n: int, team_count: int = 12) -> dict:
    order = [f"t{i}" for i in range(team_count)]
    return {
        "status": "picking",
        "nomination_order": order,
        "nominator_index": (round_n - 1) * team_count,
    }


def test_archetypes_cover_expected_names():
    assert "balanced" in ARCHETYPES
    assert "late_qb" in ARCHETYPES
    assert archetype_for_team(_team_id("early_qb")) == "early_qb"


def test_superflex_detects_qb_flex_and_two_qb():
    one_qb = load_preset("snake_draft_v1")
    assert is_superflex(one_qb) is False
    sf = one_qb.model_copy(deep=True)
    flex = dict(sf.roster["flex"])
    flex["eligible"] = ["QB", "RB", "WR", "TE"]
    sf.roster["flex"] = flex
    assert is_superflex(sf) is True
    two_qb = one_qb.model_copy(deep=True)
    two_qb.roster["qb"] = {**two_qb.roster["qb"], "starter": 2, "min": 2}
    assert is_superflex(two_qb) is True


def test_round_one_prefers_rb_or_wr_over_qb():
    rules = load_preset("snake_draft_v1")
    pool = _one_qb_pool()
    for arch in ARCHETYPES:
        pick = select_pick_draft_player(
            rules,
            [],
            pool,
            session=_session(1),
            team_id=_team_id(arch),
            team_count=12,
        )
        assert pick is not None, arch
        assert pick["position"] in {"RB", "WR", "TE"}, (arch, pick["player_id"], pick["position"])


def test_raw_points_bpa_would_take_qb_but_strategy_does_not():
    pool = _one_qb_pool()
    bpa = max(pool, key=lambda r: float(r["season_proj"]))
    assert bpa["position"] == "QB"
    pick = select_pick_draft_player(
        load_preset("snake_draft_v1"),
        [],
        pool,
        session=_session(1),
        team_id=_team_id("balanced"),
        team_count=12,
    )
    assert pick["position"] in {"RB", "WR", "TE"}
    assert pick["player_id"] != bpa["player_id"]


def test_starting_qb_is_prioritized_once_the_window_opens():
    rules = load_preset("snake_draft_v1")
    roster = [
        _row("rb-0", "RB", 350),
        _row("rb-1", "RB", 341),
        _row("wr-0", "WR", 340),
        _row("wr-1", "WR", 332),
        _row("te-0", "TE", 240),
        _row("wr-2", "WR", 324),
        _row("rb-2", "RB", 332),
        _row("wr-3", "WR", 316),
        _row("rb-3", "RB", 323),
    ]
    taken = {r["player_id"] for r in roster}
    pool = [row for row in _one_qb_pool() if row["player_id"] not in taken]
    pick = select_pick_draft_player(
        rules,
        roster,
        pool,
        session=_session(10),
        team_id=_team_id("balanced"),
        team_count=12,
    )
    assert pick["position"] == "QB"


def test_elite_qb_stays_off_the_board_in_round_one_even_with_early_qb():
    rules = load_preset("snake_draft_v1")
    pick = select_pick_draft_player(
        rules,
        [],
        _one_qb_pool(),
        session=_session(1),
        team_id=_team_id("early_qb"),
        team_count=12,
    )
    assert pick["position"] != "QB"


def test_superflex_can_take_qb_first():
    rules = load_preset("snake_draft_v1").model_copy(deep=True)
    flex = dict(rules.roster["flex"])
    flex["eligible"] = ["QB", "RB", "WR", "TE"]
    rules.roster["flex"] = flex
    pick = select_pick_draft_player(
        rules,
        [],
        _one_qb_pool(),
        session=_session(1),
        team_id=_team_id("early_qb"),
        team_count=12,
    )
    assert pick["position"] == "QB"


def test_k_and_def_not_selected_early():
    rules = load_preset("snake_draft_v1")
    pick = select_pick_draft_player(
        rules,
        [],
        _one_qb_pool(),
        session=_session(8),
        team_id=_team_id("balanced"),
        team_count=12,
    )
    assert pick["position"] not in {"K", "DEF"}


def test_backup_qb_waits_until_late_in_1qb():
    rules = load_preset("snake_draft_v1")
    roster = [_row("qb-owned", "QB", 360)]
    pick = select_pick_draft_player(
        rules,
        roster,
        _one_qb_pool(),
        session=_session(7),
        team_id=_team_id("balanced"),
        team_count=12,
    )
    assert pick["position"] != "QB"


def test_empty_te_starter_beats_fourth_wr():
    rules = load_preset("snake_draft_v1")
    roster = [
        _row("qb1", "QB", 300),
        _row("rb1", "RB", 250),
        _row("rb2", "RB", 230),
        _row("wr1", "WR", 280),
        _row("wr2", "WR", 260),
        _row("k1", "K", 120),
        _row("def1", "DEF", 110),
    ]
    pool = [
        _row("wr3", "WR", 280),
        _row("te1", "TE", 180),
        _row("te2", "TE", 170),
        _row("qb2", "QB", 300),
    ]
    pick = select_pick_draft_player(
        rules,
        roster,
        pool,
        session=_session(8, team_count=2),
        team_id=_team_id("balanced"),
        team_count=2,
    )
    assert pick["position"] == "TE"


def test_last_rounds_fill_k_and_def_mins():
    rules = load_preset("snake_draft_v1")
    roster = [
        _row("qb1", "QB", 300),
        _row("rb1", "RB", 250),
        _row("rb2", "RB", 240),
        _row("wr1", "WR", 260),
        _row("wr2", "WR", 250),
        _row("te1", "TE", 180),
        _row("rb3", "RB", 180),
        _row("wr3", "WR", 190),
        _row("wr4", "WR", 170),
        _row("rb4", "RB", 160),
        _row("te2", "TE", 140),
        _row("wr5", "WR", 150),
        _row("rb5", "RB", 140),
        _row("wr6", "WR", 130),
    ]
    pool = _ladder("WR", 8, 120, 5) + _ladder("K", 4, 145, 3) + _ladder("DEF", 4, 140, 3)
    pick = select_pick_draft_player(
        rules,
        roster,
        pool,
        session=_session(15),
        team_id=_team_id("balanced"),
        team_count=12,
    )
    assert pick["position"] in {"K", "DEF"}


def _stub_pool(monkeypatch, rows):
    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": rows},
    )


def test_simulated_snake_draft_looks_human(hub_db, monkeypatch):
    pool = _one_qb_pool()
    _stub_pool(monkeypatch, pool)
    out = start_mock_draft(
        "snake-bots",
        mode="quick_bots",
        bot_count=3,
        team_count=4,
        preset_id="snake_draft_v1",
        auto_start=True,
        season=2026,
    )
    state = simulate_draft(out["league_id"], "snake-bots")
    assert state["session"]["status"] == "completed"
    picks = [e for e in storage.list_draft_events(out["league_id"]) if e.get("event_type") == "pick"]
    assert len(picks) == 4 * 16

    round1 = [e["payload"]["position"] for e in picks[:4]]
    assert all(p in {"RB", "WR", "TE"} for p in round1), round1
    assert "QB" not in round1
    assert "K" not in round1 and "DEF" not in round1

    early_qb = [
        e["payload"]["position"]
        for e in picks[: 4 * 2]
    ]
    assert "QB" not in early_qb

    k_def_rounds = []
    for e in picks:
        payload = e["payload"]
        if payload.get("position") in {"K", "DEF"}:
            k_def_rounds.append(int(payload.get("round") or 0))
    assert k_def_rounds
    assert min(k_def_rounds) >= 14, k_def_rounds

    for team in storage.list_league_teams(out["league_id"]):
        roster = storage.list_team_roster(out["league_id"], team["id"])
        rules = LeagueRules.model_validate(storage.get_league(out["league_id"])["rules"])
        assert count_at_position(rules, roster, "QB") >= 1, team["name"]
        assert count_at_position(rules, roster, "RB") >= 2, team["name"]
        assert count_at_position(rules, roster, "TE") >= 1, team["name"]
        assert count_at_position(rules, roster, "WR") >= 2, team["name"]
        assert count_at_position(rules, roster, "K") >= 1, team["name"]
        assert count_at_position(rules, roster, "DEF") >= 1, team["name"]
