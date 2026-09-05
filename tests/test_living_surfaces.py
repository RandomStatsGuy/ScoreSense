"""Living surface registry stays aligned with shipped nav and real files."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SURFACES = ROOT / "frontend" / "src" / "livingSurfaces.js"

CHROME = frozenset(
    {
        "experience",
        "action-center",
        "rules-center",
        "table",
        "board",
        "matchup",
        "draft-live",
        "office",
        "account",
    }
)
KEY_RE = re.compile(r'^\s+"([^"]+)": S\(\{', re.M)
HUB_ID_RE = re.compile(r'\{ id: "([a-z-]+)"')
TAB_ID_RE = re.compile(r'\{ id: "([a-z-]+)"')
PATH_RE = re.compile(r'(?:page|copy): "([^"]+)"')
ALSO_PATH_RE = re.compile(r'"(frontend/src/[^"]+)"')
CHROME_RE = re.compile(r'chrome: "([^"]+)"')


def _read(*parts: str) -> str:
    return ROOT.joinpath(*parts).read_text(encoding="utf-8")


def _surface_ids() -> set[str]:
    return set(KEY_RE.findall(_read("frontend", "src", "livingSurfaces.js")))


def _hub_ids() -> list[str]:
    return HUB_ID_RE.findall(_read("frontend", "src", "DraftHub", "HubSubnav.jsx"))


def _nav_tab_ids(const_name: str) -> list[str]:
    text = _read("frontend", "src", "appNavigation.js")
    block = re.search(rf"export const {const_name} = \[(.*?)\];", text, re.S)
    assert block, f"missing {const_name}"
    return TAB_ID_RE.findall(block.group(1))


def _office_ids() -> list[str]:
    text = _read("frontend", "src", "DraftHub", "hubOfficeTabs.js")
    block = re.search(r"export const OFFICE_TABS = \[(.*?)\];", text, re.S)
    assert block
    return TAB_ID_RE.findall(block.group(1))


def test_living_surfaces_rule_and_skill_exist() -> None:
    core = _read(".cursor", "rules", "scoresense-core.mdc")
    skill = _read(".cursor", "skills", "match-living-surface", "SKILL.md")
    assert not (ROOT / ".cursor" / "rules" / "living-surfaces.mdc").exists()
    assert "Matching:" in core
    assert "frontend/src/livingSurfaces.js" in core
    assert "name: match-living-surface" in skill
    assert "resolveLivingSurfaceFromText" in skill
    assert "second" in skill.lower()


def test_every_fantasy_tab_has_a_living_surface() -> None:
    ids = _surface_ids()
    for hub_id in _hub_ids():
        assert f"hub.{hub_id}" in ids, f"missing living surface hub.{hub_id}"
    assert "hub.room.live" in ids
    assert "hub.setup" in ids


def test_tools_projections_office_and_account_are_registered() -> None:
    ids = _surface_ids()
    for tab in _nav_tab_ids("TOOLS_TABS"):
        assert f"tools.{tab}" in ids, f"missing tools.{tab}"
    for tab in _nav_tab_ids("PROJECTIONS_TABS"):
        assert f"projections.{tab}" in ids, f"missing projections.{tab}"
    for tab in _office_ids():
        assert f"hub.office.{tab}" in ids, f"missing hub.office.{tab}"
    assert "projections.inspector" in ids
    assert "tools.mock-draft.live" in ids
    for account in ("model", "admin", "account", "report", "login", "register", "privacy", "terms", "sms-alerts"):
        assert f"account.{account}" in ids


def test_living_surface_paths_exist_and_chrome_is_known() -> None:
    text = _read("frontend", "src", "livingSurfaces.js")
    for chrome in CHROME_RE.findall(text):
        assert chrome in CHROME, f"unknown chrome {chrome}"
    paths = set(PATH_RE.findall(text)) | set(ALSO_PATH_RE.findall(text))
    paths.discard("frontend/src/...")
    assert paths
    for rel in sorted(paths):
        if rel.endswith(".js") and "resolveLivingSurface" in rel:
            continue
        assert (ROOT / rel).is_file(), f"missing {rel}"


def test_registry_donots_name_concrete_jobs() -> None:
    text = _read("frontend", "src", "livingSurfaces.js")
    assert "ECR or ADP by its real name" in text
    assert "writes no league state" in text
    assert "summary-rail primary is the move" in text
    hub = _read(".cursor", "rules", "frontend-draft-hub.mdc")
    assert "Rules risk posture" in hub


def test_constitution_and_core_point_at_living_surfaces() -> None:
    product = _read("docs", "PRODUCT.md")
    core = _read(".cursor", "rules", "scoresense-core.mdc")
    readme = _read("docs", "README.md")
    craft = _read(".cursor", "rules", "frontend-craft.mdc")
    assert "livingSurfaces.js" in product
    assert "livingSurfaces.js" in core
    assert "Matching:" in core
    assert "frontend-craft.mdc" in core
    assert "livingSurfaces.js" in readme
    assert "layout_audit.mjs" in craft
    assert "living-surfaces.mdc" not in _read("AGENTS.md")


def test_layout_audit_helpers() -> None:
    import subprocess

    result = subprocess.run(
        ["node", "--test", "scripts/dev/layout_audit.test.mjs"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_living_surfaces_declare_audit_routes() -> None:
    text = _read("frontend", "src", "livingSurfaces.js")
    assert 'route: "/hub/insights/overview"' in text
    assert 'route: "/hub/free-agents"' in text
    assert "export function livingSurfaceRoutes" in text
