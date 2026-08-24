"""Cap-sheet parser + league-scoped import."""

from __future__ import annotations

from pathlib import Path

from src.draft_hub import storage
from src.draft_hub.cap_sheet_import import (
    import_cap_sheet_to_league,
    parse_cap_sheet_tsv,
    parse_contract_term,
)
from src.draft_hub.schemas import LeagueRules

_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "draft_hub" / "cap_sheet_test.tsv"


def _tsv(*rows: str, header: str | None = None) -> bytes:
    cols = header or "manager\tposition\tplayer\tsalary\tcontract\tyear2\tyear3\tyear4"
    return (cols + "\n" + "\n".join(rows)).encode("utf-8")


def test_parse_contract_term_na_and_fraction():
    assert parse_contract_term("NA 2026", season=2025) == (1, False, True)
    assert parse_contract_term("NA 2027", season=2025) == (2, False, True)
    assert parse_contract_term("1/2", season=2025) == (2, False, False)
    assert parse_contract_term("2/2", season=2025) == (1, False, False)
    assert parse_contract_term("CUT", season=2025)[1] is True


def test_fixture_matches_2025_sheet_salaries():
    parsed = parse_cap_sheet_tsv(_FIXTURE.read_text(encoding="utf-8"), season=2025, rules=LeagueRules())
    assert parsed["stats"]["unmatched"] == 0
    assert parsed["stats"]["duplicates"] == 0
    assert parsed["stats"]["matched"] >= 150

    by_name = {(r["manager_team"], r["player_name"]): r for r in parsed["rows"]}
    stroud = by_name[("Aaron D", "C.J. Stroud")]
    assert stroud["salary"] == 7
    assert stroud["contract_years"] == 2

    hall = by_name[("Aaron D", "Breece Hall")]
    assert hall["salary"] == 32
    assert hall["contract_years"] == 1

    skattebo = by_name[("Aaron D", "Cam Skattebo")]
    assert skattebo["salary"] == 9
    assert skattebo["contract_years"] == 2

    dolphins = next(r for r in parsed["rows"] if r["manager_team"] == "Aaron D" and r["position"] == "DEF")
    assert dolphins["player_name"].strip()
    assert "dolphin" in dolphins["player_name"].lower() or dolphins["team"] == "MIA"

    brian = by_name[("Andrew M", "Brian Robinson")]
    assert brian["salary"] == 0
    bijan = by_name[("Andrew M", "Bijan Robinson")]
    assert bijan["salary"] == 37

    gordon = next(r for r in parsed["rows"] if "Gordon" in str(r["player_name"]) and r["manager_team"] == "Andrew M")
    assert gordon["salary"] == 0
    assert gordon["roster_status"] == "active"


def test_import_keeps_active_when_cut_exists_elsewhere(hub_db):
    rules = LeagueRules()
    comm = "cap-import-comm"
    ws = storage.get_or_create_workspace(comm)
    league = storage.create_league(
        comm, "Cap Import", 2026, rules, workspace_id=ws["id"], team_count=4,
        commissioner_team_name="Thanks noob noob",
    )
    storage.get_or_create_league_team_by_name(league["id"], "White Supremacists", rules.salary_cap)
    raw = _tsv(
        "Aaron D\tWR\tTyreek Hill\t39\tNA 2026",
        "Caleb K\tWR\tTyreek Hill\t\tCUT",
    )
    parsed = parse_cap_sheet_tsv(raw, season=2025, rules=rules)
    result = import_cap_sheet_to_league(
        league["id"],
        parsed,
        {"Aaron D": "Thanks noob noob", "Caleb K": "White Supremacists"},
        replace_existing=True,
        historic_season=2025,
    )
    assert result["imported"] == 1
    assert result["historic"] == 2
    assert any("Tyreek" in s for s in result["skipped_cut_elsewhere"])

    by_team = storage.list_league_rosters_by_team(league["id"])
    teams = {t["name"]: t["id"] for t in storage.list_league_teams(league["id"])}
    aaron = by_team[teams["Thanks noob noob"]]
    caleb = by_team[teams["White Supremacists"]]
    assert len(aaron) == 1
    assert aaron[0]["player_name"] == "Tyreek Hill"
    assert aaron[0]["roster_status"] == "active"
    assert aaron[0]["salary"] == 39
    assert caleb == []

    historic = storage.list_league_contract_rows(league["id"], season_year=2025)
    imports = [r for r in historic if r.get("source_kind") == "import"]
    assert len(imports) == 2


