import sqlite3
from src.draft_hub import storage
from src.draft_hub.recent_activity import recent_week_activity


def test_activity_is_public_bounded_and_scoped(monkeypatch):
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.execute('''CREATE TABLE league_player_movement (
      id INTEGER, league_id TEXT, season_year INTEGER, week INTEGER,
      player_name TEXT, event_type TEXT, from_owner TEXT, to_owner TEXT,
      event_at TEXT, source TEXT, confidence TEXT, sleeper_transaction_id TEXT)''')
    for i, (league, season, week, kind, source, confidence, transaction) in enumerate([
        ('A', 2026, 6, 'add', 'sleeper', 'confirmed', 'tx'),
        ('A', 2026, 6, 'drop', 'manual', 'verified', None),
        ('A', 2026, 6, 'trade', 'sleeper', 'confirmed', 'tx2'),
        ('A', 2026, 6, 'add', 'sleeper', 'confirmed', 'tx3'),
        ('B', 2026, 6, 'add', 'sleeper', 'confirmed', 'tx4'),
        ('A', 2025, 6, 'add', 'sleeper', 'confirmed', 'tx5'),
        ('A', 2026, 7, 'add', 'sleeper', 'confirmed', 'tx6'),
        ('A', 2026, 6, 'add', 'inferred', 'inferred', None),
        ('A', 2026, 6, 'bid', 'sleeper', 'confirmed', 'private'),
    ]):
        conn.execute('INSERT INTO league_player_movement VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                     (i, league, season, week, f'Player {i}', kind, 'Old', 'New', f'2026-10-{i+1:02}', source, confidence, transaction))
    monkeypatch.setattr(storage, 'get_conn', lambda: conn)
    rows = recent_week_activity('A', 2026, 6)
    assert [row['player_name'] for row in rows] == ['Player 3', 'Player 2', 'Player 1']
    assert all(set(row) == {'player_name', 'event_type', 'from_owner', 'to_owner', 'event_at'} for row in rows)
    assert recent_week_activity('missing', 2026, 6) == []
    conn.close()


def test_overview_activity_is_opt_in_and_uses_resolved_scoring_week(monkeypatch):
    from fastapi import Response
    import app.hub_routes as routes
    import src.draft_hub.hub_scoring as native
    import src.draft_hub.game_center as center
    import src.draft_hub.league_sleeper_sync as sync
    import src.draft_hub.recent_activity as activity

    monkeypatch.setattr(routes, '_sub', lambda user: 'viewer')
    monkeypatch.setattr(routes, '_ctx_for_league', lambda sub, league: {'team_id':'mine'})
    monkeypatch.setattr(routes, '_hub_teams_for_scoring', lambda league: [])
    monkeypatch.setattr(sync, 'resolve_sleeper_league_id', lambda league: None)
    monkeypatch.setattr(native, 'build_hub_live_week', lambda *a, **k: {'season':2026,'week':6})
    monkeypatch.setattr(center, 'game_center_payload', lambda payload, league: dict(payload))
    reads=[]
    def recorded(league, season, week):
        reads.append((league,season,week))
        return [{'player_name':'Public move'}]
    monkeypatch.setattr(activity, 'recent_week_activity', recorded)
    regular=routes.hub_league_live_scoring(Response(), 'A', week=None, refresh=False, home_view=False, overview=False, _user={})
    assert 'recent_activity' not in regular
    assert reads == []
    overview=routes.hub_league_live_scoring(Response(), 'A', week=None, refresh=False, home_view=False, overview=True, _user={})
    assert overview['recent_activity'] == [{'player_name':'Public move'}]
    assert reads == [('A',2026,6)]
