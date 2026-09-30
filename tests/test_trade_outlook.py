import pandas as pd
from src.draft_hub import trade_outlook as trade

def overview(rows,completed=True):
    return {'league': {'season': 2026, 'draft_completed': completed}, 'teams': [{'roster': rows}]}

def test_identity_alias_and_unique_name_match_preserve_missing():
    pool=pd.DataFrame([{'player_id':'123','Player':'Josh Allen','Position':'QB','Season P50':300}, {'player_id':'456','Player':'James Cook','Position':'RB','Season P50':200}])
    rows=[{'player_id':'sleeper-123','player_name':'Allen','position':'QB'}, {'player_id':'native-cook','player_name':'James Cook','position':'RB'}, {'player_id':'missing','player_name':'Unknown','position':'K'}]
    result=trade.outlook_from_frames(overview(rows),pool,pd.DataFrame(),week=1)
    assert result['players']['sleeper-123']['remaining_points']==300
    assert result['players']['native-cook']['remaining_points']==200
    assert result['players']['missing']['remaining_points'] is None
    assert trade.outlook_from_frames(overview(rows),pool,pd.DataFrame(),week=4)['players']['sleeper-123']['remaining_points'] is None

def test_ambiguous_names_do_not_pick_arbitrary_player():
    frame=pd.DataFrame([{'Player':'Same Name','Position':'RB'}, {'Player':'Same Name','Position':'RB'}])
    assert trade.match({'player_id':'x','player_name':'Same Name','position':'RB'},frame) is None

def test_cache_reader_never_requests_inference_or_identity(monkeypatch,tmp_path):
    calls=[]
    monkeypatch.setattr(trade,'load_draft_pool',lambda season,**kw:calls.append((season,kw)) or pd.DataFrame())
    monkeypatch.setattr(trade,'ROS_PREDICTIONS_DIR',tmp_path)
    monkeypatch.setattr('src.core.schedule_utils.current_projection_week',lambda season:4)
    result=trade.build_trade_outlook(overview([{'player_id':'x'}]))
    assert calls==[(2026,{'allow_compute':False,'apply_identity':False})]
    assert result['players']['x']['remaining_points'] is None

def test_ros_artifact_and_fingerprint(monkeypatch,tmp_path):
    import json
    monkeypatch.setattr(trade,'load_draft_pool',lambda *a,**kw:pd.DataFrame([{'player_id':'x','Season P50':300}]))
    monkeypatch.setattr(trade,'ROS_PREDICTIONS_DIR',tmp_path)
    monkeypatch.setattr('src.core.schedule_utils.current_projection_week',lambda season:4)
    monkeypatch.setattr('src.projections.ros_cache.ros_fingerprint',lambda:'current')
    stem=tmp_path/'2026_w4_qb'
    stem.with_suffix('.meta.json').write_text(json.dumps({'fingerprint':'current'}))
    pd.DataFrame([{'player_id':'x','ROS P50':220}]).to_parquet(stem.with_suffix('.parquet'))
    assert trade.build_trade_outlook(overview([{'player_id':'x'}]))['players']['x']['remaining_points']==220
    stem.with_suffix('.meta.json').write_text(json.dumps({'fingerprint':'stale'}))
    assert trade.build_trade_outlook(overview([{'player_id':'x'}]))['players']['x']['remaining_points'] is None

def test_endpoint_requires_membership_and_reads_only_local_rows(hub_db,monkeypatch):
    from fastapi.testclient import TestClient
    from app.api import app
    from app.auth import require_hub_user
    from src.draft_hub import storage
    from src.draft_hub.presets import load_preset
    ws=storage.get_or_create_workspace('trade-reader')
    league=storage.create_league('trade-reader','Trade outlook',2026,load_preset('salary_cap_auction_v1'),workspace_id=ws['id'])
    monkeypatch.setattr(trade,'build_trade_outlook',lambda overview:{'players':{},'season':overview['league']['season']})
    try:
        app.dependency_overrides[require_hub_user]=lambda:{'sub':'trade-reader','auth_type':'dev'}
        assert TestClient(app).get(f"/api/hub/league/{league['id']}/trade-outlook").json()['season']==2026
        app.dependency_overrides[require_hub_user]=lambda:{'sub':'outsider','auth_type':'dev'}
        assert TestClient(app).get(f"/api/hub/league/{league['id']}/trade-outlook").status_code in (403,404)
    finally:
        app.dependency_overrides.clear()