def test_import_clears_only_this_league_rosters(hub_db):
    rules = LeagueRules()
    ws = storage.get_or_create_workspace("cap-wipe-a")
    league_a = storage.create_league(
        "cap-wipe-a", "League A", 2026, rules, workspace_id=ws["id"],
        commissioner_team_name="Alpha Team",
    )
    league_b = storage.create_league(
        "cap-wipe-b", "League B", 2026, rules, workspace_id=ws["id"],
        commissioner_team_name="Beta Team",
    )
    team_b = storage.list_league_teams(league_b["id"])[0]
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "keep-other-league",
            "player_name": "Keep Me",
            "team": "KC",
            "position": "QB",
            "salary": 9,
            "contract_years": 1,
        },
        team_id=team_b["id"],
    )
    raw = _tsv("MGR\tQB\tPatrick Mahomes\t25\t1/2")
    parsed = parse_cap_sheet_tsv(raw, season=2025, rules=rules)
    import_cap_sheet_to_league(
        league_a["id"], parsed, {"MGR": "Alpha Team"}, replace_existing=True
    )
    leftover = storage.list_league_rosters_by_team(league_b["id"])[team_b["id"]]
    assert any(r["player_id"] == "keep-other-league" for r in leftover)
    imported = storage.list_league_rosters_by_team(league_a["id"])
    team_a = next(t for t in storage.list_league_teams(league_a["id"]) if t["name"] == "Alpha Team")
    assert any("Mahomes" in str(r["player_name"]) for r in imported[team_a["id"]])


def test_import_seeds_commissioner_year_sheets(hub_db, tmp_path, monkeypatch):
    """Replace import becomes the editable Sheets year book, not a hidden overlay."""
    from src.draft_hub.contract_rows_merged import _COMMISSIONER_ROWS_CACHE
    from src.draft_hub.sleeper_week1_snapshot import SOURCE_KIND
    from src.draft_hub.team_salary_sheets import build_team_salary_sheets_payload

    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.OLD_LEAGUE_FILES_DIR",
        tmp_path / "no-excel",
    )
    _COMMISSIONER_ROWS_CACHE["key"] = None
    _COMMISSIONER_ROWS_CACHE["rows"] = None

    rules = LeagueRules()
    comm = "cap-sheet-tabs"
    ws = storage.get_or_create_workspace(comm)
    league = storage.create_league(
        comm, "Sheet League", 2026, rules, workspace_id=ws["id"], team_count=4,
        commissioner_team_name="Thanks noob noob",
    )
    storage.replace_league_contract_season_source(
        league["id"],
        2026,
        [
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Thanks noob noob",
                "player_name": "Tyreek Hill",
                "position": "WR",
                "base_salary": 1,
                "cap_hit": 1,
                "roster_status": "active",
                "source_kind": SOURCE_KIND,
            }
        ],
        source_kind=SOURCE_KIND,
    )
    raw = _tsv("Aaron D\tWR\tTyreek Hill\t39\tNA 2026")
    parsed = parse_cap_sheet_tsv(raw, season=2025, rules=rules)
    result = import_cap_sheet_to_league(
        league["id"],
        parsed,
        {"Aaron D": "Thanks noob noob"},
        replace_existing=True,
    )
    assert result["sheet_season"] == 2026
    assert result["historic"] >= 1

    payload = build_team_salary_sheets_payload(league["id"], season_year=2026)
    assert payload.get("available") is True
    sheets = payload.get("team_sheets") or []
    rows = []
    for sheet in sheets:
        rows.extend(sheet.get("rows") or [])
    tyreek = next((r for r in rows if "Hill" in str(r.get("player_name") or "")), None)
    assert tyreek is not None, payload
    assert float(tyreek.get("cap_hit") or 0) == 39

    week1 = [
        r for r in storage.list_league_contract_rows(league["id"], season_year=2026)
        if r.get("source_kind") == SOURCE_KIND
    ]
    assert week1 == []


