"""The weekly board exposes shared coverage metadata without running inference."""
import pandas as pd
import pytest
import app.api as api


@pytest.mark.parametrize('position',['qb','rb','wr'])
def test_weekly_predict_preserves_full_roster_metadata(monkeypatch,position):
    frame=pd.DataFrame([{'Player':'Test Player','Team':'BUF','Season':2026,'Week':1,
                         'Projected Points':10,'Low (P10)':2,'High (P90)':20}])
    frame.attrs.update(preseason_mode=True,inference_meta={
        'feature_season':2025,'depth_mode':'coverage',
        'roster_overlay':{'applied':True,'rookies_added':1},'depth_chart':{'applied':False},
    })
    def load(*args,**kwargs):
        assert kwargs['allow_compute'] is False
        return frame.copy()
    monkeypatch.setattr(api,'load_weekly_prediction',load)
    response=api._predict_response(position,season=2026,week=1)
    assert response['count']==1
    assert response['meta']['roster_overlay']['applied']
    assert not response['meta']['depth_chart']['applied']
    assert response['meta']['feature_season']==2025
