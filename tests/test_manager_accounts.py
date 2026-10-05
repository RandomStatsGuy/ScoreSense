import pytest
from fastapi.testclient import TestClient
from app.api import app
from app.auth import require_hub_user
from app import hub_routes
from src.auth import user_store
from src.draft_hub import storage
from src.draft_hub.manager_accounts import settings, save, ManagerOwnerMap
from src.draft_hub.owner_display import enrich_team_row, enrich_award_display, enrich_insights_landing, scoring_owner_maps_for_league
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.season_scoring import save_week
from src.draft_hub.contract_returns import build_contract_returns


@pytest.fixture
def league_accounts(hub_db, auth_db, monkeypatch):
    a = user_store.create_user('alice@example.com', 'test-hash', 'Alice Account')
    b = user_store.create_user('bob@example.com', 'test-hash', 'Bob Account')
    x = user_store.create_user('outsider@example.com', 'test-hash', 'Private Outside Account')
    a, b, x = (f"ss:{r['id']}" for r in (a,b,x))
    league = storage.create_league(a, 'Names', 2026, LeagueRules())
    lid = league['id']
    storage.join_league(a, league['room_code'], 'New nickname')
    storage.join_league(b, league['room_code'], 'Bob team')
    storage.update_league_sleeper_id(lid, 'current')
    storage.upsert_sleeper_league_chain('current', [{'league_id':'current', 'season':'2026'}, {'league_id':'prior', 'season':'2025'}])
    for year, source, name in [(2026,'current','New nickname'),(2025,'prior','Old nickname')]:
        storage.upsert_sleeper_scoring_cache(source, {'available':True,'season':str(year),
            'standings':[{'owner_id':'stable-alice','owner_name':'OldUsername','team_name':name,'roster_id':'1',
                          'wins':3,'losses':1,'weeks_scored':4,'total_points':100}], 'weeks':[],
            'playoff':{'champion_owner_id':'stable-alice','champion_team_name':name,'champion_roster_id':'1'}})
        storage.upsert_owner_season_map(lid, year, 'A. Import', name, sleeper_user_id='stable-alice')
        storage.insert_league_contract_row(lid,year,{'owner_label':'A. Import','hub_team_name':name,
            'player_name':'Test Player','player_id':'player','position':'WR','base_salary':20})
        save_week(source,year,1,[{'aliases':['player'],'points':100,'position':'WR'}])
    monkeypatch.setattr('src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season', lambda: {})
    def forbidden(*args,**kwargs): pytest.fail('Name mapping contacted Sleeper')
    monkeypatch.setattr('src.draft_hub.league_history._fetch_json',forbidden)
    monkeypatch.setattr('src.integrations.sleeper_league.fetch_league_users',forbidden)
    hub_routes._clear_insights_response_cache()
    yield lid,a,b,x
    hub_routes._clear_insights_response_cache()


def test_settings_only_exposes_public_league_accounts_and_saved_sources(league_accounts):
    lid,a,b,x=league_accounts
    result=settings(lid)
    assert {r['account_sub'] for r in result['accounts']} == {a,b}
    assert 'email' not in str(result) and x not in str(result)
    assert any(r['source_key']=='stable-alice' and r['label']=='OldUsername' for r in result['sources'])
    assert not any(r['source_key']=='Stephen P' for r in result['sources'])


def test_links_are_league_scoped_exact_reversible_and_do_not_assign_seats(league_accounts):
    lid,a,b,x=league_accounts
    before = storage.get_team_by_user(lid,a)
    row=save(lid,'owner_label','A. Import',a)
    save(lid,'owner_label','Another spelling',a)
    owners=ManagerOwnerMap({'Old nickname':'A. Import'},lid,2025)
    assert owners.resolve('a. import')=='Alice Account'
    assert owners.resolve('A.') is None
    assert owners.resolve('Another spelling')=='Alice Account'
    other=storage.create_league(b,'Other',2026,LeagueRules())
    assert ManagerOwnerMap({},other['id'],2025).resolve('A. Import') is None
    assert storage.get_team_by_user(lid,a)==before
    assert storage.delete_manager_account_map(lid,row['id'])
    assert ManagerOwnerMap({},lid,2025).resolve('A. Import') is None


def test_season_override_is_used_by_champions_and_contracts(league_accounts):
    lid,a,b,x=league_accounts
    save(lid,'owner_label','A. Import',a)
    save(lid,'owner_label','A. Import',b,2025)
    owners=ManagerOwnerMap({'Old nickname':'A. Import'},lid,'all')
    champion=enrich_team_row({'team_name':'Old nickname','owner_name':'A. Import','season':'2025'},owners)
    assert champion['owner_name']=='Bob Account'
    assert champion['manager_account_sub']==b
    landing=enrich_insights_landing({'champions':[{'season':'2025','team_name':'Other team',
        'runner_up':'Old nickname','runner_up_owner_id':'stable-alice'}]},owners,{'stable-alice':'A. Import'})
    assert landing['champions'][0]['runner_up_owner_name']=='Bob Account'
    assert enrich_team_row({'team_name':'Old nickname','owner_name':'A. Import','season':'2026'},owners)['owner_name']=='Alice Account'
    rows=build_contract_returns(lid)['rows']
    assert {r['season']:r['owner_name'] for r in rows}=={2025:'Bob Account',2026:'Alice Account'}
    assert all(r['team_name'] in {'New nickname','Old nickname'} for r in rows)


