"""Staff can reconcile debt for retired/unlisted players without roster writes."""
import pytest

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.pre_draft_cap import total_pre_draft_dead_cap, contract_on_cut_status_change
from src.draft_hub.schemas import LeagueRules
from tests.test_trade_proposals import _two_team_league, _client_for


def record(league, team, **overrides):
    return {"team_id": team["id"], "season": league["season"],
            "player_name": "James Conner", "position": "RB", "amount": 3, **overrides}


def post_as(sub, league, body):
    client = _client_for(sub)
    try:
        return client.post(f"/api/hub/league/{league['id']}/dead-cap", json=body)
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_unlisted_player_debt_is_audited_and_expires(hub_db):
    league, a, b, ws, comm, _ = _two_team_league(hub_db)
    before = storage.get_league(league["id"])["live_roster_revision"]
    res = post_as(comm, league, record(league, b))
    assert res.status_code == 200, res.text
    row = res.json()["roster_slot"]
    assert row["player_name"] == "James Conner"
    assert row["salary"] == 0  # No fabricated original salary or active deal.
    assert row["roster_status"] == "cut_before_draft"
    assert not row["can_undo_cut"]
    assert row["contract"]["dead_cap_record"]["season"] == 2026
    assert row["contract"]["dead_cap_record"]["recorded_by"] == comm
    rows = storage.list_team_roster(league["id"], b["id"])
    rules = LeagueRules.model_validate(league["rules"])
    assert total_pre_draft_dead_cap(rules, rows) == 3
    assert total_pre_draft_dead_cap(rules, rows, year_offset=1) == 0
    assert len([r for r in rows if storage.roster_row_occupies(r)]) == 1
    assert storage.get_league(league["id"])["live_roster_revision"] > before
    with storage.get_conn() as conn:
        audit = dict(conn.execute("SELECT * FROM league_roster_edit WHERE roster_slot_id = ?", (row["id"],)).fetchone())
    assert audit["field_name"] == "dead_cap_amount"
    assert float(audit["new_value"]) == 3
    assert audit["edited_by_sub"] == comm
    with pytest.raises(ValueError, match="cannot be undone"):
        contract_on_cut_status_change(row, roster_status="active")
    # A double click or alternate spelling must not double-charge the cap.
    again = post_as(comm, league, record(league, b, player_name="  James Conner  "))
    assert again.status_code == 409
    storage.update_league_season(league["id"], 2027)
    assert total_pre_draft_dead_cap(rules, storage.list_team_roster(league["id"], b["id"])) == 0


def test_existing_waived_or_other_team_active_contract_is_preserved(hub_db):
    league, a, b, ws, comm, _ = _two_team_league(hub_db)
    existing = storage.list_team_roster(league["id"], a["id"])[0]
    res = post_as(comm, league, record(league, b, player_name="Player A", position="WR"))
    assert res.status_code == 200, res.text
    assert res.json()["roster_slot"]["player_id"] == "p-a"
    assert storage.list_team_roster(league["id"], a["id"])[0] == existing
    storage.set_roster_slot_status(ws["id"], existing["id"], "waived")
    # Recording on the former team reuses the identity but retains waived history.
    res = post_as(comm, league, record(league, a, player_name="Player A", position="WR"))
    assert res.status_code == 200, res.text
    statuses = {r["roster_status"] for r in storage.list_team_roster(league["id"], a["id"])}
    assert statuses == {"waived", "cut_before_draft"}


@pytest.mark.parametrize("overrides", [{"amount": 0}, {"amount": -1}, {"amount": 1.5},
                                       {"player_name": "   "}, {"season": 2025}, {"position": "INVALID"}])
def test_invalid_records_do_not_write(hub_db, overrides):
    league, a, b, ws, comm, _ = _two_team_league(hub_db)
    before = storage.list_league_roster(ws["id"])
    res = post_as(comm, league, record(league, b, **overrides))
    assert res.status_code in {400, 422}
    assert storage.list_league_roster(ws["id"]) == before


def test_only_target_league_commissioner_can_write(hub_db):
    league, a, b, ws, comm, member = _two_team_league(hub_db)
    assert post_as(member, league, record(league, b)).status_code == 403
    assert post_as("outsider", league, record(league, b)).status_code == 403
    other = storage.create_league(comm, "Other", 2026, LeagueRules())
    other_team = storage.get_team_by_user(other["id"], comm)
    assert post_as(comm, league, record(league, other_team)).status_code == 400
    assert not any(r["roster_status"] == "cut_before_draft" for r in storage.list_league_roster(ws["id"]))


def test_existing_cut_and_pick_leagues_are_rejected(hub_db):
    league, a, b, ws, comm, _ = _two_team_league(hub_db)
    storage.update_roster_slot(ws["id"], "p-a", team_id=a["id"], roster_status="cut_before_draft")
    before = storage.list_team_roster(league["id"], a["id"])
    assert post_as(comm, league, record(league, a, player_name="Player A", position="WR")).status_code == 409
    assert storage.list_team_roster(league["id"], a["id"]) == before
    storage.update_league_rules(league["id"], LeagueRules(draft_type="snake"))
    assert post_as(comm, league, record(league, b)).status_code == 400


def test_recorded_debt_survives_filters_and_can_be_removed_without_creating_a_player(hub_db):
    from src.draft_hub.hub_context import filter_team_sleeper_roster

    league, a, b, ws, comm, _ = _two_team_league(hub_db)
    row = post_as(comm, league, record(league, b)).json()["roster_slot"]
    assert filter_team_sleeper_roster({**b, "sleeper_roster_id": "2", "sleeper_player_ids": ["someone-else"]}, [row]) == [row]
    client = _client_for(comm)
    try:
        undo = client.patch("/api/hub/roster", json={"player_id": row["player_id"], "roster_slot_id": row["id"], "roster_status": "active", "note": "Attempt to undo recorded debt"})
        assert undo.status_code == 400, undo.text
        response = client.request("DELETE", "/api/hub/roster", json={"player_id": row["player_id"], "roster_slot_id": row["id"]})
        assert response.status_code == 200, response.text
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
    rows = storage.list_team_roster(league["id"], b["id"])
    assert len(rows) == 1 and rows[0]["player_id"] == "p-b"
    assert total_pre_draft_dead_cap(LeagueRules.model_validate(league["rules"]), rows) == 0


def test_recorded_charge_blocks_over_cap_adds_even_outside_current_roster_positions(hub_db):
    from src.draft_hub.rules_engine import cap_summary, blocking_acquisition_errors
    from src.draft_hub.pre_draft_cap import pre_draft_cap_summary

    league, a, b, ws, comm, _ = _two_team_league(hub_db)
    response = post_as(comm, league, record(league, b, player_name="Retired kicker", position="K"))
    assert response.status_code == 200, response.text
    cut = response.json()["roster_slot"]
    rules = LeagueRules.model_validate(league["rules"])
    rows = storage.list_team_roster(league["id"], b["id"])
    summary = cap_summary(rules, rows)
    assert summary["spent"] == 38
    assert summary["remaining"] == 162
    assert summary["roster_size"] == 1
    planned = pre_draft_cap_summary(rules, rows)
    assert planned["dead_cap"] == 3
    assert planned["pending_cuts"][0]["roster_status"] == "cut_before_draft"
    assert planned["pending_cuts"][0]["contract"]["dead_cap_recorded"]
    new_player = {"player_id": "new", "player_name": "New player", "position": "QB", "salary": 198, "contract_years": 1}
    assert any("cap" in err.lower() for err in blocking_acquisition_errors(rules, [cut, new_player]))
