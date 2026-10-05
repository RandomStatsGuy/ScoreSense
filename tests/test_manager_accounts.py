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
    assert owners.resolve('a. import')=='A. Import'
    assert owners.resolve('A.') is None
    assert owners.resolve('Another spelling')=='A. Import'
    other=storage.create_league(b,'Other',2026,LeagueRules())
    assert ManagerOwnerMap({},other['id'],2025).resolve('A. Import') is None
    assert storage.get_team_by_user(lid,a)==before
    assert storage.delete_manager_account_map(lid,row['id'])
    assert ManagerOwnerMap({},lid,2025).resolve('A. Import') is None


def test_season_override_is_used_by_champions_and_contracts(league_accounts):
    lid,a,b,x=league_accounts
    save(lid,'owner_label','A. Import',a)
    save(lid,'owner_label','A. Import',b,2025,manager_name='Bob Real')
    owners=ManagerOwnerMap({'Old nickname':'A. Import'},lid,'all')
    champion=enrich_team_row({'team_name':'Old nickname','owner_name':'A. Import','season':'2025'},owners)
    assert champion['owner_name']=='Bob Real'
    assert champion['manager_account_sub']==b
    landing=enrich_insights_landing({'champions':[{'season':'2025','team_name':'Other team',
        'runner_up':'Old nickname','runner_up_owner_id':'stable-alice'}]},owners,{'stable-alice':'A. Import'})
    assert landing['champions'][0]['runner_up_owner_name']=='Bob Real'
    assert enrich_team_row({'team_name':'Old nickname','owner_name':'A. Import','season':'2026'},owners)['owner_name']=='A. Import'
    rows=build_contract_returns(lid)['rows']
    assert {r['season']:r['owner_name'] for r in rows}=={2025:'Bob Real',2026:'A. Import'}
    assert all(r['team_name'] in {'New nickname','Old nickname'} for r in rows)


def test_saved_sleeper_id_wins_over_old_labels_and_renamed_teams(league_accounts):
    lid,a,b,x=league_accounts
    save(lid,'sleeper_user_id','stable-alice',a)
    owners,sleepers=scoring_owner_maps_for_league(lid,season_year='all',sleeper_league_id='current',cached_only=True)
    row=enrich_team_row({'team_name':'Unknown future name','owner_id':'stable-alice','owner_name':'OldUsername'},owners,sleeper_owner_map=sleepers)
    assert row['owner_name']=='A. Import'
    assert row['team_name']=='Unknown future name' and row['owner_id']=='stable-alice'
    award=enrich_award_display({'id':'award'},team_name='Unknown future name',owner_label='OldUsername',owner_map=owners,sleeper_user_id='stable-alice')
    assert award['owner_name']=='A. Import'
    assert all(r['owner_name']=='A. Import' for r in build_contract_returns(lid)['rows'])


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
            assert overview['landing']['most_titles']['owner_name']!='Josh C'
            payload={'source_kind':'sleeper_user_id','source_key':'stable-alice','account_sub':a,'manager_name':'Josh C'}
            user['sub']=b
            assert client.get(base+'/manager-accounts').status_code==403
            assert client.put(base+'/manager-accounts',json=payload).status_code==403
            user['sub']=x
            assert client.get(base+'/manager-accounts').status_code==403
            user['sub']=a
            saved=client.put(base+'/manager-accounts',json=payload)
            assert saved.status_code==200,saved.text
            map_id=saved.json()['id']
            assert client.get(base+'/insights/overview').json()['landing']['most_titles']['owner_name']=='Josh C'
            user_store.update_display_name(a[3:],'Alice Renamed')
            assert client.get(base+'/insights/overview').json()['landing']['most_titles']['owner_name']=='Josh C'
            user['sub']=b
            assert client.delete(base+f'/manager-accounts/{map_id}').status_code==403
            user['sub']=a
            assert client.delete(base+f'/manager-accounts/{map_id}').status_code==200
            assert client.get(base+'/insights/overview').json()['landing']['most_titles']['owner_name']!='Josh C'
    finally: app.dependency_overrides.pop(require_hub_user,None)


