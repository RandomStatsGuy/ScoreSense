"""Availability without context substitution, request-time inference, or invented zeros."""
import asyncio
import json
from unittest.mock import Mock

import pandas as pd
import pytest
from fastapi import BackgroundTasks

from src.projections.artifact_snapshot import read_snapshot
from src.projections import weekly_cache, ros_cache
from src.draft_hub import trade_outlook


def snapshot(tmp_path, fingerprint="old", week=4, injury=True):
    parquet, meta = tmp_path / "forecast.parquet", tmp_path / "forecast.meta.json"
    pd.DataFrame([{"player_id":"x", "Player":"Test QB", "Team":"BUF",
                   "Projected Points":20, "Low (P10)":10, "High (P90)":30}]).to_parquet(parquet)
    meta.write_text(json.dumps({"season":2026, "week":week, "position":"qb",
                               "apply_injury_adjustments":injury, "fingerprint":fingerprint,
                               "built_at":"2026-09-30T00:00:00+00:00"}))
    return parquet, meta


def read(parquet, meta):
    return read_snapshot(parquet, meta, season=2026, week=4, position="qb", injury=True, fingerprint="new")


def test_saved_same_context_survives_fingerprint_change(tmp_path):
    frame=read(*snapshot(tmp_path))
    assert frame.iloc[0]["Projected Points"] == 20
    assert frame.attrs["projection_stale"]
    assert frame.attrs["built_at"] == "2026-09-30T00:00:00+00:00"


@pytest.mark.parametrize("week,injury", [(3,True),(4,False)])
def test_never_substitutes_week_or_injury_mode(tmp_path,week,injury):
    assert read(*snapshot(tmp_path,week=week,injury=injury)).empty


def test_corrupt_artifact_does_not_break_other_inputs(tmp_path):
    parquet,meta=snapshot(tmp_path)
    parquet.write_bytes(b"corrupt")
    assert read(parquet,meta).empty


def test_current_fingerprint_cannot_override_wrong_saved_context(tmp_path,monkeypatch):
    paths=snapshot(tmp_path,fingerprint='new',week=3)
    monkeypatch.setattr(weekly_cache,'_artifact_paths',lambda *a:paths)
    monkeypatch.setattr(weekly_cache,'weekly_fingerprint',lambda:'new')
    weekly_cache.invalidate_weekly_cache()
    assert weekly_cache.load_weekly_prediction('qb',2026,4,allow_compute=False,allow_stale=True).empty


def test_weekly_failed_replacement_retains_saved_forecast_only_when_opted_in(tmp_path,monkeypatch):
    paths=snapshot(tmp_path)
    monkeypatch.setattr(weekly_cache,"_artifact_paths",lambda *a:paths)
    monkeypatch.setattr(weekly_cache,"weekly_fingerprint",lambda:"new")
    loader=Mock(side_effect=RuntimeError("input feed down"))
    monkeypatch.setattr(weekly_cache,"_load_weekly_prediction",loader)
    frame=weekly_cache.load_weekly_prediction("qb",2026,4,allow_stale=True)
    assert frame.iloc[0]["Projected Points"]==20 and frame.attrs["projection_stale"]
    with pytest.raises(RuntimeError):
        weekly_cache.load_weekly_prediction("qb",2026,4)


def test_empty_ros_refresh_preserves_previous_artifact(tmp_path,monkeypatch):
    monkeypatch.setattr(ros_cache,"ROS_PREDICTIONS_DIR",tmp_path)
    ros_cache.save_ros_artifact("qb",2026,4,True,pd.DataFrame([{"ROS P50":200}]))
    paths=ros_cache._artifact_paths("qb",2026,4,True)
    before=[path.read_bytes() for path in paths]
    with pytest.raises(ValueError,match="Empty ROS"):
        ros_cache.save_ros_artifact("qb",2026,4,True,pd.DataFrame())
    assert [path.read_bytes() for path in paths]==before


