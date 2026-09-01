"""Repo skills exist and stay operational, not architectural essays."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILLS = (
    "run-tests",
    "verify-fantasy-ui",
    "mirror-prod-league",
    "match-living-surface",
    "capture-correction",
)


def _skill(name: str) -> str:
    return (ROOT / ".cursor" / "skills" / name / "SKILL.md").read_text(encoding="utf-8")


def test_task_skills_exist() -> None:
    for name in SKILLS:
        path = ROOT / ".cursor" / "skills" / name / "SKILL.md"
        assert path.is_file(), f"missing {path}"
        text = path.read_text(encoding="utf-8")
        assert f"name: {name}" in text


def test_run_tests_skill_has_commands() -> None:
    text = _skill("run-tests")
    assert "pytest" in text
    assert "PYTHONPATH=." in text
    assert "node --test frontend/src" in text
    assert "npm run build" in text


def test_verify_fantasy_ui_skill_uses_living_routes() -> None:
    text = _skill("verify-fantasy-ui")
    assert "Matching:" in text
    assert "/hub/free-agents" in text
    assert "/hub/cap" in text
    assert "mirror-prod-league" in text


def test_mirror_skill_and_unix_script_agree() -> None:
    text = _skill("mirror-prod-league")
    script = ROOT / "scripts" / "dev" / "mirror_prod_hub.sh"
    assert script.is_file()
    assert "0BBESQ" in text
    assert "mirror_prod_hub.sh" in text
    sh = script.read_text(encoding="utf-8")
    assert "import_cap_sheet.py" in sh
    assert "verify_hub_mirror.py" in sh
    assert "0BBESQ" in sh


def test_wrong_matching_updates_aliases() -> None:
    living = _skill("match-living-surface")
    rule = (ROOT / ".cursor" / "rules" / "living-surfaces.mdc").read_text(encoding="utf-8")
    assert "SURFACE_ALIASES" in living
    assert "Wrong Matching" in living
    assert "SURFACE_ALIASES" in rule
    assert "Captured:" in rule
