"""Official cached IDs resolve current players without collapsing namesakes."""
import json
import pandas as pd
import pytest
from src.draft_hub import player_identity

PEOPLE=[
    ('11573','00-0039471','Frank Gore Jr.','RB','BUF'),
    ('13301','00-0041040','Antonio Williams','WR','WAS'),
    ('12547','00-0040131','Kyle Williams','WR','NE'),
    ('7865','00-0036775','Brandon Smith','WR','PIT'),
    ('8138','00-0037248','James Cook III','RB','BUF'),
]

@pytest.fixture
def catalog(tmp_path,monkeypatch,trusted_native_catalog):
    monkeypatch.setattr(player_identity,'CACHE_DIR',tmp_path,raising=False)
    for sid,pid,name,pos,team in PEOPLE:
        trusted_native_catalog(sid,name=name,position=pos,team=team)
    trusted_native_catalog('232',name='Frank Gore',position='RB',team='FA',gsis_id='00-0023500')
    trusted_native_catalog('7437',name='Kyle Williams',position='WR',team='FA')
    trusted_native_catalog('638',name='Kyle Williams',position='WR',team='FA')
    trusted_native_catalog('7203',name='Antonio Williams',position='RB',team='FA')
    trusted_native_catalog('8324',name='Brandon Smith',position='LB',team='FA')
    rows=[{'player_id':pid,'player_name':name.replace(' III',''),'position':pos,'team':team}
          for sid,pid,name,pos,team in PEOPLE]
    path=tmp_path/'nflverse_roster_2026.parquet'
    pd.DataFrame(rows).to_parquet(path,index=False)
    def forbidden(*a,**kw):raise AssertionError('Identity resolution must be cache only')
    monkeypatch.setattr('src.integrations.sleeper.load_sleeper_players',forbidden)
    monkeypatch.setattr('src.integrations.nflverse_roster.load_seasonal_roster',forbidden)
    monkeypatch.setattr('src.projections.draft_projections.predict_draft_season',forbidden)
    return path,trusted_native_catalog

@pytest.mark.parametrize('sid,pid,name,pos,team',PEOPLE)
def test_official_cached_roster_bridges_missing_gsis(catalog,sid,pid,name,pos,team):
    for alias in (sid,'sleeper-'+sid,pid):
        identity=player_identity.read_player_identity(alias,season=2026)
        assert identity['status']=='resolved' and identity['canonical_id']==pid
        assert identity['position']==pos and identity['team']==team
        assert {sid,'sleeper-'+sid,pid}<=set(identity['aliases'])

def test_namesakes_keep_distinct_identities(catalog):
    assert player_identity.read_player_identity('232',season=2026)['canonical_id']=='00-0023500'
    for sid in ('7437','638','7203'):
        assert player_identity.read_player_identity(sid,season=2026)['canonical_id']==sid

def test_wrong_linked_id_stays_rejected(catalog):
    with pytest.raises(player_identity.PlayerIdentityError):
        player_identity.cached_player_identity('00-0039471',season=2026,sleeper_player_id='232')

def test_same_team_namesake_is_not_guessed(catalog):
    _,register=catalog
    register('second-kyle',name='Kyle Williams',position='WR',team='NE')
    assert player_identity.read_player_identity('00-0040131',season=2026)['status']=='unresolved'
    assert player_identity.read_player_identity('12547',season=2026)['canonical_id']=='12547'

def test_conflicting_official_ids_are_not_guessed(catalog):
    path,_=catalog
    frame=pd.read_parquet(path)
    frame=pd.concat([frame,pd.DataFrame([{'player_id':'00-0099999','player_name':'Kyle Williams','position':'WR','team':'NE'}])],ignore_index=True)
    frame.to_parquet(path,index=False)
    assert player_identity.read_player_identity('00-0040131',season=2026)['status']=='unresolved'

def test_roster_replacement_invalidates_cached_crosswalk(catalog):
    path,_=catalog
    assert player_identity.read_player_identity('00-0040131',season=2026)['status']=='resolved'
    frame=pd.read_parquet(path)
    frame=frame[frame.player_id.ne('00-0040131')]
    frame.to_parquet(path,index=False)
    assert player_identity.read_player_identity('00-0040131',season=2026)['status']=='unresolved'

def test_requested_season_does_not_borrow_a_different_roster(catalog):
    assert player_identity.read_player_identity('00-0039471',season=2025)['status']=='unresolved'

def test_known_provider_gsis_cannot_be_replaced(catalog):
    _,register=catalog
    register('8138',name='James Cook III',position='RB',team='BUF')
    # The source cache carries a conflicting established GSIS: do not replace it.
    from src.integrations.sleeper import PLAYERS_CACHE
    raw=json.loads(PLAYERS_CACHE.read_text());raw['8138']['gsis_id']='00-0099998'
    PLAYERS_CACHE.write_text(json.dumps(raw))
    assert player_identity.read_player_identity('8138',season=2026)['canonical_id']=='00-0099998'
    assert player_identity.read_player_identity('00-0037248',season=2026)['status']=='unresolved'
