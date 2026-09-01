"""CI / Vercel config — keep GitHub cheap and Vercel off production."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CI_EXCLUDE = frozenset(
    {
        "matplotlib>=3.7.0",
        "seaborn>=0.12.0",
        "streamlit>=1.28.0",
        "PyQt5>=5.15.0",
        "pandasgui>=0.2.14",
    }
)


def _load_workflow(path: Path) -> dict:
    spec = yaml.safe_load(path.read_text(encoding="utf-8"))
    # GitHub allows `on:`; YAML 1.1 loads that key as True.
    if True in spec and "on" not in spec:
        spec["on"] = spec.pop(True)
    return spec


def _req_lines(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def test_vercel_disables_all_git_deployments():
    spec = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    assert spec["git"]["deploymentEnabled"] is False


def test_backtest_metrics_import_without_plot_libs():
    """API tests import compute_metrics; CI does not install matplotlib."""
    script = r"""
import sys

class _BlockPlotLibs:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".", 1)[0] in {"matplotlib", "seaborn"}:
            raise ModuleNotFoundError(fullname)
        return None

sys.meta_path.insert(0, _BlockPlotLibs())
import src.products.accuracy_report  # noqa: F401  — app.api import chain
from src.pipeline.backtest import compute_metrics, top_n_accuracy
import pandas as pd

metrics = compute_metrics(pd.Series([1.0, 2.0]), pd.Series([1.0, 2.0]))
assert metrics["mae"] == 0.0
hits = top_n_accuracy(
    pd.DataFrame(
        {
            "season": [2024, 2024],
            "week": [1, 1],
            "player_id": ["a", "b"],
            "Fpts": [10.0, 1.0],
            "pred": [9.0, 2.0],
        }
    ),
    "pred",
    n=1,
)
assert hits == 1.0
print("ok")
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_requirements_ci_omits_desktop_extras_and_tracks_runtime_pins():
    full = _req_lines(ROOT / "requirements.txt")
    ci = _req_lines(ROOT / "requirements-ci.txt")
    assert CI_EXCLUDE <= set(full)
    assert not (CI_EXCLUDE & set(ci))
    assert [line for line in full if line not in CI_EXCLUDE] == ci


def test_ci_workflow_skips_drafts_and_push_reruns():
    spec = _load_workflow(ROOT / ".github" / "workflows" / "ci.yml")
    assert "push" not in spec["on"]
    assert spec["jobs"]["test"]["if"] == "github.event.pull_request.draft == false"
    install = "\n".join(
        step.get("run", "")
        for step in spec["jobs"]["test"]["steps"]
        if isinstance(step, dict)
    )
    assert "requirements-ci.txt" in install
    assert "requirements.txt" not in install


def test_deploy_ignores_docs_and_render_yaml():
    spec = _load_workflow(ROOT / ".github" / "workflows" / "deploy.yml")
    ignored = spec["on"]["push"]["paths-ignore"]
    assert "docs/**" in ignored
    assert "render.yaml" in ignored
    assert "vercel.json" in ignored
    assert "tests/**" in ignored
