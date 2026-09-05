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
    "Vibes",
    "Game center",
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
    "correction-capture.mdc",
    "learned-rules.mdc",
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


def test_constitution_covers_account_report() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    onboarding = _read("docs", "ONBOARDING.md")
    assert "Report a bug" in product
    assert "ONBOARDING.md" in product
    assert "user-reported" in onboarding
    assert "pickup" in onboarding
    assert "Report a bug" in core_rule
    assert '"/report"' in _read("frontend", "src", "AppRouter.jsx")


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


def test_constitution_covers_phone_chrome() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    assert "On phone, the header is the current destination" in product
    assert "one-row league strip" in product
    assert "destination title" in core_rule.lower()
    assert "one-row league strip" in core_rule.lower()


def test_constitution_covers_chat_chrome() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    assert "FantasyChatDock" in product
    assert "edge launcher" in product
    assert "side drawer" in product
    assert "locker rail" in product
    assert "FantasyChatDock" in core_rule
    assert "edge launcher" in core_rule


def test_constitution_covers_compact_tile_spacing() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    hub_rule = _read(".cursor", "rules", "frontend-draft-hub.mdc")
    assert "spacing rhythm" in product
    assert "never flush" in product
    assert "--text-xs" in product
    assert "never flush" in core_rule
    assert "--text-xs" in core_rule
    assert "token padding" in hub_rule
    assert "--text-xs" in hub_rule


def test_css_type_never_drops_below_text_xs() -> None:
    import re

    pat = re.compile(r"font-size:\s*(0\.\d+)rem")
    offenders = []
    for path in (ROOT / "frontend" / "src").rglob("*.css"):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            match = pat.search(line)
            if match and float(match.group(1)) < 0.72:
                offenders.append(f"{path.relative_to(ROOT)}:{lineno}:{match.group(1)}")
    assert not offenders, "type below previous --text-xs floor (0.72rem):\n" + "\n".join(offenders[:30])
    tokens = _read("frontend", "src", "styles", "tokens.css")
    assert "--text-xs: 0.75rem" in tokens
    assert "12px" in _read("docs", "PRODUCT.md")
    rhythm = _read("frontend", "src", "styles", "product-rhythm.css")
    main = _read("frontend", "src", "main.jsx")
    assert "--inset-chip" in rhythm
    assert "product-rhythm.css" in main


def test_constitution_covers_copy_voice() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    assert "cost of getting it wrong" in product
    assert "slogan that could sit on another" in product
    assert "cost of getting it wrong" in core_rule


def test_constitution_covers_weekly_board_chrome() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    assert "always-on" in product.lower()
    assert "compare" in product.lower()
    assert "compact Q" in product or "compact Q / D / P" in product
    assert "inspector" in product.lower()
    assert "New, never 0" in product
    assert "compare" in core_rule.lower()
    assert "dense ranking rows" in product
    assert "checkbox on every card" in product
    assert "swipeable" in product
    assert "windowed" in product
    assert "sticky bar" in product

def test_constitution_bans_hub_ppr_in_ui() -> None:
    product = _read("docs", "PRODUCT.md")
    assert "ScoreSense PPR" in product
    assert 'the string "Hub PPR" never reaches UI' in product

def test_constitution_empty_states_name_a_destination() -> None:
    product = _read("docs", "PRODUCT.md")
    assert "League settings" in product
    assert "never a label like League settings" in product
    assert "Roster management · Access & imports" in product
