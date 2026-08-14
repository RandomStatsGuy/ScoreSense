"""SCORE-40: live/historic cache revisions advance on salary/type/status edits."""

from __future__ import annotations

from src.draft_hub import storage
from src.draft_hub.contracts import build_contract_from_roster_edit
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.team_salary_sheets import build_team_salary_sheets_payload


def _seed_league_with_player(hub_db, *, sub: str = "rev-commish"):
    league = storage.create_league(sub, "SCORE-40 League", 2026, LeagueRules(), team_count=2)
    lid = league["id"]
    teams = storage.list_league_teams(lid)
    team_a = teams[0]
    team_b = storage.get_or_create_league_team_by_name(lid, "Team B", float(LeagueRules().salary_cap))
    ws = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(
        ws,
        {
            "player_id": "00-0035676",
            "player_name": "J. Chase",
            "team": "CIN",
            "position": "WR",
            "salary": 40.0,
            "contract_years": 2,
            "source": "manual",
            "contract": {
                "contract_type": "veteran",
                "current_salary": 40.0,
                "years_remaining": 2,
                "salary_schedule": [40.0, 45.0],
            },
        },
        team_id=team_a["id"],
    )
    return lid, ws, team_a, team_b


def test_salary_and_second_edit_bump_live_and_insights(hub_db):
    lid, ws, team_a, _ = _seed_league_with_player(hub_db)
    live0 = storage.league_cache_revisions(lid)["live_roster_revision"]
    v0 = storage.insights_source_version(lid)
    r0 = storage.roster_source_version(lid)

    rules = LeagueRules()
    contract = build_contract_from_roster_edit(
        rules,
        current_salary=55.0,
        years_remaining=2,
        existing={
            "contract_type": "veteran",
            "current_salary": 40.0,
            "years_remaining": 2,
            "salary_schedule": [40.0, 45.0],
        },
        step_up=5.0,
    )
    storage.update_roster_slot(
        ws,
        "00-0035676",
        team_id=team_a["id"],
        contract=contract,
        edited_by_sub="rev-commish",
        note="office current salary",
    )
    live1 = storage.league_cache_revisions(lid)["live_roster_revision"]
    v1 = storage.insights_source_version(lid)
    r1 = storage.roster_source_version(lid)
    assert live1 == live0 + 1
    assert v1 != v0
    assert r1 != r0

    # Second salary edit on the same already-manual row must still bump.
    contract2 = build_contract_from_roster_edit(
        rules,
        current_salary=60.0,
        years_remaining=2,
        existing=contract,
        step_up=5.0,
    )
    storage.update_roster_slot(
        ws,
        "00-0035676",
        team_id=team_a["id"],
        contract=contract2,
        edited_by_sub="rev-commish",
    )
    live2 = storage.league_cache_revisions(lid)["live_roster_revision"]
    v2 = storage.insights_source_version(lid)
    assert live2 == live1 + 1
    assert v2 != v1

    with storage.get_conn() as conn:
        audits = conn.execute(
            "SELECT field_name, live_revision FROM league_roster_edit WHERE league_id = ? ORDER BY id",
            (lid,),
        ).fetchall()
    assert any(a["field_name"] == "salary" for a in audits)
    assert max(int(a["live_revision"]) for a in audits) == live2