@pytest.mark.parametrize('service', ['weekly', 'ros', 'draft'])
@pytest.mark.parametrize('damage', ['parquet', 'metadata'])
def test_damaged_current_cache_is_a_miss_and_can_rebuild(tmp_path, monkeypatch, service, damage):
    from src.draft_hub import draft_pool_cache

    frame = pd.DataFrame([{'player_id':'x', 'Player':'Test QB', 'Position':'QB', 'Team':'BUF',
                           'Projected Points':20, 'Low (P10)':10, 'High (P90)':30,
                           'ROS P10':100, 'ROS P50':200, 'ROS P90':300,
                           'Season P10':150, 'Season P50':250, 'Season P90':350}])
    if service == 'draft':
        module = draft_pool_cache
        monkeypatch.setattr(module, 'DRAFT_POOL_DIR', tmp_path)
        module.save_pool_artifact(2026, frame)
        paths = module._artifact_paths(2026)
        compute = Mock(return_value=(frame.copy(), {}))
        monkeypatch.setattr(module, '_compute_pool', compute)
        load = lambda allow_compute: module.load_draft_pool(2026, allow_compute=allow_compute,
                                                           apply_identity=False, allow_stale=True)
        clear = module.invalidate_pool_cache
    else:
        module = weekly_cache if service == 'weekly' else ros_cache
        monkeypatch.setattr(module, 'WEEKLY_PREDICTIONS_DIR' if service == 'weekly' else 'ROS_PREDICTIONS_DIR', tmp_path)
        save = module.save_weekly_artifact if service == 'weekly' else module.save_ros_artifact
        save('qb', 2026, 4, True, frame)
        paths = module._artifact_paths('qb', 2026, 4, True)
        compute = Mock(return_value=frame.copy())
        monkeypatch.setattr(module, 'predict_upcoming_week' if service == 'weekly' else 'predict_rest_of_season', compute)
        monkeypatch.setattr(module, '_with_roster_identity', lambda df, *a, **kw: df)
        loader = module.load_weekly_prediction if service == 'weekly' else module.load_ros_prediction
        load = lambda allow_compute: loader('qb', 2026, 4, allow_compute=allow_compute, allow_stale=True)
        clear = module.invalidate_weekly_cache if service == 'weekly' else module.invalidate_ros_cache
    if damage == 'parquet':
        paths[0].write_bytes(b'broken parquet')
    else:
        paths[1].write_text('[]', encoding='utf-8')
    clear()
    assert load(False).empty
    compute.assert_not_called()
    assert load(True).iloc[0]['player_id'] == 'x'
    compute.assert_called_once()
    clear()


def test_empty_draft_refresh_preserves_previous_artifact(tmp_path, monkeypatch):
    from src.draft_hub import draft_pool_cache

    monkeypatch.setattr(draft_pool_cache, 'DRAFT_POOL_DIR', tmp_path)
    draft_pool_cache.save_pool_artifact(2026, pd.DataFrame([{'Season P50':200}]))
    paths = draft_pool_cache._artifact_paths(2026)
    before = [path.read_bytes() for path in paths]
    with pytest.raises(ValueError, match='Empty draft'):
        draft_pool_cache.save_pool_artifact(2026, pd.DataFrame())
    assert [path.read_bytes() for path in paths] == before
    draft_pool_cache.invalidate_pool_cache()


def test_ros_failed_replacement_keeps_only_requested_context(tmp_path,monkeypatch):
    monkeypatch.setattr(ros_cache,'ROS_PREDICTIONS_DIR',tmp_path)
    ros_cache.save_ros_artifact('qb',2026,4,True,pd.DataFrame([{'ROS P10':100,'ROS P50':200,'ROS P90':300}]))
    monkeypatch.setattr(ros_cache,'_load_ros_prediction',Mock(side_effect=RuntimeError('feed failed')))
    frame=ros_cache.load_ros_prediction('qb',2026,4,allow_stale=True)
    assert frame.iloc[0]['ROS P50']==200 and frame.attrs['projection_stale']
    with pytest.raises(RuntimeError):
        ros_cache.load_ros_prediction('qb',2026,3,allow_stale=True)


