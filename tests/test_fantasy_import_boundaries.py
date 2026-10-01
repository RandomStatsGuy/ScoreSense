"""Exercise cold imports; an already-imported pytest process hides this regression."""
from pathlib import Path
import subprocess
import sys


def test_league_context_and_freshness_do_not_import_model_engine():
    script = """
import importlib.abc, sys
attempts = []
class NoModels(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.startswith(('src.ml', 'src.projections.predict', 'src.projections.draft_projections', 'sklearn', 'lightgbm', 'xgboost')):
            attempts.append(fullname)
            raise AssertionError('model import on read: ' + fullname)
sys.meta_path.insert(0, NoModels())
from src.draft_hub.acquisition_window import resolve_acquisition_window
window = resolve_acquisition_window({'mode':'league','draft_completed':True,'season':2026},
    nfl_state={'season_type':'regular','season':2026,'week':4})
assert window['phase_id'] == 'in_season'
assert 'src.draft_hub.league_home' not in sys.modules
from src.draft_hub import hub_context, league_home, hub_freshness, draft_pool_cache
assert len(draft_pool_cache.pool_fingerprint()) == 16
from src.draft_hub import weekly_command_center, prepared_week_context
assert len(prepared_week_context.source_revision(2026, 4, True)) > 0
assert not attempts, attempts
"""
    result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
                            text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