def test_type_schedule_status_team_and_mapping_bump(hub_db):
    lid, ws, team_a, team_b = _seed_league_with_player(hub_db)
    live0 = storage.league_cache_revisions(lid)["live_roster_revision"]
    hist0 = storage.league_cache_revisions(lid)["historic_snapshot_revision"]

    storage.set_roster_contract_type(
        ws,
        "00-0035676",
        "extension",
        team_id=team_a["id"],
        any_team=True,
        edited_by_sub="rev-commish",
    )
    live1 = storage.league_cache_revisions(lid)["live_roster_revision"]
    assert live1 == live0 + 1

    rules = LeagueRules()
    existing = storage.get_roster_slot(ws, "00-0035676")["contract"]
    scheduled = build_contract_from_roster_edit(
        rules,
        current_salary=float(existing["current_salary"]),
        years_remaining=3,
        existing=existing,
        step_up=5.0,
        salary_schedule=[50.0, 55.0, 60.0],
        contract_type="extension",
    )
    storage.update_roster_slot(
        ws,
        "00-0035676",
        team_id=team_a["id"],
        contract=scheduled,
        edited_by_sub="rev-commish",
    )
    live2 = storage.league_cache_revisions(lid)["live_roster_revision"]
    assert live2 == live1 + 1

    storage.update_roster_slot(
        ws,
        "00-0035676",
        team_id=team_a["id"],
        roster_status="cut_before_draft",
        edited_by_sub="rev-commish",
    )
    live3 = storage.league_cache_revisions(lid)["live_roster_revision"]
    assert live3 == live2 + 1

    # Team-only transfer advances live revision.
    moved = storage.transfer_roster_players(
        ws, ["00-0035676"], team_a["id"], team_b["id"]
    )
    assert moved == 1
    live4 = storage.league_cache_revisions(lid)["live_roster_revision"]
    assert live4 == live3 + 1

    # Player mapping metadata bump.
    storage.update_roster_metadata(
        ws,
        "00-0035676",
        sleeper_player_id="12345",
        player_name="Ja'Marr Chase",
    )
    live5 = storage.league_cache_revisions(lid)["live_roster_revision"]
    assert live5 == live4 + 1

    # Owner-season mapping advances historic revision + insights version.
    v_before = storage.insights_source_version(lid)
    storage.upsert_owner_season_map(
        lid, 2025, "Aaron D", "Team A Mapped", source_kind="manual"
    )
    hist1 = storage.league_cache_revisions(lid)["historic_snapshot_revision"]
    assert hist1 == hist0 + 1
    assert storage.insights_source_version(lid) != v_before


def test_historic_second_salary_edit_bumps_even_when_already_manual(hub_db):
    lid, _, _, _ = _seed_league_with_player(hub_db)
    row = storage.insert_league_contract_row(
        lid,
        2025,
        {
            "owner_label": "Aaron D",
            "player_name": "J. Chase",
            "position": "WR",
            "cap_hit": 40.0,
            "roster_status": "active",
            "source_kind": "manual",
        },
    )
    hist1 = storage.league_cache_revisions(lid)["historic_snapshot_revision"]
    v1 = storage.insights_source_version(lid)

    storage.update_league_contract_row(
        row["id"],
        {"cap_hit": 48.0},
        edited_by_sub="rev-commish",
        note="first salary fix",
    )
    hist2 = storage.league_cache_revisions(lid)["historic_snapshot_revision"]
    v2 = storage.insights_source_version(lid)
    assert hist2 == hist1 + 1
    assert v2 != v1

    # Already manual: count-based fingerprint would stay flat; revision must still move.
    storage.update_league_contract_row(
        row["id"],
        {"cap_hit": 52.0},
        edited_by_sub="rev-commish",
        note="second salary fix",
    )
    hist3 = storage.league_cache_revisions(lid)["historic_snapshot_revision"]
    v3 = storage.insights_source_version(lid)
    assert hist3 == hist2 + 1
    assert v3 != v2


def test_team_salary_sheets_include_revision_source_version(hub_db):
    lid, _, _, _ = _seed_league_with_player(hub_db)
    storage.insert_league_contract_row(
        lid,
        2025,
        {
            "owner_label": "Aaron D",
            "player_name": "J. Chase",
            "position": "WR",
            "cap_hit": 40.0,
            "roster_status": "active",
        },
    )
    payload = build_team_salary_sheets_payload(lid, season_year=2025)
    assert payload.get("available") is True
    assert "source_version" in payload
    assert payload["source_version"] == storage.insights_source_version(lid)
    revs = storage.league_cache_revisions(lid)
    assert payload["historic_snapshot_revision"] == revs["historic_snapshot_revision"]
    assert payload["live_roster_revision"] == revs["live_roster_revision"]
