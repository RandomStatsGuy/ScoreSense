"""TE label preservation, nomination pool, picks, bots, and stale artifacts."""

from __future__ import annotations

import json
from unittest.mock import patch

import pandas as pd
import pytest

from src.draft_hub import draft_pool_cache, storage
from src.draft_hub.draft_pool import build_nomination_pool
from src.draft_hub.draft_state import make_pick, start_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.rules_engine import roster_capacity
from src.draft_hub.test_draft import maybe_bot_pick, setup_test_draft
from src.draft_hub.value_sheet import build_draft_pool_payload, invalidate_pool_payload_cache


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def _clear_pool_cache():
    draft_pool_cache.invalidate_pool_cache()
    invalidate_pool_payload_cache()
    yield
    draft_pool_cache.invalidate_pool_cache()
    invalidate_pool_payload_cache()


def _te_pool_rows():
    return [
        {"player_id": "qb1", "player": "Alpha QB", "player_name": "Alpha QB", "position": "QB", "team": "KC", "season_proj": 300, "season_p10": 240, "season_p50": 300, "season_p90": 360, "fair_value": 40},
        {"player_id": "rb1", "player": "Alpha RB", "player_name": "Alpha RB", "position": "RB", "team": "SF", "season_proj": 250, "season_p10": 200, "season_p50": 250, "season_p90": 300, "fair_value": 35},
        {"player_id": "wr1", "player": "Alpha WR", "player_name": "Alpha WR", "position": "WR", "team": "LAR", "season_proj": 280, "season_p10": 220, "season_p50": 280, "season_p90": 340, "fair_value": 38},
        {"player_id": "te1", "player": "Kyle Pitts", "player_name": "Kyle Pitts", "position": "TE", "team": "ATL", "season_proj": 180, "season_p10": 140, "season_p50": 180, "season_p90": 220, "fair_value": 18},
        {"player_id": "te2", "player": "Trey McBride", "player_name": "Trey McBride", "position": "TE", "team": "ARI", "season_proj": 190, "season_p10": 150, "season_p50": 190, "season_p90": 230, "fair_value": 20},
        {"player_id": "k1", "player": "Alpha K", "player_name": "Alpha K", "position": "K", "team": "BAL", "season_proj": 120, "season_p10": 90, "season_p50": 120, "season_p90": 140, "fair_value": 2},
        {"player_id": "def1", "player": "Alpha DEF", "player_name": "Alpha DEF", "position": "DEF", "team": "PIT", "season_proj": 110, "season_p10": 80, "season_p50": 110, "season_p90": 140, "fair_value": 2},
    ]


def _league(sub, *, team_count=2):
    rules = load_preset("snake_draft_v1")
    return storage.create_league(sub, "TE League", 2026, rules, team_count=team_count, test_mode=True)


def test_compute_pool_preserves_te_from_capital_position(monkeypatch):
    def fake_predict(pos, season=2026):
        if pos == "qb":
            return pd.DataFrame({"player_id": ["q1"], "Player": ["QB1"], "Season Proj": [400.0]})
        if pos == "rb":
            return pd.DataFrame({"player_id": ["r1"], "Player": ["RB1"], "Season Proj": [250.0]})
        if pos == "wr":
            return pd.DataFrame(
                {
                    "player_id": ["00-0036970", "w1", "rec1"],
                    "Player": ["Kyle Pitts", "Alpha WR", "Slot REC"],
                    "Position": ["TE", "WR", "REC"],
                    "Season Proj": [180.0, 300.0, 210.0],
                }
            )
        return pd.DataFrame()

    with patch("src.draft_hub.draft_pool_cache.predict_draft_season", side_effect=fake_predict):
        pool, sidecar = draft_pool_cache._compute_pool(2026)

    by_id = pool.set_index("player_id")["Position"].to_dict()
    assert by_id["00-0036970"] == "TE"
    assert by_id["w1"] == "WR"
    assert by_id["rec1"] == "WR"
    assert sidecar["position_counts"]["TE"] == 1
    assert sidecar["position_counts"]["WR"] == 2


def test_preserve_wr_te_does_not_collapse_te():
    df = pd.DataFrame({"Position": ["TE", "WR", "REC", "DST"]})
    out = draft_pool_cache._preserve_wr_te_labels(df)
    assert out.tolist() == ["TE", "WR", "WR", "WR"]


