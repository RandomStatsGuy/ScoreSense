"""Owner-change auto-resolve: multi-season trades, draft, FA lottery."""

from __future__ import annotations

from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.sleeper_acquisition_hints import (
    apply_sleeper_acquisition_tags,
    parse_sleeper_acquisitions_for_owner_change,
    sleeper_hints_for_movements,
)


def _seed_owner_change(hub_db, *, player: str = "R. Stevenson"):
    league = storage.create_league("oc-user", "Owner Change", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2024,
        [
            {
                "owner_label": "Caleb K",
                "player_name": player,
                "cap_hit": 10,
                "roster_status": "active",
                "acquisition_type": "unknown",
            }
        ],
    )
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Dawson O",
                "player_name": player,
                "cap_hit": 15,
                "roster_status": "active",
                "acquisition_type": "unknown",
            }
        ],
    )
    storage.replace_league_movements(
        lid,
        2025,
        [
            {
                "player_name": player,
                "event_type": "trade_out",
                "from_owner": "Caleb K",
                "to_owner": "Dawson O",
                "salary": 10,
                "source": "import_diff",
                "confidence": "ambiguous",
            },
            {
                "player_name": player,
                "event_type": "trade_in",
                "from_owner": "Caleb K",
                "to_owner": "Dawson O",
                "salary": 15,
                "source": "import_diff",
                "confidence": "ambiguous",
            },
        ],
    )
    return lid


def test_parse_acquisitions_for_owner_change_scans_prior_season(monkeypatch):
    calls: list[int] = []

    def fake_parse(league_id, sleeper_league_id, *, season_year):
        calls.append(int(season_year))
        if season_year == 2024:
            return [
                {
                    "season_year": 2024,
                    "player_key": "rstevenson",
                    "player_name": "Rhamondre Stevenson",
                    "event_type": "trade",
                    "from_owner": "Caleb K",
                    "to_owner": "Dawson O",
                    "event_at": "2024-10-18T00:00:00+00:00",
                    "sleeper_transaction_id": "tx-2024",
                    "source": "sleeper",
                }
            ]
        return []

    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.parse_sleeper_acquisitions",
        fake_parse,
    )
    events = parse_sleeper_acquisitions_for_owner_change("lg", "root", season_year=2025)
    assert calls == [2024, 2025]
    assert len(events) == 1
    assert events[0]["event_type"] == "trade"
    assert events[0]["season_year"] == 2024


def test_sleeper_hints_use_prior_season_trade(monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.parse_sleeper_acquisitions_for_owner_change",
        lambda *a, **k: [
            {
                "player_key": "rstevenson",
                "event_type": "trade",
                "from_owner": "Caleb K",
                "to_owner": "Dawson O",
                "event_at": "2024-10-18T00:00:00+00:00",
                "season_year": 2024,
            }
        ],
    )
    movements = [
        {
            "id": 1,
            "confidence": "ambiguous",
            "player_name": "R. Stevenson",
            "from_owner": "Caleb K",
            "to_owner": "Dawson O",
        }
    ]
    hints = sleeper_hints_for_movements("lg", "s1", season_year=2025, movements=movements)
    assert hints["rstevenson"]["story"] == "trade"


def test_apply_tags_prior_season_trade_resolves(hub_db, monkeypatch):
    lid = _seed_owner_change(hub_db)
    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.parse_sleeper_acquisitions_for_owner_change",
        lambda *a, **k: [
            {
                "player_key": "rstevenson",
                "player_name": "R. Stevenson",
                "event_type": "trade",
                "from_owner": "Caleb K",
                "to_owner": "Dawson O",
                "event_at": "2024-10-18T00:00:00+00:00",
                "season_year": 2024,
                "sleeper_transaction_id": "tx1",
            }
        ],
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.sleeper_league_id_for_season",
        lambda *a, **k: "L2025",
    )
    monkeypatch.setattr(
        "src.draft_hub.draft_results_import.load_draft_wins_by_season",
        lambda *a, **k: ({}, {}),
    )
    stats = apply_sleeper_acquisition_tags(lid, "root", season_year=2025)
    assert stats["movements_resolved"] >= 2
    movs = storage.list_league_movements(lid, season_year=2025)
    assert all(m["confidence"] != "ambiguous" for m in movs)
    assert all(m["event_type"] == "trade" for m in movs)
    rows = storage.list_league_contract_rows(lid, season_year=2025)
    assert rows[0]["acquisition_type"] == "trade"


def test_apply_tags_fa_lottery_when_no_trade_or_draft(hub_db, monkeypatch):
    lid = _seed_owner_change(hub_db, player="S. La Porta")
    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.parse_sleeper_acquisitions_for_owner_change",
        lambda *a, **k: [],
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.sleeper_league_id_for_season",
        lambda *a, **k: "L2025",
    )
    monkeypatch.setattr(
        "src.draft_hub.draft_results_import.load_draft_wins_by_season",
        lambda *a, **k: ({}, {}),
    )
    stats = apply_sleeper_acquisition_tags(lid, "root", season_year=2025)
    assert stats["movements_resolved"] >= 2
    movs = {m["event_type"]: m for m in storage.list_league_movements(lid, season_year=2025)}
    assert movs["cut"]["confidence"] == "inferred"
    assert movs["post_draft_fa"]["confidence"] == "inferred"
    rows = storage.list_league_contract_rows(lid, season_year=2025)
    assert rows[0]["acquisition_type"] == "post_draft_fa"


def test_apply_tags_draft_win_beats_lottery(hub_db, monkeypatch):
    lid = _seed_owner_change(hub_db, player="Tyreek Hill")
    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.parse_sleeper_acquisitions_for_owner_change",
        lambda *a, **k: [],
    )
    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.sleeper_league_id_for_season",
        lambda *a, **k: "L2025",
    )
    wins = {
        2025: [
            {
                "season_year": 2025,
                "player_name": "Tyreek Hill",
                "owner_label": "Dawson O",
                "cap_hit": 39.0,
                "source": "excel",
            }
        ]
    }
    monkeypatch.setattr(
        "src.draft_hub.draft_results_import.load_draft_wins_by_season",
        lambda *a, **k: (wins, {"total_wins": 1}),
    )
    stats = apply_sleeper_acquisition_tags(lid, "root", season_year=2025)
    assert stats["movements_resolved"] >= 2
    movs = storage.list_league_movements(lid, season_year=2025)
    types = {m["event_type"] for m in movs}
    assert "cut" in types
    assert "draft" in types
    rows = storage.list_league_contract_rows(lid, season_year=2025)
    assert rows[0]["acquisition_type"] == "draft"