def test_cap_sheet_validate_accepts_multipart_file(hub_db):
    from fastapi.testclient import TestClient

    from app.api import app
    from app.auth import require_hub_user

    sub = "cap-upload-api"
    storage.create_league(
        sub, "Upload League", 2026, LeagueRules(),
        commissioner_team_name="Thanks noob noob",
    )
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    client = TestClient(app)
    try:
        missing = client.post("/api/hub/cap-sheet/validate?replace_existing=true")
        assert missing.status_code == 422
        detail = missing.json()["detail"]
        assert any("file" in str(d.get("loc", "")).lower() for d in detail)

        raw = _tsv("Aaron D\tQB\tPatrick Mahomes\t25\t1/2")
        ok = client.post(
            "/api/hub/cap-sheet/validate?replace_existing=true",
            files={"file": ("cap.tsv", raw, "text/tab-separated-values")},
        )
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert body["ok"] is True
        assert body["stats"]["matched"] >= 1
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_match_hub_team_does_not_substring_steal():
    from src.draft_hub.cap_sheet_import import match_hub_team

    disappointment = {"id": "d", "name": "Disappointment"}
    thanks = {"id": "t", "name": "Thanks noob noob"}
    noob = {"id": "n", "name": "noob"}
    hub = {
        "disappointment": disappointment,
        "thanks noob noob": thanks,
        "noob": noob,
    }
    assert match_hub_team(hub, "Thanks noob noob")["id"] == "t"
    assert match_hub_team(hub, "Disappointment")["id"] == "d"
    hub_short = {"disappointment": disappointment, "noob": noob}
    assert match_hub_team(hub_short, "Thanks noob noob") is None


def test_import_keeps_aaron_and_josh_on_yaml_teams(hub_db):
    from src.draft_hub.team_salary_sheets import build_team_salary_sheets_payload

    rules = LeagueRules()
    comm = "cap-swap-comm"
    ws = storage.get_or_create_workspace(comm)
    league = storage.create_league(
        comm, "Swap League", 2026, rules, workspace_id=ws["id"], team_count=4,
        commissioner_team_name="Thanks noob noob",
    )
    storage.get_or_create_league_team_by_name(league["id"], "Disappointment", rules.salary_cap)
    storage.upsert_owner_season_map(
        league["id"], 2026, "Aaron D", "Disappointment", source_kind="manual"
    )
    storage.upsert_owner_season_map(
        league["id"], 2026, "Josh C", "Thanks noob noob", source_kind="manual"
    )
    raw = _tsv(
        "Aaron D\tQB\tC.J. Stroud\t7\t1/2",
        "Josh C\tQB\tJustin Herbert\t23\t3/3",
    )
    parsed = parse_cap_sheet_tsv(raw, season=2025, rules=rules)
    import_cap_sheet_to_league(
        league["id"],
        parsed,
        {"Aaron D": "Thanks noob noob", "Josh C": "Disappointment"},
        replace_existing=True,
    )
    teams = {t["name"]: t["id"] for t in storage.list_league_teams(league["id"])}
    by_team = storage.list_league_rosters_by_team(league["id"])
    aaron_names = [r["player_name"] for r in by_team[teams["Thanks noob noob"]]]
    josh_names = [r["player_name"] for r in by_team[teams["Disappointment"]]]
    assert any("Stroud" in n for n in aaron_names)
    assert any("Herbert" in n for n in josh_names)
    assert not any("Herbert" in n for n in aaron_names)
    assert not any("Stroud" in n for n in josh_names)
    assert storage.resolve_hub_team_name(league["id"], 2026, "Aaron D") == "Thanks noob noob"
    assert storage.resolve_hub_team_name(league["id"], 2026, "Josh C") == "Disappointment"

    payload = build_team_salary_sheets_payload(league["id"], season_year=2026)
    sheets = {s["owner_label"]: s for s in payload.get("team_sheets") or []}
    assert any("Stroud" in str(r.get("player_name")) for r in sheets["Aaron D"]["rows"])
    assert any("Herbert" in str(r.get("player_name")) for r in sheets["Josh C"]["rows"])
    assert sheets["Aaron D"]["team_name"] == "Thanks noob noob"
    assert sheets["Josh C"]["team_name"] == "Disappointment"
