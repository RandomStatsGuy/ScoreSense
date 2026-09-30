from fastapi.testclient import TestClient
from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.cap_planner import cap_planner_data
from src.draft_hub.contracts import build_veteran_contract, build_extension_contract
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules

def rules():
    raw=load_preset("salary_cap_auction_v1").model_dump()
    raw["contracts"]["allow_veteran_renewal"]=True
    return LeagueRules.model_validate(raw)

def row(pid="allen", salary=33, years=2):
    return {"player_id":pid,"player_name":"Josh Allen","team":"BUF","position":"QB","salary":salary,"contract_years":years,"roster_status":"active","contract":build_veteran_contract(salary,years,static=True)}

def test_server_schedules_and_extension_horizon():
    roster=[row()]; before=repr(roster)
    data=cap_planner_data(rules(),roster,draft_completed=True)
    assert data["summary"]["remaining"]==167
    assert len(data["multi_year_plan"])==5
    entry=data["planning_rows"][0]
    assert entry["extension_eligible_offset"]==1
    assert entry["extension_terms"][1]=={"years":2,"start_offset":2,"salaries":[38,43]}
    assert entry["cap_hits"]==[33,33,0,0,0]
    assert repr(roster)==before

def test_predraft_expiry_and_extension_starts_current_year():
    data=cap_planner_data(rules(),[row(years=1)],draft_completed=False)
    assert data["summary"]["remaining"]==200
    assert data["planning_rows"][0]["cap_hits"][0]==0
    assert data["planning_rows"][0]["extension_terms"][0]["start_offset"]==0
    assert data["planning_rows"][0]["extension_terms"][0]["salaries"]==[38]

def test_extensions_and_cut_rows_cannot_extend():
    extended=row();extended["contract"]=build_extension_contract(rules(),start_salary=33,years=2)
    cut=row("cut",salary=17);cut["roster_status"]="cut_before_draft"
    data=cap_planner_data(rules(),[extended,cut],draft_completed=True)
    assert all(not r["extension_terms"] for r in data["planning_rows"])
    assert data["multi_year_plan"][0]["dead_cap"]==8
    assert data["multi_year_plan"][1].get("dead_cap",0)==0
    assert data["summary"]["remaining"]==159

def test_readonly_league_cap_endpoint_checks_membership_and_keeps_focus(hub_db):
    comm="cap-comm"; member="cap-member"
    ws=storage.get_or_create_workspace(comm)
    league=storage.create_league(comm,"Cap league",2026,rules(),workspace_id=ws["id"])
    a=storage.get_team_by_user(league["id"],comm)
    b=storage.join_league(member,league["room_code"],"Other team")
    storage.add_roster_slot(ws["id"],row(),team_id=a["id"])
    storage.add_roster_slot(ws["id"],row("other",40,2),team_id=b["id"])
    before=storage.get_hub_focus_league_id(member)
    app.dependency_overrides[require_hub_user]=lambda:{"sub":member,"auth_type":"dev"}
    try:
        with TestClient(app) as client:
            result=client.get(f"/api/hub/league/{league['id']}/cap-plans")
            assert result.status_code==200
            assert len(result.json()["teams"])==2
            assert storage.get_hub_focus_league_id(member)==before
            app.dependency_overrides[require_hub_user]=lambda:{"sub":"outsider","auth_type":"dev"}
            assert client.get(f"/api/hub/league/{league['id']}/cap-plans").status_code==403
    finally: app.dependency_overrides.pop(require_hub_user,None)


def test_dead_cap_and_reacquired_player_keep_separate_schedules():
    active = row(salary=20)
    cut = row(salary=17)
    cut["roster_status"] = "cut_before_draft"
    data = cap_planner_data(rules(), [active, cut], draft_completed=True)
    assert [r["cap_hits"][0] for r in data["planning_rows"]] == [20, 8]
    assert data["summary"]["remaining"] == 172
    assert data["planning_rows"][1]["extension_terms"] == []
