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
    "add-fantasy-destination",
    "add-hub-route",
    "add-ui-copy",
    "change-league-rules",
    "refresh-draft-pool",
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


def test_production_skills_name_canonical_files() -> None:
    dest = _skill("add-fantasy-destination")
    assert "HubSubnav.jsx" in dest
    assert "livingSurfaces.js" in dest
    assert "routes.js" in dest
    assert "PRODUCT.md" in dest

    route = _skill("add-hub-route")
    assert "require_hub_user" in route
    assert "value_sheet.py" in route
    assert "process_pool" in route
    assert "predict_*" in route or "predict_" in route

    copy = _skill("add-ui-copy")
    assert "*Presentation.js" in copy or "Presentation.js" in copy
    assert "node:test" in copy
    assert "Commissioner managed" in copy

    rules = _skill("change-league-rules")
    assert "rulesPresentation.js" in rules
    assert "new contracts only" in rules
    assert "rules_engine.py" in rules

    pool = _skill("refresh-draft-pool")
    assert "preseason_refresh" in pool
    assert "fix_artifact_fingerprints.py" in pool
    assert "draft_pool" in pool


def test_wrong_matching_updates_aliases() -> None:
    living = _skill("match-living-surface")
    rule = (ROOT / ".cursor" / "rules" / "living-surfaces.mdc").read_text(encoding="utf-8")
    assert "SURFACE_ALIASES" in living
    assert "Wrong Matching" in living
    assert "SURFACE_ALIASES" in rule
    assert "Captured:" in rule