def test_import_mapping_renames_awards_and_salary_sheet_display_but_preserves_source(league_accounts):
    lid,a,b,x=league_accounts
    save(lid,'owner_label','A. Import',a)
    owners,_=scoring_owner_maps_for_league(lid,season_year=2025,cached_only=True)
    award=enrich_award_display({'season_year':2025},team_name='Old nickname',owner_label='A. Import',owner_map=owners,year_specific=True)
    assert award['display_name']=='Old nickname · A. Import'
    app.dependency_overrides[require_hub_user]=lambda:{'sub':a}
    try:
        with TestClient(app) as client:
            out=client.get(f'/api/hub/league/{lid}/contract-history?season=2025')
            assert out.status_code==200,out.text
            assert out.json()['rows'][0]['owner_label']=='A. Import'
            assert out.json()['rows'][0]['owner_name']=='A. Import'
    finally: app.dependency_overrides.pop(require_hub_user,None)


def test_mapping_survives_reimport_and_database_restart(league_accounts):
    lid,a,b,x=league_accounts
    row=save(lid,'owner_label','A. Import',a)
    storage.upsert_owner_season_map(lid,2025,'A. Import','Renamed original',source_kind='sleeper')
    storage._DB_INITIALIZED=False
    assert storage.list_manager_account_maps(lid)[0]['id']==row['id']
    assert ManagerOwnerMap({},lid,2025).resolve('A. Import')=='A. Import'


def test_legacy_josh_link_shows_real_name_for_account_and_saved_sleeper_identity(league_accounts):
    lid,a,b,x=league_accounts
    user_store.update_display_name(a[3:], 'jdcarter40')
    # Simulate a link written by the already-merged release, without a display-name field.
    with storage.get_conn() as conn:
        conn.execute("INSERT INTO league_manager_account_map (league_id,source_kind,source_key,season_year,account_sub,created_at,updated_at) VALUES (?,?,?,0,?,'old','old')",
                     (lid,'owner_label','Josh C',a))
    storage.upsert_owner_season_map(lid,2025,'Josh C','Old nickname',sleeper_user_id='stable-alice')
    owners,sleepers=scoring_owner_maps_for_league(lid,season_year='all',cached_only=True)
    assert owners.resolve('jdcarter40')=='Josh C'
    assert owners.resolve(uid='stable-alice',season=2025)=='Josh C'
    assert owners.resolve(uid='stable-alice')=='Josh C'
    row=enrich_team_row({'team_name':'Old nickname','owner_id':'stable-alice','owner_name':'jdcarter40'},owners,sleeper_owner_map=sleepers)
    assert row['display_name']=='Josh C'
    assert enrich_team_row({**row,'season':2025},owners,year_specific=True)['display_name']=='Old nickname · Josh C'
    mapped=settings(lid)['mappings'][0]
    assert mapped['manager_name']=='Josh C' and mapped['display_name']=='jdcarter40'
    from src.draft_hub.owner_display import attach_owner_names_to_teams
    team=storage.get_team_by_user(lid,a)
    team['name']='Entirely new name'
    assert attach_owner_names_to_teams(lid,[team])[0]['owner_name']=='Josh C'


def test_display_name_edit_applies_to_aliases_and_year_overrides_without_changing_sources(league_accounts):
    lid,a,b,x=league_accounts
    save(lid,'owner_label','A. Import',a,manager_name='Josh C')
    save(lid,'owner_label','Other alias',a)
    save(lid,'owner_label','A. Import',a,2025,manager_name='Josh Carter')
    owners=ManagerOwnerMap({},lid,2025)
    assert owners.resolve('Other alias')=='Josh Carter'
    assert owners.resolve('Other alias',season=2026)=='Josh C'
    assert owners.resolve(uid='stable-alice',season=2025)=='Josh Carter'
    assert {r['season']:r['owner_name'] for r in build_contract_returns(lid)['rows']}=={2025:'Josh Carter',2026:'Josh C'}
    assert storage.list_league_contract_rows(lid,season_year=2025)[0]['owner_label']=='A. Import'
    with pytest.raises(ValueError): save(lid,'owner_label','A. Import',a,manager_name=' ')
    with pytest.raises(ValueError): save(lid,'owner_label','A. Import',a,manager_name='x'*121)


