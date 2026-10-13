"""Reproduce the frozen exploratory zero-mass median probe; no model fitting.

Run from the repository root with PYTHONPATH=. and TESTING=1. Inputs are the
isolated saved earlier-season logistic and corrected component replay rows.
The 0.5 rule was declared before examining this probe's outcome metrics.
"""
import hashlib
import inspect
import json
from pathlib import Path
import numpy as np
import pandas as pd
from src.analytics.forecast_candidate_eval import _cohorts, diagnostic_gate
from src.analytics.forecast_validation import boom_flags, forecast_metrics, paired_week_bootstrap
from src.ml.quantile import repair_quantile_order


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


out = Path('outputs/dfs-accuracy-zero/hurdle-probe.json')
zero_path = Path('outputs/dfs-accuracy-zero/wr-observed-zero.rows.parquet')
zero_report_path = Path('outputs/dfs-accuracy-zero/wr-observed-zero.json')
reference_report_path = Path('outputs/dfs-accuracy-impact/wr/wr_serving_timing.json')
zeros = pd.read_parquet(zero_path)
zero_report = json.loads(zero_report_path.read_text())
reference_report = json.loads(reference_report_path.read_text())
assert reference_report['source_sha256'] in zero_report['source_sha256'].values()
zero_folds = {row['season']: row for row in zero_report['folds']}
reference_folds = {row['season']: row for row in reference_report['comparisons']}
report = {
    'schema_version': 'observed_wr_te_zero_mass_median_probe_v1',
    'conditioning': zero_report['conditioning'],
    'rule': 'Only known prior target and scoring history with independently earlier-season fitted classifier p_zero >= 0.5: set corrected P50 to 0 and repair quantile order. Threshold 0.5 fixed before examining results.',
    'threshold': 0.5,
    'point_reference': 'Corrected serving-derived usage component replay, per-fold earlier-season quantile fits',
    'p_zero_reference': 'Independent fixed logistic event head fitted only on earlier regular seasons',
    'production_changed': False,
    'model_fit_performed_by_probe': False,
    'promoted': False,
    'source_sha256': {str(p): digest(p) for p in (zero_path, zero_report_path, reference_report_path)},
    'comparisons': [],
    'limitations': zero_report['limitations'] + [
        'This is a new exploratory postprocessing screen, not a qualification or untouched-holdout result.',
        'Candidate retains original tail inputs and heads; quantile-order repair can change the displayed P10 when P50 becomes zero.',
        'Reference quantile forecasts replay a component of serving; neither arm authenticates original historical pre-lock source publication.',
        'Actionable/industry cohorts are frozen on corrected reference predictions. Low usage is predeclared prior-four-game targets <= 2; no salary-based cohort is available.',
        'No-history medians are unchanged even when the classifier probability exceeds one half.'
    ]
}
for function in (_cohorts, diagnostic_gate, forecast_metrics, paired_week_bootstrap, repair_quantile_order):
    p = Path(inspect.getsourcefile(function))
    report['source_sha256'][str(p)] = digest(p)
