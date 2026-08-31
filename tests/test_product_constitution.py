"""Keep the product constitution aligned with shipped nav and always-on agent rules."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

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

RULE_FILES = (
    "frontend-draft-hub.mdc",
    "draft-hub-performance.mdc",
    "ml-projections.mdc",
)


@lru_cache(maxsize=None)
def _read(*parts: str) -> str:
    return ROOT.joinpath(*parts).read_text(encoding="utf-8")


def test_constitution_and_rules_exist() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    agents = _read("AGENTS.md")
    assert "ScoreSense product constitution" in product
    assert "alwaysApply: true" in core_rule
    assert "docs/PRODUCT.md" in core_rule
    for name in RULE_FILES:
        path = ROOT / ".cursor" / "rules" / name
        assert path.is_file(), f"missing {path}"
        assert f".cursor/rules/{name}" in agents
    assert "docs/PRODUCT.md" in agents
    assert (ROOT / "docs" / "README.md").is_file()


def test_constitution_covers_shipped_top_level_nav() -> None:
    product = _read("docs", "PRODUCT.md")
    app_nav = _read("frontend", "src", "appNavigation.js")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    for label in TOP_LEVEL:
        assert label in product
        assert f'label: "{label}"' in app_nav
        assert label in core_rule


def test_constitution_covers_shipped_fantasy_tabs() -> None:
    product = _read("docs", "PRODUCT.md")
    hub_subnav = _read("frontend", "src", "DraftHub", "HubSubnav.jsx")
    for label in FANTASY_LABELS:
        assert label in product, f"{label} missing from docs/PRODUCT.md"
        assert f'label: "{label}"' in hub_subnav, f"{label} missing from HubSubnav.jsx"


def test_constitution_covers_roster_management_panes() -> None:
    product = _read("docs", "PRODUCT.md")
    office_tabs = _read("frontend", "src", "DraftHub", "hubOfficeTabs.js")
    for label in ROSTER_MGMT_PANES:
        assert label in product
        assert f'label: "{label}"' in office_tabs


def test_constitution_forbids_stale_product_names() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    assert "Users never should" in product
    assert "Draft Hub" in product
    assert "Office" in product
    assert "fourth top-level" in product.lower() or "fourth top-level" in core_rule


def test_design_spec_defers_to_constitution() -> None:
    design = _read("docs", "design.md")
    assert "PRODUCT.md" in design
    assert "wins" in design.lower()
