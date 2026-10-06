from concurrent.futures import ThreadPoolExecutor
from src.draft_hub import native_score_refresh as refresh, storage
from src.draft_hub.schemas import ScoringRules


def test_durable_single_claim_and_expired_worker_recovery(hub_db):
    refresh.request_refresh('league', 2026, 4, now=1000)
    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(pool.map(lambda _: refresh._claim(now=1000), range(4)))
    assert sum(job is not None for job in claims) == 1
    original = next(job for job in claims if job)
    refresh.request_refresh('league', 2026, 4, now=1100)
    assert refresh._claim(now=1100) is None
    recovered = refresh._claim(now=1400)
    assert recovered
    refresh._finish(original, 'complete')
    assert refresh.refresh_status('league', 2026, 4)['status'] == 'running'
    refresh._finish(recovered, 'failed', 'no_stats')
    assert refresh._claim(now=1410) is None
    refresh.request_refresh('league', 2026, 4, now=1410)
    assert refresh.refresh_status('league', 2026, 4)['status'] == 'failed'
    refresh.request_refresh('league', 2026, 4, now=1701)
    assert refresh.refresh_status('league', 2026, 4)['status'] == 'pending'


def test_failed_jobs_retry_without_another_page_visit(hub_db):
    refresh.request_refresh('league', 2026, 4, now=1000)
    refresh._finish(refresh._claim(now=1000), 'failed', 'no_stats')
    assert refresh._claim(now=1299) is None
    assert refresh._claim(now=1300)['league_id'] == 'league'


def test_worker_shares_stats_and_isolates_failure(hub_db, monkeypatch):
    from src.draft_hub import hub_scoring as hs
    # This fixture represents a played week, independent of today's NFL clock.
    monkeypatch.setattr(hs, 'nfl_week_started', lambda *a, **kw: True)
    rules = {'scoring': ScoringRules().model_dump()}
    monkeypatch.setattr(storage, 'get_league', lambda lid: {'draft_completed': True, 'rules': rules})
    monkeypatch.setattr(storage, 'get_week_scoring_run', lambda *a: None)
    calls = []
    monkeypatch.setattr(hs, 'load_week_stat_index', lambda *a: calls.append(a) or {'p': {'passing_yards': 100}})
    applied = []
    def apply(lid, *a, **kw):
        applied.append(kw)
        if lid == 'bad':
            raise hs.LineupError('incomplete statistics')
        return {'scored': True}
    monkeypatch.setattr(hs, 'apply_week_scores', apply)
    for lid in ['bad', 'good']:
        refresh.request_refresh(lid, 2026, 4)
    assert refresh.refresh_pending_scores() == {'completed': 1, 'failed': 1}
    assert len(calls) == 1
    assert all(k['automatic'] and k['slate_complete'] is False for k in applied)
    assert refresh.refresh_status('bad', 2026, 4)['error'] == 'refresh_failed'


def test_worker_preserves_host_final_results_and_saved_rules(hub_db, monkeypatch):
    from src.draft_hub import hub_scoring as hs
    def league(lid):
        return {'draft_completed': True, 'sleeper_league_id': 'sleeper' if lid == 'linked' else None,
                'rules': {'scoring': ScoringRules().model_dump()}}
    def run(lid, *a):
        return {'final': lid == 'final', 'scoring': ScoringRules(receptions=0.5).model_dump()}
    monkeypatch.setattr(storage, 'get_league', league)
    monkeypatch.setattr(storage, 'get_week_scoring_run', run)
    monkeypatch.setattr(hs, 'load_week_stat_index', lambda *a: (_ for _ in ()).throw(AssertionError('unexpected stats load')))
    for lid in ['linked', 'final', 'changed']:
        refresh.request_refresh(lid, 2026, 4)
    assert refresh.refresh_pending_scores() == {'completed': 0, 'failed': 1}
    assert refresh.refresh_status('changed', 2026, 4)['error'] == 'settings_changed'


def test_ticker_disabled_and_cancellation(monkeypatch):
    import asyncio
    from app import native_scoring_ticker as ticker
    monkeypatch.setattr(ticker, 'NATIVE_SCORING_REFRESH_ENABLED', False)
    asyncio.run(ticker.native_scoring_ticker_loop())
    monkeypatch.setattr(ticker, 'NATIVE_SCORING_REFRESH_ENABLED', True)
    calls = []
    monkeypatch.setattr(ticker, 'queue_current_native_weeks', lambda: calls.append('queue'))
    async def cancel(*args):
        calls.append('worker')
        raise asyncio.CancelledError()
    monkeypatch.setattr(ticker, 'submit_cpu_job', cancel)
    async def run():
        import pytest
        with pytest.raises(asyncio.CancelledError):
            await ticker.native_scoring_ticker_loop()
    asyncio.run(run())
    assert calls == ['queue', 'worker']


def test_quiet_score_refresh_waits_five_minutes(hub_db):
    refresh.request_refresh('league',2026,4,now=1000)
    refresh._finish(refresh._claim(now=1000),'complete')
    refresh.request_refresh('league',2026,4,now=1061,cadence_seconds=300)
    assert refresh._claim(now=1061) is None
    refresh.request_refresh('league',2026,4,now=1300,cadence_seconds=300)
    assert refresh._claim(now=1300)['league_id'] == 'league'


def test_scheduler_uses_active_games_and_reads_schedule_once_per_context(hub_db,monkeypatch):
    from src.draft_hub import game_center, league_live_scoring
    from unittest.mock import Mock
    monkeypatch.setattr(league_live_scoring,'resolve_current_week',lambda:(4,{'season':2026,'season_type':'regular'}))
    with storage.get_conn() as conn:
        for lid in ('a','b'):
            conn.execute("INSERT INTO league(id,name,season,rules_json,draft_completed,commissioner_sub,room_code,created_at) VALUES(?,?,?,'{}',1,'fixture',?,'2026-10-06')",(lid,lid,2026,lid))
    monkeypatch.setattr(storage,'get_league',lambda *a:{'draft_completed':True})
    monkeypatch.setattr(storage,'get_week_scoring_run',lambda *a:None)
    games = Mock(return_value={'KC':{'game_state':'pregame'}})
    request = Mock()
    monkeypatch.setattr(game_center,'cached_game_states',games)
    monkeypatch.setattr(refresh,'request_refresh',request)
    refresh.queue_current_native_weeks()
    assert request.call_count == 2
    assert all(call.kwargs['cadence_seconds'] == 300 for call in request.call_args_list)
    games.assert_called_once_with(2026,4)
    request.reset_mock()
    games.return_value = {'KC':{'game_state':'live'}}
    refresh.queue_current_native_weeks()
    assert all(call.kwargs['cadence_seconds'] == 60 for call in request.call_args_list)
