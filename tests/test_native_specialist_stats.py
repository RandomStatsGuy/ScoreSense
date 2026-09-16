import pandas as pd
import pytest

from src.draft_hub.native_specialist_stats import build_defense_stat_index, normalize_kicking_stats
from src.draft_hub.hub_scoring import fantasy_points_from_stats, require_position_stats, LineupError
from src.draft_hub.schemas import ScoringRules


def frames():
    common = dict(season=2026, week=1, season_type='REG', game_id='2026_01_JAX_KC',
                  def_sacks=0, def_interceptions=0, fumble_recovery_opp=0, def_tds=0,
                  special_teams_tds=0, def_safeties=0, def_punt_blocks=0,
                  def_pat_blocks=0, def_fg_blocks=0, def_2pt_made=0)
    teams = pd.DataFrame([{**common, 'team':'JAX', 'opponent_team':'KC', 'def_sacks':3,
                           'def_interceptions':1, 'fumble_recovery_opp':1, 'def_tds':1,
                           'special_teams_tds':1, 'def_punt_blocks':1},
                          {**common, 'team':'KC', 'opponent_team':'JAX', 'def_tds':1,
                           'def_safeties':1, 'def_2pt_made':1}])
    games = pd.DataFrame([dict(game_id='2026_01_JAX_KC', home_team='KC', away_team='JAX',
                              home_score=27, away_score=30)])
    return teams, games


def test_kicker_long_distance_and_blocked_attempts():
    row = dict(fg_made_60_=1, fg_missed=1, fg_blocked=1, pat_missed=0, pat_blocked=1)
    stats = normalize_kicking_stats(row)
    assert stats == dict(fg_made_60_plus=1, fg_missed=2, pat_missed=1)
    assert fantasy_points_from_stats(stats) == 2
    assert normalize_kicking_stats({}) == {'fg_missed': None, 'pat_missed': None}
    assert normalize_kicking_stats({'fg_missed': 0})['fg_missed'] is None


def test_defense_scoring_uses_team_events_and_opponent_score():
    teams, games = frames()
    stats = build_defense_stat_index(teams, games, 2026, 1)['JAX']
    assert stats['def_points_allowed'] == 17  # excludes 6+2+2 opposing defensive points
    assert stats['def_touchdowns'] == 2  # defensive + return TD, no duplicate recovery TD
    assert stats['def_fumble_recoveries'] == 1
    require_position_stats('DEF', stats, ScoringRules())
    assert fantasy_points_from_stats(stats) == 22  # 3 sacks + 2 INT + 2 FR + 12 TD + 2 block + 1 PA
    assert build_defense_stat_index(teams, games, 2026, 1)['sleeper-JAC'] == stats


@pytest.mark.parametrize('missing', ['score', 'opponent', 'stat'])
def test_missing_provider_data_does_not_become_zero(missing):
    teams, games = frames()
    if missing == 'score': games.loc[0, 'home_score'] = float('nan')
    if missing == 'opponent': teams = teams.iloc[:1]
    if missing == 'stat': teams = teams.drop(columns=['def_sacks'])
    stats = build_defense_stat_index(teams, games, 2026, 1)['JAX']
    with pytest.raises(LineupError, match='incomplete'):
        require_position_stats('DEF', stats, ScoringRules())


def test_season_week_and_season_type_are_scoped():
    teams, games = frames()
    assert not build_defense_stat_index(teams, games, 2025, 1)
    assert not build_defense_stat_index(teams, games, 2026, 2)
    teams['season_type'] = 'PRE'
    assert not build_defense_stat_index(teams, games, 2026, 1)


def test_native_loader_maps_kicker_and_defense_feed(monkeypatch):
    from src.draft_hub import hub_scoring
    frame = pd.DataFrame([dict(player_id='k',position='K',season=2026,week=1,season_type='REG',
        fg_made_60_=1,fg_missed=0,fg_blocked=1,pat_missed=0,pat_blocked=0)])
    monkeypatch.setattr('src.etl.nflverse_etl.load_weekly_player_stats',lambda *_:frame)
    monkeypatch.setattr(hub_scoring,'_alias_week_stat_index',lambda index, _: index)
    monkeypatch.setattr('src.draft_hub.native_specialist_stats.load_defense_stat_index',lambda *_:{'JAX':{'def_sacks':3}})
    index = hub_scoring.load_week_stat_index(2026,1)
    assert index['k']['fg_made_60_plus'] == 1
    assert index['k']['fg_missed'] == 1
    assert index['JAX']['def_sacks'] == 3
