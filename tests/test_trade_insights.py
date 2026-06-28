"""Trade partner and suggestion tests."""

import pytest

from src.draft_hub import storage
from src.draft_hub.presets import load_preset
from src.draft_hub.trade_insights import build_trade_insights


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_imbalanced_rosters_surface_partner(hub_db):
    comm = "trade-insights-comm"
    member = "trade-insights-member"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Trade Insights", 2025, rules, workspace_id=ws["id"], team_count=10)
    team_a = storage.get_team_by_user(league["id"], comm)
    team_b = storage.join_league(member, league["room_code"], "Team B")

    for i in range(6):
        storage.add_roster_slot(
            ws["id"],
            {
                "player_id": f"wr-{i}",
                "player_name": f"WR {i}",
                "team": "SEA",
                "position": "WR",
                "salary": 20 + i,
                "contract_years": 1,
            },
            team_id=team_a["id"],
        )
    for i in range(4):
        storage.add_roster_slot(
            ws["id"],
            {
                "player_id": f"rb-{i}",
                "player_name": f"RB {i}",
                "team": "SF",
                "position": "RB",
                "salary": 25 + i,
                "contract_years": 1,
            },
            team_id=team_b["id"],
        )

    overview = storage.league_roster_overview(league["id"])

    import pandas as pd

    rows = []
    for i in range(6):
        rows.append({"player_id": f"wr-{i}", "Player": f"WR {i}", "Position": "WR", "Season Proj": 200 - i * 10})
    for i in range(4):
        rows.append({"player_id": f"rb-{i}", "Player": f"RB {i}", "Position": "RB", "Season Proj": 180 - i * 10})
    fake_pool = pd.DataFrame(rows)

    trade = build_trade_insights(
        overview,
        my_team_id=team_a["id"],
        season=2025,
        draft_completed=True,
        pool=fake_pool,
    )
    assert "WR" in trade["balance"]["surplus"]
    assert trade["partners"]
    assert trade["partners"][0]["team_id"] == team_b["id"]


def test_trade_suggestions_only_send_surplus_for_partner_need(hub_db):
    comm = "trade-surplus-comm"
    member = "trade-surplus-member"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Surplus Trade", 2025, rules, workspace_id=ws["id"], team_count=10)
    team_a = storage.get_team_by_user(league["id"], comm)
    team_b = storage.join_league(member, league["room_code"], "Team B")

    storage.add_roster_slot(
        ws["id"],
        {"player_id": "te-a1", "player_name": "TE A1", "team": "KC", "position": "TE", "salary": 10, "contract_years": 1},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "te-a2", "player_name": "TE A2", "team": "KC", "position": "TE", "salary": 8, "contract_years": 1},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "te-a3", "player_name": "TE A3", "team": "KC", "position": "TE", "salary": 6, "contract_years": 1},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "wr-a", "player_name": "WR A", "team": "SEA", "position": "WR", "salary": 18, "contract_years": 1},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "wr-b", "player_name": "WR B", "team": "SF", "position": "WR", "salary": 22, "contract_years": 1},
        team_id=team_b["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "rb-b", "player_name": "RB B", "team": "DAL", "position": "RB", "salary": 30, "contract_years": 1},
        team_id=team_b["id"],
    )
    for i in range(5):
        storage.add_roster_slot(
            ws["id"],
            {
                "player_id": f"wr-extra-{i}",
                "player_name": f"WR Extra {i}",
                "team": "SEA",
                "position": "WR",
                "salary": 8 + i,
                "contract_years": 1,
            },
            team_id=team_b["id"],
        )

    overview = storage.league_roster_overview(league["id"])

    import pandas as pd

    pool = pd.DataFrame(
        [
            {"player_id": "te-a1", "Player": "TE A1", "Position": "TE", "Season Proj": 140},
            {"player_id": "te-a2", "Player": "TE A2", "Position": "TE", "Season Proj": 130},
            {"player_id": "te-a3", "Player": "TE A3", "Position": "TE", "Season Proj": 120},
            {"player_id": "wr-a", "Player": "WR A", "Position": "WR", "Season Proj": 210},
            {"player_id": "wr-b", "Player": "WR B", "Position": "WR", "Season Proj": 200},
            {"player_id": "rb-b", "Player": "RB B", "Position": "RB", "Season Proj": 190},
            *[
                {
                    "player_id": f"wr-extra-{i}",
                    "Player": f"WR Extra {i}",
                    "Position": "WR",
                    "Season Proj": 120 - i,
                }
                for i in range(5)
            ],
        ]
    )

    trade = build_trade_insights(
        overview,
        my_team_id=team_a["id"],
        season=2025,
        draft_completed=True,
        pool=pool,
    )
    assert "TE" in trade["balance"]["surplus"]
    assert "WR" in trade["balance"]["need"]
    assert "WR" in trade["actionable_needs"]
    assert "TE" not in trade["balance"]["need"]

    partner_suggestions = [s for s in trade["suggestions"] if s["partner_team_id"] == team_b["id"]]
    assert partner_suggestions
    for suggestion in partner_suggestions:
        send_positions = {p["position"] for p in suggestion["send"]}
        receive_positions = {p["position"] for p in suggestion["receive"]}
        assert send_positions <= {"TE"}
        assert "WR" in receive_positions
        assert "WR" in (suggestion.get("fills_needs") or [])
        assert "WR" not in send_positions


