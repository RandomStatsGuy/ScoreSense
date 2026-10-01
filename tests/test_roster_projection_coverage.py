"""Shared forecasts cover the actual NFL roster, independent of the DFS bundle."""
import pandas as pd

from src.projections.roster_coverage import projection_roster_players
from src.core.projection_context import build_inference_roster
from src.integrations.sleeper import apply_sleeper_roster_overlay


def players():
    return pd.DataFrame([
        {'sleeper_id':'1','gsis_id':'00-0000001','full_name':'Injured Star','team':'BUF','position':'WR',
         'status':'Inactive','injury_status':'IR','years_exp':5,'depth_chart_order':1,'search_rank':1},
        {'sleeper_id':'2','gsis_id':'00-0000002','full_name':'Retired Player','team':'BUF','position':'WR',
         'status':'Active','injury_status':'','years_exp':5,'depth_chart_order':2,'search_rank':99},
    ])


def nfl():
    return pd.DataFrame([
        {'player_id':'00-0000001','player_name':'Injured Star','team':'NE','position':'WR','status':'RES'},
        {'player_id':'00-0000002','player_name':'Retired Player','team':'BUF','position':'WR','status':'RET'},
        {'player_id':'00-0000003','player_name':'New Receiver','team':'BUF','position':'WR','status':'ACT'},
        {'player_id':'00-0000004','player_name':'Cut Receiver','team':'BUF','position':'WR','status':'CUT'},
    ])


def history():
    return pd.DataFrame([
        {'player_id':'00-0000001','player_display_name':'Injured Star','team':'BUF','position':'WR',
         'season':2025,'week':18,'target_share_avg':0.2,'Fpts':15},
        {'player_id':'00-0000002','player_display_name':'Retired Player','team':'BUF','position':'WR',
         'season':2025,'week':18,'target_share_avg':0.1,'Fpts':5},
    ])


def test_rostered_injured_and_new_players_have_features_but_retired_and_cut_do_not():
    identities=projection_roster_players(2026,sleeper_df=players(),nflverse_df=nfl())
    assert identities.loc[identities.full_name.eq('Injured Star'),'team'].item()=='NE'
    assert identities.loc[identities.full_name.eq('Injured Star'),'injury_status'].item()=='IR'
    roster,_=apply_sleeper_roster_overlay(history(),'wr',season=2026,target_week=4,sleeper_df=identities,add_missing=True)
    assert set(roster.player_id)=={'00-0000001','00-0000003'}
    assert roster.loc[roster.player_id.eq('00-0000001'),'_projection_injury_status'].item()=='IR'
    assert roster.loc[roster.player_id.eq('00-0000003'),'_roster_estimate'].item()
    assert roster.target_share_avg.notna().all()


def test_full_coverage_runs_in_season_without_starter_pruning_or_dfs_inputs(monkeypatch):
    features=history().assign(season=2026,week=2)
    monkeypatch.setattr('src.projections.roster_coverage.projection_roster_players',lambda season:projection_roster_players(season,sleeper_df=players(),nflverse_df=nfl()))
    monkeypatch.setattr('src.integrations.roster_identity.apply_roster_identity_overlay',lambda frame,*a,**k:(frame,{}))
    def prune(*a,**k):
        raise AssertionError('A shared forecast must not prune bench players')
    monkeypatch.setattr('src.core.depth_chart.filter_depth_chart_starters',prune)
    roster,meta=build_inference_roster(features,'wr',2026,4,depth_mode='coverage')
    assert set(roster.player_id)=={'00-0000001','00-0000003'}
    assert meta['roster_overlay']['applied']


def test_ros_uses_all_shared_weekly_rows_without_dfs_specialist_artifact(monkeypatch):
    from src.projections import ros_projections
    weekly=pd.DataFrame([
        {'player_id':'starter','Position':'WR','Projected Points':20,'Low (P10)':10,'High (P90)':30},
        {'player_id':'bench','Position':'TE','Projected Points':5,'Low (P10)':1,'High (P90)':10},
    ])
    monkeypatch.setattr(ros_projections,'load_weekly_prediction',lambda *a,**k:weekly.copy())
    monkeypatch.setattr('src.projections.dfs_pool.load_dfs_pool',lambda *a:(_ for _ in ()).throw(AssertionError('DFS input requested')))
    result=ros_projections._load_or_predict_weekly('wr',2026,4,apply_injury_adjustments=True,data_dir=None,model_dir=None,df=pd.DataFrame())
    assert result.player_id.tolist()==['starter','bench']
    assert result.iloc[0]['Projected Points']==20


def test_season_receiver_endpoint_includes_tight_ends(monkeypatch):
    from src.draft_hub import draft_pool_cache
    pool=pd.DataFrame([{'player_id':'wr','Position':'WR'}, {'player_id':'te','Position':'TE'}, {'player_id':'qb','Position':'QB'}])
    monkeypatch.setattr(draft_pool_cache,'load_draft_pool',lambda *a,**kw:pool.copy())
    monkeypatch.setattr(draft_pool_cache,'load_pool_meta',lambda *a:{})
    assert draft_pool_cache.draft_pool_for_position('wr',2026).player_id.tolist()==['wr','te']


def test_roster_revisions_invalidate_every_projection_cache(monkeypatch):
    from src.projections import weekly_cache,ros_cache,roster_coverage
    from src.draft_hub import draft_pool_cache
    revision=['old']
    monkeypatch.setattr(roster_coverage,'roster_input_revisions',lambda:revision)
    loaders=[weekly_cache.weekly_fingerprint,ros_cache.ros_fingerprint,draft_pool_cache.pool_fingerprint]
    before=[load() for load in loaders]
    revision[0]='new player'
    assert all(load()!=old for load,old in zip(loaders,before))


def test_all_historical_players_retired_still_allows_new_roster_profiles():
    identities=projection_roster_players(2026,sleeper_df=players(),nflverse_df=nfl())
    old=history().loc[lambda frame:frame.player_id.eq('00-0000002')]
    roster,_=apply_sleeper_roster_overlay(old,'wr',season=2026,target_week=4,sleeper_df=identities,add_missing=True)
    assert set(roster.player_id)=={'00-0000001','00-0000003'}