def test_stale_dfs_special_pool_does_not_hide_new_shared_skill_forecasts(monkeypatch):
    from src.products import lineup_optimizer
    deep=pd.DataFrame([{'player_id':'qb','Player':'QB','Position':'QB','Team':'BUF',
                        'Projected Points':5,'Low (P10)':1,'High (P90)':10}])
    deep.attrs['projection_stale']=True
    monkeypatch.setattr('src.projections.dfs_pool.load_dfs_pool',lambda *a:deep.copy())
    def weekly(pos,**kw):
        return pd.DataFrame([{'player_id':pos,'Player':pos.upper(),'Position':pos.upper(),'Team':'BUF',
                              'Projected Points':20,'Low (P10)':10,'High (P90)':30}])
    monkeypatch.setattr(lineup_optimizer,'load_weekly_prediction',weekly)
    monkeypatch.setattr('src.core.schedule_utils.attach_bye_flags',lambda frame,*a:frame)
    pool,_=lineup_optimizer.build_lineup_pool(2026,4,site='draftkings')
    assert len(pool)==3
    assert pool.loc[pool.player_id.eq('qb'),'Projected Points'].item()==20


def test_dfs_feed_failure_keeps_saved_pool_labeled_stale(tmp_path, monkeypatch):
    from src.projections import dfs_pool

    monkeypatch.setattr(dfs_pool, 'DFS_PREDICTIONS_DIR', tmp_path)
    monkeypatch.setattr(dfs_pool, 'pool_fingerprint', lambda: 'current')
    frame = pd.DataFrame([{'player_id':'dst:BUF', 'Projected Points':7}])
    frame.attrs.update(pool_version=dfs_pool.POOL_VERSION, season=2026, week=4,
                       fingerprint='current', special_history_refresh_failed=True,
                       special_history_current_season_available=False)
    frame.to_parquet(dfs_pool.artifact_path(2026,4))
    saved = dfs_pool.load_dfs_pool(2026,4)
    assert saved.iloc[0]['Projected Points'] == 7
    assert saved.attrs['projection_stale']


def test_dfs_recovery_reports_feed_failure_so_it_retries(monkeypatch):
    from contextlib import nullcontext
    from src.jobs import projection_recovery

    monkeypatch.setattr(projection_recovery, 'refresh_lock', lambda *a: nullcontext())
    monkeypatch.setattr('src.projections.dfs_pool.refresh_dfs_pool',
                        lambda *a: {'special_history_refresh_failed':True})
    result = projection_recovery.rebuild_projection_context(2026,4,('dfs',))
    assert result == {'status':'error', 'failed':['dfs']}


def test_explicit_context_dfs_reads_artifacts_without_feature_file_or_inference(tmp_path,monkeypatch):
    from src.products import lineup_optimizer
    calls=[]
    def load(position,**kw):
        calls.append(kw)
        return pd.DataFrame([{"Position":position.upper(),"player_id":position,"Player":position,"Team":"BUF",
                              "Projected Points":20,"Low (P10)":10,"High (P90)":30}])
    monkeypatch.setattr(lineup_optimizer,"load_weekly_prediction",load)
    monkeypatch.setattr("src.projections.dfs_pool.load_dfs_pool",lambda *a:pd.DataFrame())
    monkeypatch.setattr("src.core.schedule_utils.attach_bye_flags",lambda frame,*a:frame)
    frame,meta=lineup_optimizer.build_lineup_pool(2026,4,data_dir=tmp_path,site="draftkings")
    assert len(frame)==3
    assert all(c["allow_compute"] is False and c["allow_stale"] for c in calls)
    assert meta["rebuild_kinds"]==["dfs"]


def test_specialist_estimates_use_actual_remaining_games():
    overview={"teams":[{"roster":[{"player_id":"sleeper-123","position":"K"}]}]}
    result=trade_outlook.outlook_from_frames(overview,pd.DataFrame(),pd.DataFrame(),week=4,
        specialists={"123":{"p50":153,"per_game":9,"team":"LAR"}},remaining_games={"LA":14})
    forecast=result["players"]["sleeper-123"]
    assert forecast["remaining_points"]==126
    assert forecast["source"]=="Rank-curve estimate"
    result=trade_outlook.outlook_from_frames(overview,pd.DataFrame(),pd.DataFrame(),week=None)
    assert result["players"]["sleeper-123"]["remaining_points"] is None