def test_ambiguous_public_handles_do_not_link_unrelated_rows(league_accounts):
    lid,a,b,x=league_accounts
    user_store.update_display_name(a[3:],'Same handle')
    user_store.update_display_name(b[3:],'Same handle')
    save(lid,'owner_label','Josh C',a)
    save(lid,'owner_label','Bob Real',b)
    assert ManagerOwnerMap({},lid,2025).resolve('Same handle') is None


def test_legacy_schema_adds_display_name_without_losing_existing_links(league_accounts):
    lid,a,b,x=league_accounts
    with storage.get_conn() as conn:
        conn.execute('ALTER TABLE league_manager_account_map DROP COLUMN manager_name')
        conn.execute("INSERT INTO league_manager_account_map (league_id,source_kind,source_key,season_year,account_sub,created_at,updated_at) VALUES (?,?,?,0,?,'old','old')", (lid,'owner_label','Josh C',a))
    storage._DB_INITIALIZED=False
    assert ManagerOwnerMap({},lid,2026).resolve('Josh C')=='Josh C'
    assert storage.list_manager_account_maps(lid)[0]['manager_name'] is None


def test_identity_reads_never_deserialize_full_weekly_scoring_cache(league_accounts, monkeypatch):
    lid,a,b,x=league_accounts
    save(lid,'owner_label','A. Import',a,manager_name='Josh C')
    def forbidden(*args, **kwargs): pytest.fail('Loaded full weekly scoring cache for a manager name')
    monkeypatch.setattr(storage,'get_sleeper_scoring_cache',forbidden)
    assert ManagerOwnerMap({},lid,2025).resolve(uid='stable-alice')=='Josh C'
    assert any(r['source_key']=='stable-alice' for r in settings(lid)['sources'])


def test_cached_scoring_awards_and_all_time_spend_use_current_mapped_names(league_accounts):
    lid,a,b,x=league_accounts
    save(lid,'owner_label','A. Import',a,manager_name='Josh C')
    storage.upsert_insights_scoring_derived('prior','2025',awards=[{'id':'points_king','owner_name':'Alice Account','display_name':'Alice Account'}],efficiency={'available':False,'teams':[]})
    app.dependency_overrides[require_hub_user]=lambda:{'sub':a}
    try:
        with TestClient(app) as client:
            out=client.get(f'/api/hub/league/{lid}/insights/scoring?scoring_season=2025')
            assert out.status_code==200,out.text
            king=next(r for r in out.json()['scoring']['awards'] if r['id']=='points_king')
            assert king['owner_name']=='Josh C'
            assert king['display_name']=='Old nickname · Josh C'
            assert king['team_name']=='Old nickname'
        enriched=hub_routes._enrich_cap_analytics({'identity':'owner','teams':[{'team_name':'A. Import','owner_label':'A. Import','identity':'owner'}]},lid,year_specific=False)
        assert enriched['teams'][0]['display_name']=='Josh C'
    finally: app.dependency_overrides.pop(require_hub_user,None)


def test_current_claimed_account_beats_an_old_team_nickname_alias(league_accounts):
    lid,a,b,x=league_accounts
    save(lid,'owner_label','Josh C',a)
    save(lid,'owner_label','Bob Real',b)
    # This nickname used to belong to Josh; the current native team belongs to Bob.
    owners=ManagerOwnerMap({'Bob team':'Josh C'},lid,2026)
    assert owners['Bob team']=='Bob Real'
    historical=ManagerOwnerMap({'Bob team':'Josh C'},lid,2025)
    assert historical['Bob team']=='Josh C'