def test_saved_sleeper_id_wins_over_old_labels_and_renamed_teams(league_accounts):
    lid,a,b,x=league_accounts
    save(lid,'sleeper_user_id','stable-alice',a)
    owners,sleepers=scoring_owner_maps_for_league(lid,season_year='all',sleeper_league_id='current',cached_only=True)
    row=enrich_team_row({'team_name':'Unknown future name','owner_id':'stable-alice','owner_name':'OldUsername'},owners,sleeper_owner_map=sleepers)
    assert row['owner_name']=='Alice Account'
    assert row['team_name']=='Unknown future name' and row['owner_id']=='stable-alice'
    award=enrich_award_display({'id':'award'},team_name='Unknown future name',owner_label='OldUsername',owner_map=owners,sleeper_user_id='stable-alice')
    assert award['owner_name']=='Alice Account'
    assert all(r['owner_name']=='Alice Account' for r in build_contract_returns(lid)['rows'])


def test_unknown_or_outside_accounts_and_foreign_sleeper_ids_are_rejected(league_accounts):
    lid,a,b,x=league_accounts
    with pytest.raises(ValueError): save(lid,'owner_label','A. Import',x)
    with pytest.raises(ValueError): save(lid,'owner_label','A. Import','ss:missing')
    with pytest.raises(ValueError): save(lid,'sleeper_user_id','foreign-owner',a)
    with pytest.raises(ValueError): save(lid,'team_name','Name',a)
    with pytest.raises(ValueError): save(lid,'owner_label','',a)


def test_http_commissioner_only_and_response_cache_updates_after_save_rename_remove(league_accounts):
    lid,a,b,x=league_accounts
    user={'sub':a}
    app.dependency_overrides[require_hub_user]=lambda:user
    try:
        with TestClient(app) as client:
            base=f'/api/hub/league/{lid}'
            overview=client.get(base+'/insights/overview').json()
            assert overview['landing']['most_titles']['owner_name']!='Alice Account'
            payload={'source_kind':'sleeper_user_id','source_key':'stable-alice','account_sub':a}
            user['sub']=b
            assert client.get(base+'/manager-accounts').status_code==403
            assert client.put(base+'/manager-accounts',json=payload).status_code==403
            user['sub']=x
            assert client.get(base+'/manager-accounts').status_code==403
            user['sub']=a
            saved=client.put(base+'/manager-accounts',json=payload)
            assert saved.status_code==200,saved.text
            map_id=saved.json()['id']
            assert client.get(base+'/insights/overview').json()['landing']['most_titles']['owner_name']=='Alice Account'
            user_store.update_display_name(a[3:],'Alice Renamed')
            assert client.get(base+'/insights/overview').json()['landing']['most_titles']['owner_name']=='Alice Renamed'
            user['sub']=b
            assert client.delete(base+f'/manager-accounts/{map_id}').status_code==403
            user['sub']=a
            assert client.delete(base+f'/manager-accounts/{map_id}').status_code==200
            assert client.get(base+'/insights/overview').json()['landing']['most_titles']['owner_name']!='Alice Renamed'
    finally: app.dependency_overrides.pop(require_hub_user,None)


def test_import_mapping_renames_awards_and_salary_sheet_display_but_preserves_source(league_accounts):
    lid,a,b,x=league_accounts
    save(lid,'owner_label','A. Import',a)
    owners,_=scoring_owner_maps_for_league(lid,season_year=2025,cached_only=True)
    award=enrich_award_display({'season_year':2025},team_name='Old nickname',owner_label='A. Import',owner_map=owners,year_specific=True)
    assert award['display_name']=='Alice Account · Old nickname'
    app.dependency_overrides[require_hub_user]=lambda:{'sub':a}
    try:
        with TestClient(app) as client:
            out=client.get(f'/api/hub/league/{lid}/contract-history?season=2025')
            assert out.status_code==200,out.text
            assert out.json()['rows'][0]['owner_label']=='A. Import'
            assert out.json()['rows'][0]['owner_name']=='Alice Account'
    finally: app.dependency_overrides.pop(require_hub_user,None)


def test_mapping_survives_reimport_and_database_restart(league_accounts):
    lid,a,b,x=league_accounts
    row=save(lid,'owner_label','A. Import',a)
    storage.upsert_owner_season_map(lid,2025,'A. Import','Renamed original',source_kind='sleeper')
    storage._DB_INITIALIZED=False
    assert storage.list_manager_account_maps(lid)[0]['id']==row['id']
    assert ManagerOwnerMap({},lid,2025).resolve('A. Import')=='Alice Account'