def test_kicker_and_defense_aliases_work_across_fantasy_services():
    from src.draft_hub.k_def_pool_cache import find_k_def_projection
    index={'BUF':{'position':'DEF','team':'BUF','p50':100},
           '123':{'position':'K','team':'BUF','player_name':'Test Kicker','p50':120}}
    assert find_k_def_projection({'player_id':'dst:BUF','position':'DEF','team':'BUF'},index)['p50']==100
    assert find_k_def_projection({'player_id':'sleeper-123','position':'K'},index)['p50']==120
    assert find_k_def_projection({'player_id':'00-0000001','player_name':'Test Kicker','position':'K','team':'BUF'},index)['p50']==120


def test_recovery_is_coalesced_and_uses_shared_worker(monkeypatch):
    from app import projection_recovery as recovery
    recovery._ACTIVE.clear();recovery._RESULTS.clear()
    calls=[]
    async def submit(*args):
        calls.append(args);return {"status":"ok"}
    monkeypatch.setattr(recovery,"submit_cpu_job",submit)
    tasks=BackgroundTasks()
    assert recovery.queue_projection_recovery(tasks,2026,4,["ros"])["status"]=="queued"
    assert recovery.queue_projection_recovery(tasks,2026,4,["ros"])["status"]=="running"
    asyncio.run(tasks())
    assert len(calls)==1
    assert recovery.queue_projection_recovery(tasks,2026,4,["ros"])["status"]=="ok"
    recovery._RESULTS.clear()


def test_specialist_recovery_warms_public_identities_and_schedule_in_worker(monkeypatch):
    from contextlib import nullcontext
    from src.jobs import projection_recovery

    calls = []
    monkeypatch.setattr(projection_recovery, 'refresh_lock', lambda *a: nullcontext())
    monkeypatch.setattr('src.integrations.sleeper.players_dataframe',
                        lambda **kw: calls.append(kw) or pd.DataFrame())
    monkeypatch.setattr('src.draft_hub.prepared_k_def_context.prepare_k_def_context',
                        lambda: calls.append('prepare') or {'status':'prepared'})
    monkeypatch.setattr('src.draft_hub.k_def_pool_cache.k_def_projection_index',
                        lambda **kw: calls.append(kw) or {'BUF':{'p50':100}})
    monkeypatch.setattr('src.core.schedule_utils._load_schedules',
                        lambda seasons: calls.append(seasons) or pd.DataFrame([{'season':2026}]))
    assert projection_recovery.rebuild_projection_context(2026,4,('specialists',))['status'] == 'ok'
    assert calls == [{'allow_refresh':True}, 'prepare', {}, [2026]]


def test_explicit_bestball_context_uses_existing_board_without_feature_metadata(monkeypatch):
    from app import api

    monkeypatch.setattr('src.projections.draft_meta.get_draft_meta', Mock(side_effect=AssertionError('feature metadata requested')))
    monkeypatch.setattr(api, 'build_bestball_board', lambda season: (pd.DataFrame([{'player_id':'x'}]), {}))
    executor = Mock()
    monkeypatch.setattr(api, 'get_process_executor', lambda: executor)
    assert api.bestball_board(2026)['count'] == 1
    executor.submit.assert_not_called()


def test_cold_bestball_artifact_rebuilds_in_shared_cpu_worker(monkeypatch):
    from app import api
    from src.draft_hub.draft_pool_cache import load_draft_pool

    monkeypatch.setattr(api, 'build_bestball_board', Mock(side_effect=[
        FileNotFoundError('cold cache'), (pd.DataFrame([{'player_id':'x'}]), {})]))
    executor = Mock()
    monkeypatch.setattr(api, 'get_process_executor', lambda: executor)
    assert api.bestball_board(2026)['count'] == 1
    executor.submit.assert_called_once_with(load_draft_pool, 2026)
    executor.submit.return_value.result.assert_called_once()