def test_position_counts_normalizes_def_and_rec():
    pool = pd.DataFrame({"Position": ["QB", "WR", "TE", "TE", "DST", "D", "REC"]})
    counts = draft_pool_cache.position_counts(pool)
    assert counts["TE"] == 2
    assert counts["WR"] == 2
    assert counts["DEF"] == 2
    assert counts["QB"] == 1


def test_zero_te_legacy_artifact_rebuilds(monkeypatch, tmp_path):
    season = 2026
    pool_dir = tmp_path / "pool"
    monkeypatch.setattr(draft_pool_cache, "DRAFT_POOL_DIR", pool_dir)
    monkeypatch.setattr(draft_pool_cache, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(draft_pool_cache, "MODEL_DIR", tmp_path)

    stale = pd.DataFrame(
        {"player_id": ["w1", "w2"], "Player": ["A", "B"], "Position": ["WR", "WR"]}
    )
    draft_pool_cache.save_pool_artifact(season, stale)
    _, meta_path = draft_pool_cache._artifact_paths(season)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["pos_logic"] = "legacy_all_wr"
    meta["position_counts"] = {"QB": 0, "RB": 0, "WR": 2, "TE": 0, "K": 0, "DEF": 0}
    meta["missing_tight_ends"] = True
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    draft_pool_cache.invalidate_pool_cache(season)

    rebuilt = pd.DataFrame(
        {"player_id": ["te1", "w1"], "Player": ["Pitts", "Puka"], "Position": ["TE", "WR"]}
    )
    with patch.object(draft_pool_cache, "_compute_pool", return_value=(rebuilt, {"pos_logic": "wr_te_v1"})):
        loaded = draft_pool_cache.load_draft_pool(season)

    assert set(loaded["Position"]) == {"TE", "WR"}
    assert int((loaded["Position"] == "TE").sum()) == 1


def test_pos_logic_version_changes_fingerprint(monkeypatch, tmp_path):
    monkeypatch.setattr(draft_pool_cache, "PROCESSED_DATA_DIR", tmp_path)
    monkeypatch.setattr(draft_pool_cache, "MODEL_DIR", tmp_path)
    fp1 = draft_pool_cache.pool_fingerprint()
    monkeypatch.setattr(draft_pool_cache, "POSITION_LOGIC_VERSION", "wr_te_v9")
    fp2 = draft_pool_cache.pool_fingerprint()
    assert fp1 != fp2


def test_pool_payload_includes_te_rows_and_counts(monkeypatch):
    pool = pd.DataFrame(
        {
            "player_id": ["w1", "te1", "q1"],
            "Player": ["Puka", "Pitts", "Mahomes"],
            "Team": ["LAR", "ATL", "KC"],
            "Position": ["WR", "TE", "QB"],
            "Season Proj": [300.0, 180.0, 400.0],
            "Season P10": [240.0, 140.0, 320.0],
            "Season P50": [300.0, 180.0, 400.0],
            "Season P90": [360.0, 220.0, 480.0],
        }
    )
    monkeypatch.setattr("src.draft_hub.value_sheet.load_draft_pool", lambda season, **k: pool)
    monkeypatch.setattr("src.draft_hub.value_sheet.load_k_def_rows", lambda *a, **k: [])
    rules = load_preset("snake_draft_v1")
    payload = build_draft_pool_payload(2026, rules, [], team_count=12)
    positions = {r["position"] for r in payload["rows"]}
    assert "TE" in positions
    assert payload["position_counts"]["TE"] == 1
    assert payload["missing_tight_ends"] is False
    tes = [r for r in payload["rows"] if r["position"] == "TE"]
    assert tes and tes[0]["player"] == "Pitts"


def test_payload_warns_when_league_requires_te_and_pool_has_none(monkeypatch):
    pool = pd.DataFrame(
        {
            "player_id": ["w1"],
            "Player": ["Puka"],
            "Team": ["LAR"],
            "Position": ["WR"],
            "Season Proj": [300.0],
        }
    )
    monkeypatch.setattr("src.draft_hub.value_sheet.load_draft_pool", lambda season, **k: pool)
    monkeypatch.setattr("src.draft_hub.value_sheet.load_k_def_rows", lambda *a, **k: [])
    rules = load_preset("snake_draft_v1")
    payload = build_draft_pool_payload(2026, rules, [], team_count=12)
    assert payload["missing_tight_ends"] is True
    assert payload["pool_warnings"]
    assert "tight end" in payload["pool_warnings"][0].lower()


def test_nomination_pool_includes_te(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": _te_pool_rows(), "position_counts": {"TE": 2}},
    )
    league = _league("te-nom")
    rules = load_preset("snake_draft_v1")
    pool = build_nomination_pool(
        league_id=league["id"],
        pool_mode="full",
        season=2026,
        rules=rules,
        workspace_id=storage.roster_workspace_for_league(league),
    )
    tes = [r for r in pool["rows"] if r["position"] == "TE"]
    assert len(tes) == 2
    assert {r["player_id"] for r in tes} == {"te1", "te2"}


def test_human_can_pick_te_and_capacity_updates(hub_db, monkeypatch):
    te = {
        "player_id": "te1",
        "player": "Kyle Pitts",
        "player_name": "Kyle Pitts",
        "team": "ATL",
        "position": "TE",
        "season_proj": 180,
        "season_p10": 140,
        "season_p50": 180,
        "season_p90": 220,
    }
    monkeypatch.setattr("src.draft_hub.draft_state.resolve_nomination_player", lambda **kwargs: te)
    league = _league("te-human", team_count=1)
    start_draft(league["id"], "te-human")
    team = storage.get_team_by_user(league["id"], "te-human")
    rules = load_preset("snake_draft_v1")
    before = roster_capacity(rules, storage.list_team_roster(league["id"], team["id"]))
    assert before["by_position"]["TE"]["below_min"] is True
    assert before["by_position"]["TE"]["count"] == 0

    state = make_pick(league["id"], "te-human", te)
    after = roster_capacity(rules, storage.list_team_roster(league["id"], team["id"]))
    assert after["by_position"]["TE"]["count"] == 1
    assert after["by_position"]["TE"]["below_min"] is False
    events = storage.list_draft_events(league["id"])
    picks = [e for e in events if e.get("event_type") == "pick"]
    assert picks
    payload = picks[-1]["payload"]
    assert payload["position"] == "TE"
    assert payload["season_p10"] == 140
    assert payload["season_p50"] == 180
    assert payload["season_p90"] == 220
    assert state["session"]["status"] in ("picking", "completed")


def test_bot_picks_te_when_minimum_unfilled(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": _te_pool_rows()},
    )
    league = _league("te-bot", team_count=2)
    setup_test_draft(league["id"], "te-bot", bot_count=1)
    start_draft(league["id"], "te-bot")
    bot = next(t for t in storage.list_league_teams(league["id"]) if t.get("is_bot"))
    session = storage.get_draft_session(league["id"])
    order = session.get("nomination_order") or []
    idx = order.index(bot["id"])
    storage.update_draft_session(league["id"], nominator_index=idx)

    ws = storage.roster_workspace_for_league(league)
    for i, (pid, pos) in enumerate(
        [("qb1b", "QB"), ("rb1b", "RB"), ("rb2b", "RB"), ("wr1b", "WR"), ("wr2b", "WR"), ("k1b", "K"), ("def1b", "DEF")]
    ):
        storage.add_roster_slot(
            ws,
            {
                "player_id": pid,
                "player_name": f"Fill {pos}{i}",
                "team": "KC",
                "position": pos,
                "salary": 0,
                "contract_years": 1,
                "source": "draft",
            },
            team_id=bot["id"],
        )
    rules = load_preset("snake_draft_v1")
    cap = roster_capacity(rules, storage.list_team_roster(league["id"], bot["id"]))
    assert cap["by_position"]["TE"]["below_min"] is True

    result = maybe_bot_pick(league["id"])
    assert result is not None
    roster = storage.list_team_roster(league["id"], bot["id"])
    tes = [r for r in roster if str(r.get("position")).upper() == "TE"]
    assert tes, roster
    events = [e for e in storage.list_draft_events(league["id"]) if e.get("event_type") == "pick"]
    assert events[-1]["payload"]["position"] == "TE"