saved = []
for season in range(2019, 2026):
    assert zero_folds[season]['training_max_season'] == season - 1
    assert reference_folds[season]['training_max_season'] == season - 1
    path = Path(f'outputs/dfs-accuracy-impact/wr/wr_{season}_rows.parquet')
    report['source_sha256'][str(path)] = digest(path)
    reference_rows = pd.read_parquet(path)
    z = zeros[zeros.season.eq(season)]
    assert not reference_rows.duplicated(['player_id', 'season', 'week']).any()
    assert not z.duplicated(['player_id', 'season', 'week']).any()
    rows = reference_rows.merge(z, on=['player_id', 'season', 'week'], how='outer', validate='one_to_one', suffixes=('', '_zero'), indicator=True)
    assert rows['_merge'].eq('both').all(), (season, rows['_merge'].value_counts().to_dict())
    assert np.array_equal(rows.Fpts.to_numpy(), rows.Fpts_zero.to_numpy())
    assert rows.position.eq(rows.position_zero).all()
    assert np.array_equal(rows.recent4_targets_avg.to_numpy(), rows.recent4_targets_avg_zero.to_numpy(), equal_nan=True)
    reference = pd.DataFrame({key: rows[f'corrected_{key}'].to_numpy() for key in ('q10', 'q50', 'q90')}, index=rows.index)
    candidate = reference.copy()
    eligible = (rows.recent4_targets_avg.notna() & rows.recent4_Fpts_avg.notna() & rows.probability_classifier.ge(.5))
    candidate.loc[eligible, 'q50'] = 0.
    candidate = repair_quantile_order(candidate)
    comparison = {
        'season': season, 'training_max_season': season - 1,
        'source_zero_head_sha256': zero_folds[season]['fitted_pipeline_sha256'],
        'source_quantile_checkpoint_sha256': reference_folds[season]['checkpoint_sha256'],
        'rule_eligible_rows': int(eligible.sum()),
        'changed_median_rows': int(candidate.q50.ne(reference.q50).sum()),
        'repaired_p10_rows': int(candidate.q10.ne(reference.q10).sum()),
        'repaired_p90_rows': int(candidate.q90.ne(reference.q90).sum()),
        'cohorts': _cohorts(rows, reference, candidate, 'wr')
    }
    flags_ref, flags_cand = boom_flags(rows, reference, 'wr'), boom_flags(rows, candidate, 'wr')
    for name, mask in (
        ('known_low_usage', rows.recent4_targets_avg.notna() & rows.recent4_targets_avg.le(2)),
        ('unknown_prior_usage', rows.recent4_targets_avg.isna()),
        ('changed_by_rule', candidate.q50.ne(reference.q50))
    ):
        if mask.any():
            comparison['cohorts'][name] = {
                'reference': forecast_metrics(rows, reference, 'wr', mask=mask, flags=flags_ref),
                'candidate': forecast_metrics(rows, candidate, 'wr', mask=mask, flags=flags_cand),
                'paired_mae': paired_week_bootstrap(rows, reference, candidate, mask=mask)
            }
        else:
            comparison['cohorts'][name] = {'rows': 0, 'metrics': None}
    report['comparisons'].append(comparison)
    saved_row = rows[['player_id', 'season', 'week', 'position', 'Fpts', 'recent4_targets_avg', 'recent4_Fpts_avg', 'probability_classifier']].copy()
    saved_row['rule_eligible'] = eligible
    for label, predictions in [('reference', reference), ('candidate', candidate)]:
        for key in ('q10', 'q50', 'q90'):
            saved_row[f'{label}_{key}'] = predictions[key]
    saved.append(saved_row)
report['diagnostic_gate'] = diagnostic_gate(report['comparisons'])
all_rows = pd.concat(saved, ignore_index=True)
reference = all_rows[['reference_q10', 'reference_q50', 'reference_q90']].rename(columns=lambda x: x.removeprefix('reference_'))
candidate = all_rows[['candidate_q10', 'candidate_q50', 'candidate_q90']].rename(columns=lambda x: x.removeprefix('candidate_'))
report['pooled_cohorts'] = _cohorts(all_rows, reference, candidate, 'wr')
mask = all_rows.recent4_targets_avg.notna() & all_rows.recent4_targets_avg.le(2)
report['pooled_cohorts']['known_low_usage'] = {
    'reference': forecast_metrics(all_rows, reference, 'wr', mask=mask, flags=boom_flags(all_rows, reference, 'wr')),
    'candidate': forecast_metrics(all_rows, candidate, 'wr', mask=mask, flags=boom_flags(all_rows, candidate, 'wr')),
    'paired_mae': paired_week_bootstrap(all_rows, reference, candidate, mask=mask)
}
row_path = out.with_suffix('.rows.parquet')
all_rows.to_parquet(row_path, index=False)
report['row_forecasts'] = {'path': str(row_path), 'sha256': digest(row_path), 'rows': len(all_rows)}
out.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8', newline='\n')
print(json.dumps(report['diagnostic_gate'], indent=2))
for c in report['comparisons']:
    print('YEAR', c['season'], 'eligible', c['rule_eligible_rows'], 'changed', c['changed_median_rows'], 'p10', c['repaired_p10_rows'], 'p90', c['repaired_p90_rows'])
    for name in ('all_observed', 'actionable', 'known_low_usage', 'unknown_prior_usage'):
        p = c['cohorts'][name]
        print(json.dumps({
            'cohort': name, 'n': p['reference']['rows'],
            'mae': [p['reference']['mae'], p['candidate']['mae']],
            'wis': [p['reference']['weighted_interval_score'], p['candidate']['weighted_interval_score']],
            'ci': p['paired_mae']['ci95'],
            'boom_recall': [p['reference']['boom']['recall'], p['candidate']['boom']['recall']],
            'boom_precision': [p['reference']['boom']['precision'], p['candidate']['boom']['precision']],
            'bust_f1': [p['reference']['bust']['f1'], p['candidate']['bust']['f1']]
        }))
