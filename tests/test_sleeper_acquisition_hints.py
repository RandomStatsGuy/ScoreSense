"""Tests for Sleeper acquisition hint parsing."""

from __future__ import annotations

from src.draft_hub.sleeper_acquisition_hints import (
    sleeper_hints_for_movements,
    sleeper_league_id_for_season,
)


def test_sleeper_hints_match_from_to(monkeypatch):
    acquisitions = [
        {
            "player_key": "jmeyers",
            "player_name": "J. Meyers",
            "event_type": "trade",
            "from_owner": "Dawson O",
            "to_owner": "Caleb K",
            "event_at": "2024-10-15T00:00:00+00:00",
            "label": "2024 Sleeper trade: Dawson O → Caleb K",
        }
    ]
    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.parse_sleeper_acquisitions",
        lambda *a, **k: acquisitions,
    )
    movements = [
        {
            "id": 1,
            "confidence": "ambiguous",
            "player_name": "J. Meyers",
            "from_owner": "Dawson O",
            "to_owner": "Caleb K",
        }
    ]
    hints = sleeper_hints_for_movements("lg", "sleeper1", season_year=2024, movements=movements)
    assert "jmeyers" in hints
    assert hints["jmeyers"]["story"] == "trade"


def test_sleeper_league_id_for_season_from_chain(monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.sleeper_acquisition_hints.sleeper_league_season_chain",
        lambda lid: [
            {"season": "2024", "league_id": "L2024"},
            {"season": "2023", "league_id": "L2023"},
        ],
    )
    assert sleeper_league_id_for_season("root", 2024) == "L2024"
    assert sleeper_league_id_for_season("root", 2021) is None
