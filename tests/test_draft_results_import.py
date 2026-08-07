"""Tests for draft results import and movement story resolution."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from src.draft_hub.contract_movement_resolve import (
    apply_story_to_movements,
    build_owner_changes_payload,
    group_ambiguous_movements,
    group_departures_by_owner,
    resolve_updates_for_movement,
)
from src.draft_hub.draft_results_import import (
    apply_draft_tags_to_rows,
    find_draft_win,
    load_draft_wins_by_season,
    parse_draft_excel,
    resolve_winner_label,
)
from src.draft_hub.legacy_contract_reconcile import infer_movements_from_snapshots


def test_resolve_winner_label_aliases():
    assert resolve_winner_label("Carter", {"Carter": "Josh C"}) == "Josh C"
    assert resolve_winner_label("Aaron D") == "Aaron D"


def test_parse_draft_excel_loads_rows(tmp_path: Path):
    xlsx = tmp_path / "drafts.xlsx"
    df = pd.DataFrame(
        [
            {"Player": "Tyreek Hill", "$": 39, "Winner": "Aaron D", "Year": 2024},
            {"Player": "Bad Winner", "$": 1, "Winner": "Nobody", "Year": 2024},
        ]
    )
    df.to_excel(xlsx, index=False)
    by_year = parse_draft_excel(xlsx)
    assert 2024 in by_year
    assert len(by_year[2024]) == 1
    assert by_year[2024][0]["owner_label"] == "Aaron D"


def test_apply_draft_tags_marks_acquisition():
    wins = {
        2024: [
            {
                "season_year": 2024,
                "player_name": "Tyreek Hill",
                "owner_label": "Aaron D",
                "cap_hit": 39.0,
                "source": "excel",
            }
        ]
    }
    rows = [
        {
            "season_year": 2024,
            "player_name": "Tyreek Hill",
            "owner_label": "Aaron D",
            "cap_hit": 39,
            "roster_status": "active",
            "acquisition_type": "unknown",
        }
    ]
    tagged, count = apply_draft_tags_to_rows(rows, wins)
    assert count == 1
    assert tagged[0]["acquisition_type"] == "draft"
    assert tagged[0]["original_draft_year"] == 2024


def test_find_draft_win_fuzzy_last_name():
    indexed = {
        2024: {
            "tyreekhill": {
                "season_year": 2024,
                "player_name": "Tyreek Hill",
                "owner_label": "Aaron D",
                "cap_hit": 39.0,
            }
        }
    }
    win = find_draft_win(2024, "T Hill", "Aaron D", indexed)
    assert win is not None
    assert win["player_name"] == "Tyreek Hill"


def test_load_draft_wins_includes_excel_when_present():
    wins, meta = load_draft_wins_by_season()
    if not (Path("old_league_files") / "2022-2025 Drafts.xlsx").exists():
        pytest.skip("draft excel not present locally")
    assert meta.get("total_wins", 0) >= 100
    assert "2024" in (meta.get("sources") or {})


def test_resolve_story_cut_and_draft():
    mov = {"event_type": "trade_out", "from_owner": "Aaron D", "to_owner": "Nick F"}
    assert resolve_updates_for_movement(mov, "cut")["event_type"] == "cut"
    mov_in = {"event_type": "trade_in", "from_owner": "Aaron D", "to_owner": "Nick F"}
    assert resolve_updates_for_movement(mov_in, "draft_win")["event_type"] == "draft"


def test_group_ambiguous_pairs_trade_rows():
    movements = [
        {"id": 1, "confidence": "ambiguous", "player_name": "X", "from_owner": "A", "to_owner": "B", "event_type": "trade_out"},
        {"id": 2, "confidence": "ambiguous", "player_name": "X", "from_owner": "A", "to_owner": "B", "event_type": "trade_in"},
    ]
    groups = group_ambiguous_movements(movements)
    assert len(groups) == 1
    assert sorted(groups[0]["movement_ids"]) == [1, 2]


def test_group_departures_bulk_from_one_owner():
    movements = [
        {"id": 1, "confidence": "ambiguous", "player_name": "P1", "from_owner": "Aaron D", "to_owner": "B", "event_type": "trade_out"},
        {"id": 2, "confidence": "ambiguous", "player_name": "P1", "from_owner": "Aaron D", "to_owner": "B", "event_type": "trade_in"},
        {"id": 3, "confidence": "ambiguous", "player_name": "P2", "from_owner": "Aaron D", "to_owner": "C", "event_type": "trade_out"},
        {"id": 4, "confidence": "ambiguous", "player_name": "P2", "from_owner": "Aaron D", "to_owner": "C", "event_type": "trade_in"},
        {"id": 5, "confidence": "ambiguous", "player_name": "P3", "from_owner": "Aaron D", "to_owner": "D", "event_type": "trade_out"},
        {"id": 6, "confidence": "ambiguous", "player_name": "P3", "from_owner": "Aaron D", "to_owner": "D", "event_type": "trade_in"},
    ]
    bulk = group_departures_by_owner(movements)
    assert len(bulk) == 1
    assert bulk[0]["from_owner"] == "Aaron D"
    assert bulk[0]["player_count"] == 3
    assert len(bulk[0]["movement_ids"]) == 6


def test_build_owner_changes_payload_shape():
    payload = build_owner_changes_payload([], season_year=2024)
    assert payload["season_year"] == 2024
    assert "player_stories" in payload
    assert "stories" in payload


def test_infer_movements_draft_tagged_not_ambiguous(monkeypatch):
    prev_rows = [
        {"player_name": "Player One", "owner_label": "Aaron D", "roster_status": "active", "cap_hit": 10},
    ]
    curr_rows = [
        {
            "player_name": "Player One",
            "owner_label": "Nick F",
            "roster_status": "active",
            "cap_hit": 20,
            "acquisition_type": "draft",
        },
    ]

    def fake_list(league_id, season_year=None, owner_label=None):
        if season_year == 2023:
            return prev_rows
        if season_year == 2024:
            return curr_rows
        return []

    monkeypatch.setattr(
        "src.draft_hub.legacy_contract_reconcile.storage.list_league_contract_rows",
        fake_list,
    )
    events = infer_movements_from_snapshots("lg", season_year=2024)
    types = [e["event_type"] for e in events]
    assert "cut" in types
    assert "draft" in types
    assert "trade_out" not in types


def test_apply_story_to_movements_updates_storage(monkeypatch):
    store = {
        5: {
            "id": 5,
            "league_id": "lg",
            "event_type": "trade_out",
            "from_owner": "Aaron D",
            "confidence": "ambiguous",
        }
    }

    def get_mov(mid):
        return store.get(int(mid))

    def update_mov(mid, updates):
        store[int(mid)] = {**store[int(mid)], **updates}
        return store[int(mid)]

    monkeypatch.setattr("src.draft_hub.contract_movement_resolve.storage.get_league_movement", get_mov)
    monkeypatch.setattr("src.draft_hub.contract_movement_resolve.storage.update_league_movement", update_mov)

    updated = apply_story_to_movements("lg", [5], "cut")
    assert updated[0]["event_type"] == "cut"
    assert updated[0]["confidence"] == "manual"
