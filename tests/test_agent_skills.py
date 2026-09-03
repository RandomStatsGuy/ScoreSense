"""Repo skills exist and stay operational, not architectural essays."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKILLS = (
    "run-tests",
    "verify-fantasy-ui",
    "mirror-prod-league",
    "start-local-app",
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
    assert "start-local-app" in text


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


def test_start_local_app_skill_does_not_remirror() -> None:
    text = _skill("start-local-app")
    assert "start_hub_dev.sh" in text
    assert "127.0.0.1:8000" in text
    assert "127.0.0.1:5173" in text
    assert "Do not remirror" in text or "do not remirror" in text.lower()
    assert "preseason_refresh" in text


def test_cloud_environment_json_starts_api_and_vite() -> None:
    import json

    path = ROOT / ".cursor" / "environment.json"
    assert path.is_file()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["install"] == "bash scripts/dev/cloud_install.sh"
    assert data["start"] == "bash scripts/dev/ensure_cloud_env.sh"
    ports = {row["port"] for row in data["ports"]}
    assert {8000, 5173} <= ports
    assert ports <= {8000, 5173, 5174}
    by_name = {row["name"]: row["port"] for row in data["ports"]}
    assert by_name["API"] == 8000
    assert by_name["Vite"] == 5173
    commands = " ".join(row["command"] for row in data["terminals"])
    assert "run_api.sh" in commands
    assert "run_vite.sh" in commands
    mockup_cmds = [row["command"] for row in data["terminals"] if row.get("name") == "Mockups"]
    if mockup_cmds:
        assert by_name.get("Mockups") == 5174
        assert "run_vite.sh" not in mockup_cmds[0]
        assert "http.server" in mockup_cmds[0] or "serve_mockups.sh" in mockup_cmds[0]
    blob = path.read_text(encoding="utf-8")
    assert "mirror" not in blob.lower()
    assert "preseason_refresh" not in blob

    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert "!.cursor/environment.json" in gitignore

    for name in (
        "cloud_install.sh",
        "ensure_cloud_env.sh",
        "run_api.sh",
        "run_vite.sh",
        "start_hub_dev.sh",
        "wait_for_dev.sh",
    ):
        script = ROOT / "scripts" / "dev" / name
        assert script.is_file(), name
        text = script.read_text(encoding="utf-8")
        assert "mirror_prod_hub" not in text
        assert "preseason_refresh" not in text

    install = (ROOT / "scripts" / "dev" / "cloud_install.sh").read_text(encoding="utf-8")
    assert "requirements-ci.txt" in install
    assert "import uvicorn" in install
    assert "-r requirements.txt" not in install
    assert "python3-venv" in install
    assert "ensurepip" in install

    agents = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    product = (ROOT / "docs" / "PRODUCT.md").read_text(encoding="utf-8")
    assert "Cursor Cloud specific instructions" in agents
    assert ".cursor/environment.json" in product
    assert "0BBESQ" in agents
