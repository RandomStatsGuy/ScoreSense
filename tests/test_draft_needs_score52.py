"""SCORE-52 / 54 / 57: need-aware noms, opening min bid, completion gate."""

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_state import (
    award_nominee,
    draft_completion_errors,
    end_draft,
    nominate,
    start_draft,
)
from src.draft_hub.presets import load_preset
from src.draft_hub.rules_engine import (
    nomination_sort_key,
    occupying_min_errors,
    should_need_bid,
)
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.test_draft import setup_test_draft, simulate_draft


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _need_rules() -> LeagueRules:
    return LeagueRules(
        salary_cap=200,
        roster={
            "qb": {"min": 0, "max": 4, "starter": 0},
            "rb": {"min": 0, "max": 8, "starter": 0},
            "wr": {"min": 0, "max": 8, "starter": 0},
            "te": {"min": 1, "max": 3, "starter": 1},
        },
        roster_size_max=4,
    )


def test_nomination_sort_prefers_unfilled_te_min():
    rules = _need_rules()
    roster = []
    wr = {"position": "WR", "fair_value": 40, "player_id": "wr1"}
    te = {"position": "TE", "fair_value": 4, "player_id": "te1"}
    ranked = sorted([wr, te], key=lambda r: nomination_sort_key(rules, roster, r))
    assert ranked[0]["player_id"] == "te1"


def test_should_need_bid_blocks_luxury_until_te_min():
    rules = _need_rules()
    assert should_need_bid(rules, [], "TE") is True
    assert should_need_bid(rules, [], "WR") is False
    filled = [
        {
            "player_id": "te1",
            "position": "TE",
            "salary": 1,
            "contract_years": 1,
            "source": "draft",
        }
    ]
    assert should_need_bid(rules, filled, "WR") is True


def test_occupying_min_errors_te():
    rules = _need_rules()
    assert occupying_min_errors(rules, []) == ["Need 1 more TE (min 1)"]
    filled = [
        {
            "player_id": "te1",
            "position": "TE",
            "salary": 1,
            "contract_years": 1,
            "source": "draft",
        }
    ]
    assert occupying_min_errors(rules, filled) == []


def _stub_pool(monkeypatch, rows):
    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": rows},
    )
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: next(
            r for r in rows if str(r.get("player_id")) == str(kwargs.get("player_id"))
        ),
    )


def test_nominate_places_opening_min_bid(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("open-bid")
    league = storage.create_league("open-bid", "Open Bid", 2026, rules, workspace_id=ws["id"])
    player = {
        "player_id": "p-te",
        "player": "Need TE",
        "player_name": "Need TE",
        "team": "KC",
        "position": "TE",
        "fair_value": 8,
    }
    _stub_pool(monkeypatch, [player])
    start_draft(league["id"], "open-bid", allow_empty=True)
    state = nominate(league["id"], "open-bid", player)
    session = state["session"]
    team = storage.get_team_by_user(league["id"], "open-bid")
    assert session["status"] == "bidding"
    assert float(session["high_bid"]) == float(rules.auction.min_bid)
    assert session["high_bidder_team_id"] == team["id"]
    bids = [e for e in state["events"] if e.get("event_type") == "bid"]
    assert bids and bids[-1]["payload"].get("opening") is True

    award_nominee(league["id"], "open-bid")
    roster = storage.list_team_roster(league["id"], team["id"])
    won = next(r for r in roster if r["player_id"] == "p-te")
    assert float(won["salary"]) == float(rules.auction.min_bid)


def test_end_draft_blocked_when_mins_unfilled(hub_db):
    rules = _need_rules()
    ws = storage.get_or_create_workspace("gate-user")
    league = storage.create_league("gate-user", "Gate", 2026, rules, workspace_id=ws["id"])
    start_draft(league["id"], "gate-user", allow_empty=True)
    errs = draft_completion_errors(league["id"])
    assert errs
    assert any("TE" in e for e in errs)
    with pytest.raises(ValueError, match="positional minimums"):
        end_draft(league["id"], "gate-user")
    forced = end_draft(league["id"], "gate-user", force=True)
    assert forced["session"]["status"] == "completed"
    assert forced["events"][-1]["payload"].get("forced") is True


def test_simulate_fills_te_minimum_before_extra_wrs(hub_db, monkeypatch):
    rules = _need_rules()
    league = storage.create_league(
        "te-sim",
        "TE Sim",
        2026,
        rules,
        team_count=3,
        test_mode=True,
    )
    setup_test_draft(league["id"], "te-sim", bot_count=2)
    rows = []
    for i in range(20):
        rows.append(
            {
                "player_id": f"wr-{i}",
                "player": f"WR {i}",
                "player_name": f"WR {i}",
                "team": "KC",
                "position": "WR",
                "fair_value": 50 - i,
                "season_proj": 200 - i,
                "per_game_proj": 12.0,
                "is_rookie": False,
            }
        )
    for i in range(6):
        rows.append(
            {
                "player_id": f"te-{i}",
                "player": f"TE {i}",
                "player_name": f"TE {i}",
                "team": "SF",
                "position": "TE",
                "fair_value": 5 - i * 0.1,
                "season_proj": 80 - i,
                "per_game_proj": 5.0,
                "is_rookie": False,
            }
        )
    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": rows},
    )
    state = simulate_draft(league["id"], "te-sim")
    assert state["session"]["status"] == "completed"
    tes_by_team = []
    for team in storage.list_league_teams(league["id"]):
        roster = storage.list_team_roster(league["id"], team["id"])
        tes = [r for r in roster if str(r.get("position")).upper() == "TE"]
        tes_by_team.append(len(tes))
        assert len(tes) >= 1, f"{team.get('name')} drafted 0 TEs: {roster}"
    assert sum(tes_by_team) >= 3
