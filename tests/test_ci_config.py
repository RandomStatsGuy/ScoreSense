"""CI / Vercel config — keep GitHub cheap and Vercel off production."""

from __future__ import annotations

import json
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


def test_api_collects_without_matplotlib():
    """Regression: module-level pyplot in backtest broke CI on requirements-ci.txt."""
    import os
    import subprocess
    import sys

    script = r"""
import sys
from importlib.abc import MetaPathFinder

class _BlockPlots(MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if fullname.split(".", 1)[0] in {"matplotlib", "seaborn"}:
            raise ModuleNotFoundError(fullname)
        return None

sys.meta_path.insert(0, _BlockPlots())
from src.pipeline.backtest import compute_metrics
from src.products.accuracy_report import load_accuracy_report
assert callable(compute_metrics)
assert callable(load_accuracy_report)
print("ok")
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT), "TESTING": "1", "SCORESENSE_TESTING": "1"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "ok" in result.stdout


def test_vercel_disables_all_git_deployments():
    spec = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    assert spec["git"]["deploymentEnabled"] is False


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