def test_cap_sheet_style_league_can_surface_trades(hub_db):
    """Regression: real cap-sheet depth imbalances should produce partner matches."""
    from pathlib import Path

    from src.draft_hub.cap_sheet_import import parse_cap_sheet_tsv
    from src.draft_hub.presets import load_preset

    comm = "cap-trade-comm"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Cap Trade", 2025, rules, workspace_id=ws["id"], team_count=12)
    team_a = storage.get_team_by_user(league["id"], comm)
    team_b = storage.join_league("cap-trade-b", league["room_code"], "Team B")

    for i in range(6):
        storage.add_roster_slot(
            ws["id"],
            {"player_id": f"wr-a-{i}", "player_name": f"WR A {i}", "team": "MIA", "position": "WR", "salary": 12 + i, "contract_years": 1},
            team_id=team_a["id"],
        )
    for i in range(2):
        storage.add_roster_slot(
            ws["id"],
            {"player_id": f"rb-a-{i}", "player_name": f"RB A {i}", "team": "NYJ", "position": "RB", "salary": 20 + i, "contract_years": 1},
            team_id=team_a["id"],
        )
    for i in range(5):
        storage.add_roster_slot(
            ws["id"],
            {"player_id": f"rb-b-{i}", "player_name": f"RB B {i}", "team": "DAL", "position": "RB", "salary": 15 + i, "contract_years": 1},
            team_id=team_b["id"],
        )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "wr-b-0", "player_name": "WR B 0", "team": "SF", "position": "WR", "salary": 14, "contract_years": 1},
        team_id=team_b["id"],
    )

    overview = storage.league_roster_overview(league["id"])
    import pandas as pd

    pool = pd.DataFrame(
        [
            *[{"player_id": f"wr-a-{i}", "Player": f"WR A {i}", "Position": "WR", "Season Proj": 190 - i * 5} for i in range(6)],
            *[{"player_id": f"rb-a-{i}", "Player": f"RB A {i}", "Position": "RB", "Season Proj": 170 - i * 5} for i in range(2)],
            *[{"player_id": f"rb-b-{i}", "Player": f"RB B {i}", "Position": "RB", "Season Proj": 165 - i * 5} for i in range(5)],
            {"player_id": "wr-b-0", "Player": "WR B 0", "Position": "WR", "Season Proj": 175},
        ]
    )
    trade = build_trade_insights(
        overview,
        my_team_id=team_a["id"],
        season=2025,
        draft_completed=True,
        pool=pool,
    )
    assert "RB" in trade["balance"]["need"]
    assert "WR" in trade["balance"]["surplus"]
    assert trade["suggestions"]

    cap_path = Path(__file__).resolve().parents[1] / "data" / "draft_hub" / "cap_sheet_test.tsv"
    if cap_path.exists():
        parsed = parse_cap_sheet_tsv(cap_path.read_text(encoding="utf-8"), season=2025, rules=rules)
        assert parsed["stats"]["matched"] >= 50


def test_filter_team_sleeper_roster_hides_other_teams_players(hub_db):
    from src.draft_hub.hub_context import filter_team_sleeper_roster, list_roster_for_context, resolve_hub_context

    comm = "comm-filter"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Filter League", 2025, rules, workspace_id=ws["id"])
    team_a = storage.get_team_by_user(league["id"], comm)

    storage.update_team_sleeper_link(
        team_a["id"],
        sleeper_roster_id="1",
        sleeper_team_name="White Supremacists",
        sleeper_player_ids=["p-mine-1", "p-mine-2"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "p-mine-1", "player_name": "Mine", "team": "KC", "position": "QB", "salary": 10, "contract_years": 1, "source": "sleeper"},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "p-other-1", "player_name": "Theirs", "team": "SF", "position": "WR", "salary": 12, "contract_years": 1, "source": "sleeper"},
        team_id=team_a["id"],
    )

    ctx = resolve_hub_context(comm)
    roster = list_roster_for_context(ctx)
    assert len(roster) == 1
    assert roster[0]["player_id"] == "p-mine-1"


