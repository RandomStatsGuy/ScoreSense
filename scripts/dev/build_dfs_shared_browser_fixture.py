"""Build explicitly synthetic browser responses with the real event/scenario engine."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import runpy

from src.products.dfs_shared_outcomes import prepare_scenario_bank, evaluate_shared_outcomes, scenario_bank_summary

ROOT = Path(__file__).resolve().parents[2]


def main():
    maintained = runpy.run_path(str(ROOT / 'tests/test_dfs_shared_outcomes.py'))
    payload, pool, lineups = maintained['fixture']()
    payload['context'] = {'site': 'draftkings', 'sport': 'NFL', 'format': 'classic',
                          'season': 2026, 'week': 5, 'slate_id': 'classic-fixture'}
    # Make the paired comparison nonzero: remove a scoring receiver, preserving
    # the complete legal roster and its independent second-game tight end.
    lineups[1]['player_ids'] = [pid if pid != 'buf-wr1' else 'mia-wr2' for pid in lineups[0]['player_ids']]
    for index, lineup in enumerate(lineups):
        lineup['lineup_id'] = f'current:{index}'
    bank = prepare_scenario_bank(payload, context=payload['context'], pool=pool, now=maintained['NOW'])
    report = evaluate_shared_outcomes(bank, lineups, seed=0, draw_count=256)
    collection_lineups = [{**lineup, 'lineup_id': f'collection:{index}'} for index, lineup in enumerate(lineups)]
    collection_report = evaluate_shared_outcomes(bank, collection_lineups, seed=0, draw_count=256)
    ui_pool = [{**row, 'dfs_id': str(index + 1), 'Player': 'Synthetic ' + row['player_id'].upper(),
                'Team': row['team'], 'Opponent': row['opponent'], 'Position': row['position'],
                'Projected Points': 10.0 + index / 10, 'Low (P10)': 5.0, 'High (P90)': 15.0,
                'projection_source': 'Imported'} for index, row in enumerate(pool)]
    by_id = {row['player_id']: row for row in ui_pool}
    slots = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'WR3', 'TE', 'FLEX', 'DST']
    built = []
    for roster in lineups:
        # Engine finalists use IDs only; UI rows retain the slot assigned by
        # their synthetic builder response, never inferred from raw events.
        ordered = sorted((by_id[pid] for pid in roster['player_ids']),
                         key=lambda row: ('QB', 'RB', 'WR', 'TE', 'DST').index(row['position']))
        qb = [row for row in ordered if row['position'] == 'QB']
        rb = [row for row in ordered if row['position'] == 'RB']
        wr = [row for row in ordered if row['position'] == 'WR']
        te = [row for row in ordered if row['position'] == 'TE']
        dst = [row for row in ordered if row['position'] == 'DST']
        ordered = qb + rb[:2] + wr[:3] + te[:1] + (rb[2:] + wr[3:] + te[1:]) + dst
        rows = [{'slot': slot, 'player_id': row['player_id'], 'dfs_id': row['dfs_id'],
                 'player': row['Player'], 'position': row['Position'], 'team': row['Team'],
                 'salary': row['salary'], 'proj': row['Projected Points'],
                 'floor': row['Low (P10)'], 'ceiling': row['High (P90)']} for slot, row in zip(slots, ordered)]
        built.append({'lineup': rows, 'total_salary': sum(row['salary'] for row in rows),
                      'total_points': sum(row['proj'] for row in rows)})
    result = {'schema_version': 'dfs_shared_browser_fixture_v1', 'synthetic': True,
              'purpose': 'Engineering browser requests and replay; not calibrated model performance.',
              'engine_inputs': {'context': deepcopy(payload['context']), 'pool': pool, 'bank': payload,
                                'lineups': lineups, 'seed': 0, 'draw_count': 256},
              'summary': scenario_bank_summary(bank), 'evaluation': report, 'collection_evaluation': collection_report,
              'ui_pool': ui_pool, 'built_lineups': built}
    output = ROOT / 'frontend/test-fixtures/dfs-shared-data.json'
    output.write_text(json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'synthetic': True, 'output': str(output), 'bank_id': bank['content_id'],
                      'counts': bank['counts'], 'lineups': len(built),
                      'paired_delta': report['lineups'][1]['paired_delta_mean_vs_first']}))


if __name__ == '__main__':
    main()
