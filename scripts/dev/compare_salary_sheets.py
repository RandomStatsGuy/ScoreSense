"""Compare salary sheet payload vs fresh Excel parse."""
import pandas as pd

from src.config import OLD_LEAGUE_FILES_DIR
from src.draft_hub import storage
from src.draft_hub.legacy_contract_history import _displayable_contract_row, dedupe_contract_rows
from src.draft_hub.legacy_contract_import import (
    YEAR_FILES,
    load_owner_team_map,
    parse_2022_sheet,
    parse_2023_sheet,
    parse_modern_owner_sheet,
)
from src.draft_hub.team_salary_sheets import _team_totals, build_team_salary_sheets_payload

LID = "76a70d52-d059-4421-86b2-378d8ebe8381"
owner_map = load_owner_team_map()


def excel_owner_rows(year: int, owner: str):
    path = OLD_LEAGUE_FILES_DIR / YEAR_FILES[year]
    df = pd.read_excel(path, sheet_name=owner, header=None)
    if year >= 2024:
        return parse_modern_owner_sheet(df, owner, year, owner_map)
    if year == 2023:
        return parse_2023_sheet(df, owner, owner_map)
    return parse_2022_sheet(df, owner, owner_map)


for yr in [2024, 2025]:
    print("year", yr)
    payload = build_team_salary_sheets_payload(LID, season_year=yr)
    for owner in ["Caleb K", "Dawson O", "Aaron D"]:
        ex = excel_owner_rows(yr, owner)
        ex_active = sum(r["cap_hit"] for r in ex if r["roster_status"] == "active")
        ex_dead = sum(r["cap_hit"] for r in ex if r["roster_status"] == "cut")
        db = dedupe_contract_rows(
            [
                r
                for r in storage.list_league_contract_rows(LID, season_year=yr)
                if _displayable_contract_row(r) and r["owner_label"] == owner
            ]
        )
        dbt = _team_totals(db, salary_cap=200)
        sheet = next((s for s in payload["team_sheets"] if s["owner_label"] == owner), None)
        st = sheet["totals"] if sheet else {}
        print(
            f"  {owner}: excel active={ex_active} dead={ex_dead} n={len(ex)}"
            f" | db deduped {dbt['committed']}/{dbt['dead_cap']} n={len(db)}"
            f" | UI sheet {st.get('committed')}/{st.get('dead_cap')} n={len(sheet['rows']) if sheet else 0}"
        )
        ex_names = {r["player_name"] for r in ex}
        db_names = {r["player_name"] for r in db}
        if ex_names != db_names:
            print("    ex-only", sorted(ex_names - db_names)[:6])
            print("    db-only", sorted(db_names - ex_names)[:6])
