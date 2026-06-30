"""Legacy dynasty contract import parsers."""

from __future__ import annotations

from pathlib import Path

import pytest

from src.draft_hub.legacy_contract_import import (
    TEAM_OWNERS,
    load_owner_team_map,
    parse_2021_pdf,
    parse_2022_sheet,
    parse_modern_owner_sheet,
    process_league_history,
)
from src.draft_hub.legacy_contract_history import _displayable_contract_row
from src.draft_hub.player_name_match import is_garbage_player_name
from src.config import OLD_LEAGUE_FILES_DIR


@pytest.fixture()
def owner_map():
    return load_owner_team_map()


def test_process_league_history_parses_excel_files(owner_map):
    if not OLD_LEAGUE_FILES_DIR.exists():
        pytest.skip("old_league_files not present")
    df = process_league_history(OLD_LEAGUE_FILES_DIR)
    assert not df.empty
    assert set(df["season_year"].unique()) >= {2021, 2022, 2023, 2024, 2025}
    assert set(df["owner_label"].unique()).issubset(set(TEAM_OWNERS))
    assert df["cap_hit"].notna().any()


def test_2021_pdf_parser_splits_grid_cells(owner_map):
    pdf = OLD_LEAGUE_FILES_DIR / "2021 Fantasy Draft Results.pdf"
    if not pdf.exists():
        pytest.skip("2021 PDF missing")
    rows = parse_2021_pdf(pdf, owner_map)
    assert len(rows) >= 220
    garbage = [r for r in rows if is_garbage_player_name(r["player_name"])]
    assert not garbage, garbage[0]["player_name"]
    displayable = [r for r in rows if _displayable_contract_row(r)]
    assert len(displayable) >= 220
    mahomes = next((r for r in rows if r["player_name"] == "P Mahomes"), None)
    assert mahomes is not None
    assert mahomes["cap_hit"] == 32
    assert mahomes["owner_label"] == "Caleb K"
    taylor = next((r for r in rows if r["player_name"] == "J Taylor"), None)
    assert taylor is not None
    assert taylor["cap_hit"] == 42


def test_2022_sheet_parser(owner_map):
    path = OLD_LEAGUE_FILES_DIR / "2022 Dynasty League Rosters.xlsx"
    if not path.exists():
        pytest.skip("2022 workbook missing")
    import pandas as pd

    df = pd.read_excel(path, sheet_name="Aaron D", header=None)
    rows = parse_2022_sheet(df, "Aaron D", owner_map)
    assert len(rows) >= 5
    assert rows[0]["season_year"] == 2022
    assert rows[0]["hub_team_name"] == owner_map.get("Aaron D")


def test_2025_cut_row_marked(owner_map):
    path = OLD_LEAGUE_FILES_DIR / "2025 Dynasty League Free Agency Decisions.xlsx"
    if not path.exists():
        pytest.skip("2025 workbook missing")
    import pandas as pd

    df = pd.read_excel(path, sheet_name="Caleb K", header=None)
    rows = parse_modern_owner_sheet(df, "Caleb K", 2025, owner_map)
    richard = next((r for r in rows if "Richardson" in r["player_name"]), None)
    assert richard is not None
    assert richard["roster_status"] == "cut"


def test_modern_sheet_skips_cap_summary_rows(owner_map):
    path = OLD_LEAGUE_FILES_DIR / "2024 Dynasty League Rosters - Season.xlsx"
    if not path.exists():
        pytest.skip("2024 workbook missing")
    import pandas as pd

    df = pd.read_excel(path, sheet_name="Aaron D", header=None)
    rows = parse_modern_owner_sheet(df, "Aaron D", 2024, owner_map)
    assert rows
    assert not any(r["player_name"].lower() == "nan" for r in rows)
    caps = {r["cap_hit"] for r in rows if r["player_name"].lower() == "nan"}
    assert not caps
    assert 111 not in {r["cap_hit"] for r in rows}
    assert 200 not in {r["cap_hit"] for r in rows}


def test_infer_movements_year_over_year(hub_db):
    from src.draft_hub import storage
    from src.draft_hub.legacy_contract_reconcile import infer_movements_from_snapshots
    from src.draft_hub.schemas import LeagueRules

    league = storage.create_league("legacy", "Legacy", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "Test Player",
                "cap_hit": 10,
                "roster_status": "active",
            }
        ],
    )
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Caleb K",
                "player_name": "Test Player",
                "cap_hit": 12,
                "roster_status": "active",
            }
        ],
    )
    events = infer_movements_from_snapshots(lid, season_year=2025)
    types = {e["event_type"] for e in events}
    assert "trade_out" in types or "trade_in" in types
