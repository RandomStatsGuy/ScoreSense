"""Keep the product constitution aligned with shipped nav and always-on agent rules."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = (ROOT / "docs" / "PRODUCT.md").read_text(encoding="utf-8")
CORE_RULE = (ROOT / ".cursor" / "rules" / "scoresense-core.mdc").read_text(encoding="utf-8")
AGENTS = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
HUB_SUBNAV = (ROOT / "frontend" / "src" / "DraftHub" / "HubSubnav.jsx").read_text(encoding="utf-8")
APP_NAV = (ROOT / "frontend" / "src" / "appNavigation.js").read_text(encoding="utf-8")
OFFICE_TABS = (ROOT / "frontend" / "src" / "DraftHub" / "hubOfficeTabs.js").read_text(encoding="utf-8")

FANTASY_LABELS = [
    "Home",
    "Strategy",
    "Draft",
    "This Week",
    "My team",
    "Free agents",
    "Rosters",
    "Cap",
    "Trades",
    "Rules",
    "Roster management",
    "Insights",
]

TOP_LEVEL = ["Projections", "Fantasy", "Tools"]

ROSTER_MGMT_PANES = ["Contracts", "Salary sheets", "Members", "Access & imports"]


def test_constitution_and_rules_exist() -> None:
    assert "ScoreSense product constitution" in PRODUCT
    assert "alwaysApply: true" in CORE_RULE
    assert "docs/PRODUCT.md" in CORE_RULE
    for name in ("frontend-draft-hub.mdc", "draft-hub-performance.mdc", "ml-projections.mdc"):
        path = ROOT / ".cursor" / "rules" / name
        assert path.is_file(), f"missing {path}"
    assert "docs/PRODUCT.md" in AGENTS
    assert (ROOT / "docs" / "README.md").is_file()


def test_constitution_covers_shipped_top_level_nav() -> None:
    for label in TOP_LEVEL:
        assert label in PRODUCT
        assert f'label: "{label}"' in APP_NAV
        assert label in CORE_RULE


def test_constitution_covers_shipped_fantasy_tabs() -> None:
    for label in FANTASY_LABELS:
        assert label in PRODUCT, f"{label} missing from docs/PRODUCT.md"
        assert f'label: "{label}"' in HUB_SUBNAV, f"{label} missing from HubSubnav.jsx"


def test_constitution_covers_roster_management_panes() -> None:
    for label in ROSTER_MGMT_PANES:
        assert label in PRODUCT
        assert f'label: "{label}"' in OFFICE_TABS


def test_constitution_forbids_stale_product_names() -> None:
    assert "Users never should" in PRODUCT
    assert "Draft Hub" in PRODUCT
    assert "Office" in PRODUCT
    assert "fourth top-level" in PRODUCT.lower() or "fourth top-level" in CORE_RULE


def test_design_spec_defers_to_constitution() -> None:
    design = (ROOT / "docs" / "design.md").read_text(encoding="utf-8")
    assert "PRODUCT.md" in design
    assert "wins" in design.lower()
