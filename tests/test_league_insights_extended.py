from src.draft_hub import storage
from src.draft_hub.k_def_pool_cache import analytics_positions
from src.draft_hub.league_history import build_player_ownership_history
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


def test_analytics_positions_includes_k_def():
    rules = LeagueRules.model_validate(
        {
            "salary_cap": 200,
            "roster": {
                "qb": {"min": 1, "max": 2},
                "k": {"min": 0, "max": 1},
                "def": {"min": 0, "max": 1},
            },
        }
    )
    pos = analytics_positions(rules)
    assert "K" in pos
    assert "DEF" in pos


def test_ownership_history_roster_baseline_without_events():
    overview = {
        "teams": [
            {
                "team": {"id": "t1", "name": "Alpha"},
                "roster": [
                    {
                        "player_id": "p2",
                        "player_name": "Imported Player",
                        "position": "WR",
                        "salary": 12,
                        "source": "sleeper",
                    }
                ],
            }
        ]
    }

    class FakeStorage:
        @staticmethod
        def list_draft_events(league_id, limit=500):
            return []

    import src.draft_hub.league_history as lh

    old = lh.storage
    lh.storage = FakeStorage
    try:
        out = build_player_ownership_history("lg1", overview)
    finally:
        lh.storage = old

    assert out["player_count"] == 1
    assert out["has_auction_events"] is False
    player = out["players"][0]
    assert player["timeline"][0]["event_type"] == "roster"
    assert "Sleeper" in player["timeline"][0]["note"]


def test_ownership_history_from_win_event():
    overview = {
        "teams": [
            {
                "team": {"id": "t1", "name": "Alpha"},
                "roster": [
                    {
                        "player_id": "p1",
                        "player_name": "Test Player",
                        "position": "RB",
                        "salary": 25,
                    }
                ],
            }
        ]
    }

    class FakeStorage:
        @staticmethod
        def list_draft_events(league_id, limit=500):
            return [
                {
                    "event_type": "win",
                    "created_at": "2025-08-01T12:00:00Z",
                    "payload": {
                        "player_id": "p1",
                        "player_name": "Test Player",
                        "position": "RB",
                        "team_id": "t1",
                        "team_name": "Alpha",
                        "amount": 22,
                    },
                }
            ]

    import src.draft_hub.league_history as lh

    old = lh.storage
    lh.storage = FakeStorage
    try:
        out = build_player_ownership_history("lg1", overview)
    finally:
        lh.storage = old

    player = next(p for p in out["players"] if p["player_id"] == "p1")
    assert player["current_owners"][0]["salary"] == 25
    assert player["timeline"][0]["amount"] == 22


def test_resolve_sleeper_league_id_from_member_workspace(tmp_path, monkeypatch):
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)

    comm = "comm-no-sleeper"
    member = "member-has-sleeper"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Resolve Test", 2025, rules, workspace_id=ws["id"])
    storage.join_league(member, league["room_code"], "Member Team")
    storage.update_sleeper_link(
        member,
        sleeper_league_id="777888999",
        sleeper_roster_id="3",
        sleeper_team_name="Member Team",
    )

    assert storage.get_league(league["id"]).get("sleeper_league_id") is None
    resolved = resolve_sleeper_league_id(league["id"])
    assert resolved == "777888999"
    assert storage.get_league(league["id"]).get("sleeper_league_id") == "777888999"


def test_preseason_scoring_from_rosters_when_no_matchups(monkeypatch):
    from src.draft_hub import league_history as lh
    from src.draft_hub.league_history import build_sleeper_scoring_history

    lh._SCORING_CACHE.clear()

    def fake_fetch(url, timeout=25):
        if url.endswith("/league/sl123"):
            return {"season": "2026", "status": "pre_draft", "settings": {"playoff_week_start": 15}}
        if "/matchups/" in url:
            return []
        raise AssertionError(url)

    def fake_list(_sl_id):
        return {
            "season": 2026,
            "teams": [
                {"roster_id": "1", "team_name": "Alpha"},
                {"roster_id": "2", "team_name": "Beta"},
            ],
        }

    monkeypatch.setattr("src.draft_hub.league_history._fetch_json", fake_fetch)
    monkeypatch.setattr("src.integrations.sleeper_league.list_league_teams", fake_list)

    out = build_sleeper_scoring_history(
        "sl123",
        hub_teams=[{"sleeper_roster_id": "1", "name": "Hub Alpha"}],
    )
    assert out["available"] is True
    assert out["preseason"] is True
    assert len(out["standings"]) == 2
    names = {row["team_name"] for row in out["standings"]}
    assert names == {"Hub Alpha", "Beta"}
    assert out["weeks"] == []
