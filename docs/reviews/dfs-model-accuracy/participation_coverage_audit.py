"""Read-only 2025 positive-offense-snap versus observed-stat identity audit.

Missing rows are potential participation coverage gaps, never zero outcomes.
No fitting, downloads, live artifacts or scoring values are used or produced.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.core.team_codes import normalize_team_for_match


raw = Path('outputs/dfs-accuracy-data/raw')
output = Path('outputs/dfs-accuracy-zero/participation-coverage-2025.json')
names = ['snap_counts_2025.parquet', 'stats_player_week_2025.parquet', 'db_playerids.csv', 'games.csv']
source_records = []
for name in names:
    path = raw / name
    metadata = json.loads(path.with_suffix(path.suffix + '.source.json').read_text())
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == metadata['sha256']
    source_records.append({'path': str(path), 'sha256': digest, 'url': metadata['url'], 'fetched_at_utc': metadata['fetched_at_utc']})

snaps = pd.read_parquet(raw / names[0])
stats = pd.read_parquet(raw / names[1])
ids = pd.read_csv(raw / names[2], low_memory=False)
games = pd.read_csv(raw / names[3], low_memory=False)
games = games[games.season.eq(2025) & games.game_type.eq('REG')].copy()
assert len(games) == games.game_id.nunique()
team_games = []
for game in games.to_dict('records'):
    for team, opponent in ((game['home_team'], game['away_team']), (game['away_team'], game['home_team'])):
        team_games.append({'game_id': game['game_id'], 'season': int(game['season']), 'week': int(game['week']),
            'canonical_team': normalize_team_for_match(team), 'canonical_opponent': normalize_team_for_match(opponent)})
team_games = pd.DataFrame(team_games)
game_keys = ['game_id', 'season', 'week', 'canonical_team', 'canonical_opponent']
assert not team_games.duplicated(game_keys).any()

snaps = snaps[snaps.season.eq(2025) & snaps.game_type.eq('REG') & snaps.position.isin(['WR', 'TE'])].copy()
snaps['canonical_team'] = snaps.team.map(normalize_team_for_match)
snaps['canonical_opponent'] = snaps.opponent.map(normalize_team_for_match)
snaps['offense_snaps'] = pd.to_numeric(snaps.offense_snaps, errors='coerce')
valid_offense = np.isfinite(snaps.offense_snaps) & snaps.offense_snaps.ge(0) & snaps.offense_snaps.eq(np.floor(snaps.offense_snaps))
positive = snaps[valid_offense & snaps.offense_snaps.gt(0)].copy()
positive_initial = len(positive)

pairs = ids[['pfr_id', 'gsis_id']].dropna().copy()
for col in pairs:
    pairs[col] = pairs[col].astype(str).str.strip()
pairs = pairs[pairs.pfr_id.ne('') & pairs.gsis_id.ne('')].drop_duplicates()
ambiguous_pfr = set(pairs.loc[pairs.duplicated('pfr_id', keep=False), 'pfr_id'])
ambiguous_gsis = set(pairs.loc[pairs.duplicated('gsis_id', keep=False), 'gsis_id'])
unique_pairs = pairs[~pairs.pfr_id.isin(ambiguous_pfr) & ~pairs.gsis_id.isin(ambiguous_gsis)]
lookup = unique_pairs.set_index('pfr_id').gsis_id
positive['canonical_id'] = positive.pfr_player_id.map(lookup)
unmapped = positive.canonical_id.isna()
unmapped_records = positive.loc[unmapped, ['player', 'pfr_player_id', 'position']].drop_duplicates().to_dict('records')
mapped = positive[~unmapped].copy()
mapped = mapped.merge(team_games.assign(_verified_game=True), on=game_keys, how='left', validate='many_to_one')
invalid_snap_games = mapped._verified_game.isna()
mapped_valid = mapped[~invalid_snap_games].copy()
player_keys = ['canonical_id', *game_keys]
duplicate_snap_keys = mapped_valid.duplicated(player_keys, keep=False)
verified = mapped_valid[~duplicate_snap_keys].copy()

stats = stats[stats.season.eq(2025) & stats.season_type.eq('REG')].copy()
stats['canonical_id'] = stats.player_id
stats['canonical_team'] = stats.team.map(normalize_team_for_match)
stats['canonical_opponent'] = stats.opponent_team.map(normalize_team_for_match)
stats = stats.merge(team_games.assign(_verified_game=True), on=game_keys, how='left', validate='many_to_one')
invalid_stat_games = stats._verified_game.isna()
valid_stats = stats[~invalid_stat_games & stats.canonical_id.notna()].copy()
duplicate_stat_keys = valid_stats.duplicated(player_keys, keep=False)
unique_stats = valid_stats[~duplicate_stat_keys].copy()
ambiguous_stat_identities = valid_stats.loc[duplicate_stat_keys, player_keys].drop_duplicates().assign(_ambiguous_stat_key=True)
verified = verified.merge(ambiguous_stat_identities, on=player_keys, how='left', validate='one_to_one')
ambiguous_matches = verified._ambiguous_stat_key.eq(True)
comparable = verified[~ambiguous_matches].copy()
audit_rows = comparable.merge(unique_stats[player_keys + ['position']].rename(columns={'position': 'observed_stat_position'}),
    on=player_keys, how='left', validate='one_to_one', indicator='_stat_match')
audit_rows['observed_stat_row_present'] = audit_rows._stat_match.eq('both')
missing = audit_rows[~audit_rows.observed_stat_row_present]
present = audit_rows[audit_rows.observed_stat_row_present]
position_conflicts = present[~present.observed_stat_position.isin(['WR', 'TE'])]
rows_path = output.with_suffix('.rows.parquet')
keep = ['canonical_id', 'pfr_player_id', 'player', 'position', 'game_id', 'season', 'week', 'canonical_team', 'canonical_opponent',
        'offense_snaps', 'offense_pct', 'observed_stat_row_present', 'observed_stat_position']
audit_rows[keep].to_parquet(rows_path, index=False)

snaps_buckets = pd.cut(missing.offense_snaps, bins=[0, 5, 15, 30, float('inf')], labels=['1_to_5', '6_to_15', '16_to_30', '31_plus'])
report = {
    'schema_version': 'positive_offense_snap_observed_stat_coverage_audit_v1',
    'season': 2025,
    'scope': 'WR/TE snap-source position; positive observed offensive snaps, verified regular-season team-game and unique explicit PFR/GSIS crosswalk',
    'meaning': 'Rows absent from the observed weekly-stat source are potential missing participation rows. No actual fantasy points or zero labels are inferred.',
    'source_records': source_records,
    'source_code_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'rules': ['No name matching or current roster team inference', 'Canonical team aliases use normalize_team_for_match',
        'Game ID, season, week, team and opponent must all match the saved schedule',
        'Crosswalk mapping must be unique in both directions', 'Duplicate player/team-game keys and ambiguous observed-stat matches are excluded and counted',
        'Presence check accepts a matching observed-stat identity at any position; non-WR/TE positions are reported separately'],
    'counts': {
        'scheduled_regular_games': len(games),
        'wr_te_snap_rows': len(snaps),
        'invalid_offense_snap_rows': int((~valid_offense).sum()),
        'positive_offense_snap_rows': positive_initial,
        'unmapped_or_ambiguous_crosswalk_rows': int(unmapped.sum()),
        'invalid_snap_team_game_rows': int(invalid_snap_games.sum()),
        'duplicate_mapped_snap_key_rows_excluded': int(duplicate_snap_keys.sum()),
        'invalid_stat_team_game_rows': int(invalid_stat_games.sum()),
        'duplicate_observed_stat_key_rows': int(duplicate_stat_keys.sum()),
        'ambiguous_observed_stat_matches_excluded': int(ambiguous_matches.sum()),
        'strictly_comparable_positive_snap_rows': len(audit_rows),
        'with_any_observed_stat_row': len(present),
        'with_observed_wr_te_stat_row': int(present.observed_stat_position.isin(['WR', 'TE']).sum()),
        'observed_position_conflict_rows': len(position_conflicts),
        'potential_missing_participation_rows': len(missing),
        'potential_missing_unique_players': int(missing.canonical_id.nunique()),
        'missing_fraction_of_strictly_comparable_positive_snap_rows': float(len(missing) / len(audit_rows)) if len(audit_rows) else None,
        'missing_positive_offensive_snap_sum': int(missing.offense_snaps.sum()),
    },
    'missing_by_snap_position': {str(key): int(value) for key, value in missing.groupby('position').size().items()},
    'missing_by_offensive_snap_count': {str(key): int(value) for key, value in snaps_buckets.value_counts(sort=False).items()},
    'unmapped_or_ambiguous_crosswalk_players': unmapped_records,
    'examples_without_inferred_points': missing.sort_values('offense_snaps', ascending=False)[keep].head(20).replace({np.nan: None}).to_dict('records'),
    'row_evidence': {'path': str(rows_path), 'sha256': hashlib.sha256(rows_path.read_bytes()).hexdigest(), 'rows': len(audit_rows), 'scoring_values_included': False},
    'limitations': ['Retrospective public source snapshots; original pre-lock publication is not authenticated.',
        'Positive snap counts establish observed participation evidence, not complete offensive statistics or fantasy-score outcomes.',
        'This excludes unmapped identities, ambiguous identities and players without positive offensive snaps; it is not a complete active/inactive roster census.',
        'Source positions can differ across feeds. A matching row at another position is not counted as an absent stat row.',
        'This audit does not train, label absent outcomes as zero, change a data source or publish a probability head.'],
    'model_fits_performed': False,
    'serving_changed': False,
    'missing_points_inferred': False,
}
output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8', newline='\n')
print(json.dumps(report['counts'], indent=2))
print(json.dumps(report['missing_by_snap_position']))
print(json.dumps(report['missing_by_offensive_snap_count']))
