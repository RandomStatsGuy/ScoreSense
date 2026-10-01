import pandas as pd
import requests

from src.jobs.dfs_special_history import refresh_special_history


def test_feed_outage_preserves_historical_inputs_without_claiming_current_data(monkeypatch):
    retained=pd.DataFrame([{'season':2025,'week':18,'team':'BUF','K':9,'DST':7}])
    def fail(*a,**k):
        raise requests.ConnectionError('Offline')
    monkeypatch.setattr('src.jobs.dfs_special_history.requests.get',fail)
    result=refresh_special_history(2026,retained)
    pd.testing.assert_frame_equal(result,retained)
    assert not result.attrs['current_season_available']
    assert result.attrs['input_refresh_failed']
    assert retained.attrs=={}
