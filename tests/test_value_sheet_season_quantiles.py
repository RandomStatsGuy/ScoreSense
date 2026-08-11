"""SCORE-2: Hub value-sheet payload exposes new season quantile fields."""

from __future__ import annotations

import pandas as pd

from src.draft_hub.schemas import LeagueRules
from src.draft_hub.value_sheet import build_draft_pool_payload, invalidate_pool_payload_cache


def _sample_pool() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "player_id": ["p1", "p2"],
            "Player": ["Star RB", "Backup RB"],
            "Team": ["KC", "KC"],
            "Position": ["RB", "RB"],
            "Season Proj": [300.0, 60.0],
            "Per-Game Proj": [17.6, 4.0],
            "Season Floor": [260.0, 30.0],
            "Season Ceiling": [340.0, 95.0],
            "Season P10": [260.0, 30.0],
            "Season P50": [300.0, 60.0],
            "Season P90": [340.0, 95.0],
            "Season Spread": [80.0, 65.0],
            "games_expected": [17.0, 14.0],
            "season_quantile_method": ["mc_schedule_v1", "mc_schedule_v1"],
            "Rookie Est.": [False, False],
        }
    )


def test_build_draft_pool_payload_exposes_season_quantile_fields(monkeypatch):
    monkeypatch.setattr("src.draft_hub.value_sheet.load_draft_pool", lambda season: _sample_pool())
    invalidate_pool_payload_cache()

    payload = build_draft_pool_payload(2026, LeagueRules(), [], team_count=12)
    rows = {r["player_id"]: r for r in payload["rows"]}

    star = rows["p1"]
    assert star["season_p10"] == 260.0
    assert star["season_p50"] == 300.0
    assert star["season_p90"] == 340.0
    assert star["season_spread"] == 80.0
    assert star["games_expected"] == 17.0
    assert star["season_quantile_method"] == "mc_schedule_v1"

    backup = rows["p2"]
    assert backup["season_p10"] == 30.0
    assert backup["games_expected"] == 14.0


def test_build_draft_pool_payload_handles_missing_season_quantile_columns(monkeypatch):
    """Older/legacy pool rows without the new columns shouldn't error; fields are None."""
    legacy_pool = pd.DataFrame(
        {
            "player_id": ["p1"],
            "Player": ["Legacy Player"],
            "Team": ["KC"],
            "Position": ["RB"],
            "Season Proj": [200.0],
            "Per-Game Proj": [11.8],
        }
    )
    monkeypatch.setattr("src.draft_hub.value_sheet.load_draft_pool", lambda season: legacy_pool)
    invalidate_pool_payload_cache()

    payload = build_draft_pool_payload(2026, LeagueRules(), [], team_count=12)
    row = payload["rows"][0]
    assert row["season_p10"] is None
    assert row["season_p50"] is None
    assert row["games_expected"] is None
    assert row["season_quantile_method"] is None


def test_build_draft_pool_payload_exposes_risk_fields(monkeypatch):
    """SCORE-3: risk_score always; risk_adjusted_value only when risk_tolerance != 0."""
    monkeypatch.setattr("src.draft_hub.value_sheet.load_draft_pool", lambda season: _sample_pool())
    invalidate_pool_payload_cache()

    neutral = build_draft_pool_payload(2026, LeagueRules(), [], team_count=12)
    for row in neutral["rows"]:
        if row["player_id"] in {"p1", "p2"}:
            assert "risk_score" in row
            assert row["risk_score"] is not None
            assert row["risk_adjusted_value"] is None

    invalidate_pool_payload_cache()
    aggressive = build_draft_pool_payload(
        2026, LeagueRules(risk_tolerance=1.0), [], team_count=12
    )
    rows = {r["player_id"]: r for r in aggressive["rows"]}
    assert rows["p1"]["risk_adjusted_value"] is not None
    assert rows["p2"]["risk_adjusted_value"] is not None
    # Neutral fair_value / model_bid_hint remain the baseline fields.
    assert rows["p1"]["fair_value"] == rows["p1"]["model_bid_hint"]