def test_compose_roster_ignores_stacked_league_import(hub_db, monkeypatch):
    from src.draft_hub.hub_context import list_roster_for_context, resolve_hub_context

    comm = "comm-stack"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Stack League", 2025, rules, workspace_id=ws["id"])
    team_a = storage.get_team_by_user(league["id"], comm)
    storage.update_league_sleeper_id(league["id"], "sl-stack")
    bloated_ids = [f"p-league-{i}" for i in range(50)]
    storage.update_team_sleeper_link(
        team_a["id"],
        sleeper_roster_id="9",
        sleeper_team_name="Mine",
        sleeper_player_ids=bloated_ids,
    )
    for pid in bloated_ids:
        storage.add_roster_slot(
            ws["id"],
            {
                "player_id": pid,
                "player_name": pid,
                "team": "KC",
                "position": "WR",
                "salary": 1,
                "contract_years": 1,
                "source": "sleeper",
            },
            team_id=team_a["id"],
        )
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "p-manual",
            "player_name": "Manual",
            "team": "KC",
            "position": "QB",
            "salary": 5,
            "contract_years": 1,
            "source": "manual",
        },
        team_id=team_a["id"],
    )

    def fake_snapshot(_sl_id, _rid):
        return {
            "players": [
                {"player_id": "p-league-0", "player_name": "A", "team": "KC", "position": "WR", "sleeper_player_id": "s0"},
                {"player_id": "p-league-1", "player_name": "B", "team": "KC", "position": "WR", "sleeper_player_id": "s1"},
            ],
            "player_ids": ["p-league-0", "p-league-1"],
            "team_name": "Mine",
        }

    monkeypatch.setattr(
        "src.draft_hub.league_sleeper_sync.fetch_linked_roster",
        fake_snapshot,
    )

    ctx = resolve_hub_context(comm)
    roster = list_roster_for_context(ctx, live_sleeper=True)
    assert len(roster) == 3
    ids = {r["player_id"] for r in roster}
    assert ids == {"p-manual", "p-league-0", "p-league-1"}


def test_compose_roster_dedupes_sheet_import_overlapping_sleeper(hub_db, monkeypatch):
    from src.draft_hub.hub_context import list_roster_for_context, resolve_hub_context
    from src.draft_hub.league_sleeper_sync import invalidate_team_allowlist_cache

    comm = "comm-sheet-dedupe"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Sheet Dedupe", 2025, rules, workspace_id=ws["id"])
    team = storage.get_team_by_user(league["id"], comm)
    storage.update_league_sleeper_id(league["id"], "sl-sheet")
    storage.update_team_sleeper_link(team["id"], sleeper_roster_id="9")

    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0034960",
            "player_name": "Jakobi Meyers",
            "team": "JAX",
            "position": "WR",
            "salary": 11,
            "contract_years": 2,
            "sleeper_player_id": "5947",
            "source": "sheet",
        },
        team_id=team["id"],
    )

    def fake_snapshot(_league_id, _team_id):
        return {
            "players": [
                {
                    "player_id": "00-0034960",
                    "player_name": "Jakobi Meyers",
                    "team": "JAX",
                    "position": "WR",
                    "sleeper_player_id": "5947",
                }
            ],
            "player_ids": ["00-0034960"],
            "team_name": "Mine",
        }

    monkeypatch.setattr(
        "src.draft_hub.league_sleeper_sync.fetch_team_snapshot_cached",
        fake_snapshot,
    )
    invalidate_team_allowlist_cache()

    ctx = resolve_hub_context(comm)
    roster = list_roster_for_context(ctx)
    assert len(roster) == 1
    assert roster[0]["player_id"] == "00-0034960"
    assert roster[0]["source"] == "sheet"
    assert roster[0]["salary"] == 11


def test_reconcile_moves_players_to_correct_team(hub_db, monkeypatch):
    from src.draft_hub.league_sleeper_sync import reconcile_league_roster_assignments

    comm = "comm-reconcile"
    member = "member-reconcile"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Reconcile League", 2025, rules, workspace_id=ws["id"])
    team_a = storage.get_team_by_user(league["id"], comm)
    team_b = storage.join_league(member, league["room_code"], "Team B")

    storage.update_league_sleeper_id(league["id"], "sl-123")
    storage.update_team_sleeper_link(team_a["id"], sleeper_roster_id="1", sleeper_player_ids=["p-a"])
    storage.update_team_sleeper_link(team_b["id"], sleeper_roster_id="2", sleeper_player_ids=["p-b"])

    storage.add_roster_slot(
        ws["id"],
        {"player_id": "p-a", "player_name": "A", "team": "KC", "position": "QB", "salary": 10, "contract_years": 1, "source": "sleeper"},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "p-b", "player_name": "B", "team": "SF", "position": "WR", "salary": 12, "contract_years": 1, "source": "sleeper"},
        team_id=team_a["id"],
    )

    def fake_snapshots(_sl_id):
        return {
            "1": {"players": [{"player_id": "p-a", "sleeper_player_id": "sp-a"}], "team_name": "Team A"},
            "2": {"players": [{"player_id": "p-b", "sleeper_player_id": "sp-b"}], "team_name": "Team B"},
        }

    monkeypatch.setattr(
        "src.draft_hub.league_sleeper_sync.fetch_all_linked_rosters",
        fake_snapshots,
    )
    monkeypatch.setattr(
        "src.draft_hub.league_sleeper_sync.list_league_teams",
        lambda _sl: {
            "teams": [
                {"roster_id": "1", "team_name": "Team A"},
                {"roster_id": "2", "team_name": "Team B"},
            ],
        },
    )

    result = reconcile_league_roster_assignments(league["id"])
    assert result["moved"] == 1
    assert len(storage.list_roster(ws["id"], team_a["id"])) == 1
    assert len(storage.list_roster(ws["id"], team_b["id"])) == 1
