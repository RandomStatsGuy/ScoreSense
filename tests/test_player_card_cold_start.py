"""Cold player-card reads keep model imports and full catalog conversions off-path."""
from pathlib import Path
import subprocess
import sys

import pandas as pd


def test_cold_card_and_saved_ros_reads_do_not_import_models():
    script = r"""
import importlib.abc, sys, tempfile
from pathlib import Path
class NoModels(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.startswith(('src.ml', 'src.projections.predict', 'src.projections.ros_projections', 'sklearn', 'lightgbm', 'xgboost')):
            raise AssertionError('model import on saved card read: ' + fullname)
sys.meta_path.insert(0, NoModels())
from src.projections import player_card, ros_cache
import pandas as pd
with tempfile.TemporaryDirectory() as folder:
    ros_cache.ROS_PREDICTIONS_DIR = Path(folder)
    ros_cache.ros_fingerprint = lambda: 'saved'
    ros_cache._with_roster_identity = lambda df, *a, **kw: df
    frame = pd.DataFrame([{'player_id':'p1', 'Player':'Saved Player', 'Team':'KC', 'ROS P10':100.0, 'ROS P50':123.5, 'ROS P90':150.0, 'Season P50':150.0}])
    ros_cache.save_ros_artifact('qb', 2026, 6, True, frame)
    ros_cache._ROS_CACHE.clear()
    saved = ros_cache.load_ros_prediction('qb', 2026, 6, allow_compute=False)
    assert saved.iloc[0]['ROS P50'] == 123.5
    ros_cache._ROS_CACHE.clear()
    ros_cache.ros_fingerprint = lambda: 'changed'
    stale = ros_cache.load_ros_prediction('qb', 2026, 6, allow_compute=False, allow_stale=True)
    assert stale.iloc[0]['ROS P50'] == 123.5 and stale.attrs['projection_stale']
"""
    result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).resolve().parents[1],
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_cold_media_catalog_keeps_profile_and_matching_without_series_per_player(monkeypatch):
    from src.draft_hub import draft_enrichment as media
    frame = pd.DataFrame([
        {'sleeper_id':'7', 'gsis_id':'00-0000001', 'full_name':'Known Player', 'team':'KC', 'espn_id':'123', 'number':15.0, 'age':26.0, 'college':'School'},
        {'sleeper_id':'8', 'gsis_id':'', 'full_name':'New Player', 'team':'LAR', 'espn_id':'456', 'number':17.0, 'age':24.0, 'college':'New School'},
    ])
    monkeypatch.setattr(media, '_SLEEPER_LOOKUP', None)
    monkeypatch.setattr(media, 'players_dataframe', lambda **kw: frame)
    monkeypatch.setattr(media, '_gsis_identity_map', lambda: {'00-0000002':('New Player','LA')})
    monkeypatch.setattr(pd.DataFrame, 'iterrows', lambda *a, **kw: (_ for _ in ()).throw(AssertionError('per-player Series conversion')))
    hints = [{'player_id':'00-0000001'}, {'player_id':'sleeper-7'}, {'player_id':'7'}, {'player_id':'00-0000002'}]
    result = media.build_player_media_batch(hints, allow_refresh=False)
    for pid in ('00-0000001','sleeper-7','7'):
        assert result[pid]['sleeper_id'] == '7'
        assert result[pid]['jersey_number'] == '15'
        assert result[pid]['age'] == 26 and result[pid]['college'] == 'School'
        assert result[pid]['espn_headshot_url'].endswith('/123.png')
    assert result['00-0000002']['sleeper_id'] == '8'
    assert result['00-0000002']['team'] == 'LAR'


def test_cold_identity_overlay_ignores_unused_profile_columns_and_keeps_match_precedence(monkeypatch):
    from src.integrations import roster_identity as identity
    original = pd.DataFrame.to_dict
    def records(frame, *a, **kw):
        assert 'injury_notes' not in frame.columns, 'expanded unused provider profile on cold read'
        return original(frame, *a, **kw)
    monkeypatch.setattr(pd.DataFrame, 'to_dict', records)
    sleeper = pd.DataFrame([
        {'gsis_id':'00-0000001','full_name':'Known Player','team':'BAL','position':'QB','status':'Active','injury_notes':'unused'},
        {'gsis_id':'','full_name':'Other Player','team':'','position':'WR','status':'Retired','injury_notes':'unused'},
        {'gsis_id':'','full_name':'Other Player','team':'KC','position':'QB','status':'Active','injury_notes':'unused'},
    ])
    projections = pd.DataFrame([
        {'player_id':'00-0000001','Player':'Old label','Team':'BAL','Position':'QB','Projected Points':20.5},
        {'player_id':'sleeper-2','Player':'Other Player','Team':'KC','Position':'QB','Projected Points':10.5},
    ])
    result, stats = identity.apply_roster_identity_overlay(projections, 'qb', sleeper_df=sleeper, load_defaults=False)
    assert list(result['Projected Points']) == [20.5,10.5]
    assert list(result['Team']) == ['BAL','KC']
    assert stats['applied'] and not stats['dropped_stale']
