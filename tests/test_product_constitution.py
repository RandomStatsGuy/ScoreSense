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
    "frontend-craft.mdc",
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
    design = _read("docs", "specs", "rules-center-2026-08.md")
    assert "Historical spec" in design
    assert "PRODUCT.md" in design
    assert "frontend-craft.mdc" in design
    assert "wins" in design.lower()
    assert "| Players |" not in design
    assert "| Free agents |" in design
    assert "## 10. Visual design language" not in design
    assert not (ROOT / "docs" / "design.md").exists()


def test_constitution_covers_phone_chrome() -> None:
    product = _read("docs", "PRODUCT.md")
    phone_css = _read("frontend", "src", "styles", "fantasy-phone.css")
    craft = _read(".cursor", "rules", "frontend-craft.mdc")
    assert "On phone, the header is the current destination" in product
    assert "one-row league strip" in product
    assert "League-strip option menus" in product
    assert "hub-page-sticky" in product
    assert "/hub/roster-management" in product
    assert "sits on the bubble" in product
    assert "destination title" in phone_css
    assert "one-row league strip" in phone_css
    assert "hub-page-sticky" in phone_css
    assert "equal" in craft and "padding" in craft
    assert "hub-league-context-bar" in craft
    assert "layout_audit `menus`" in craft


def test_constitution_covers_league_strip_menu_stacking() -> None:
    product = _read("docs", "PRODUCT.md")
    css = _read("frontend", "src", "styles.css")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    assert "League-strip option menus" in product
    assert "later `.hub-page`" in product
    assert ".draft-hub > .hub-league-context-bar" in css
    assert "z-index: var(--z-dropdown);" in css
    assert "League-strip option menus" in core_rule


def test_constitution_covers_chat_chrome() -> None:
    product = _read("docs", "PRODUCT.md")
    dock = _read("frontend", "src", "DraftHub", "FantasyChatDock.jsx")
    assert "FantasyChatDock" in product
    assert "edge launcher" in product
    assert "side drawer" in product
    assert "locker rail" in product
    assert "flush edge launcher" in dock
    assert "Do not show this launcher on Home" in dock


def test_constitution_covers_compact_tile_spacing() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    craft = _read(".cursor", "rules", "frontend-craft.mdc")
    assert "spacing rhythm" in product
    assert "never flush" in product
    assert "--text-xs" in product
    assert "never flush" in core_rule
    assert "--text-xs" in core_rule
    assert "Fix the primitive" in core_rule
    assert "frontend-craft.mdc" in core_rule
    assert "--space-1" in craft
    assert "hub-page-sticky" in craft


def test_css_type_never_drops_below_text_xs() -> None:
    import re

    pat = re.compile(r"font-size:\s*(0\.\d+)rem")
    offenders = []
    for path in (ROOT / "frontend" / "src").rglob("*.css"):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            match = pat.search(line)
            if match and float(match.group(1)) < 0.75:
                offenders.append(f"{path.relative_to(ROOT)}:{lineno}:{match.group(1)}")
    assert not offenders, "type below --text-xs floor (0.75rem / 12px):\n" + "\n".join(offenders[:30])
    tokens = _read("frontend", "src", "styles", "tokens.css")
    assert "--text-xs: 12px" in tokens
    assert "12px computed" in _read("docs", "PRODUCT.md")
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


def test_constitution_covers_best_ball_board() -> None:
    product = _read("docs", "PRODUCT.md")
    living = _read("frontend", "src", "livingSurfaces.js")
    hub_rule = _read(".cursor", "rules", "frontend-draft-hub.mdc")
    assert "Tools · Best ball" in product
    assert "No ECR" in product
    assert "Scoring: PPR" in product
    assert "labeled Pos / Sort" in product
    assert "No ECR" in living
    assert "Scoring: PPR" in living
    assert "table-wrap" in hub_rule


def test_constitution_covers_weekly_board_chrome() -> None:
    product = _read("docs", "PRODUCT.md")
    living = _read("frontend", "src", "livingSurfaces.js")
    assert "always-on" in product.lower()
    assert "compare" in product.lower()
    assert "compact Q" in product or "compact Q / D / P" in product
    assert "inspector" in product.lower()
    assert "New, never 0" in product
    assert "Weekly compare" in living
    assert "dense ranking rows" in product
    assert "checkbox on every card" in product
    assert "swipeable" in product
    assert "windowed" in product
    assert "sticky bar" in product
    assert "missing-notes freshness chip" in product
    assert "header Refresh on Weekly" in product
    assert "stale or missing-notes chip is the refresh" in living
    assert "does not start the weekly ETL pipeline" in product
    assert "do not start the weekly ETL pipeline" in living

def test_constitution_bans_hub_ppr_in_ui() -> None:
    product = _read("docs", "PRODUCT.md")
    assert "ScoreSense PPR" in product
    assert 'the string "Hub PPR" never reaches UI' in product

def test_constitution_covers_landmarks_and_exclusive_choices() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    hub_rule = _read(".cursor", "rules", "frontend-draft-hub.mdc")
    assert "main-content" in product
    assert "radiogroup" in product
    assert "aria-live" in product
    assert "list-item" in product
    assert "13px" in product
    assert "best-in-set" in product
    assert "main-content" in core_rule
    assert "radiogroup" in hub_rule
    assert "aria-live" in hub_rule
    assert "list-item" in hub_rule


def test_constitution_covers_painted_media() -> None:
    product = _read("docs", "PRODUCT.md")
    perf = _read(".cursor", "rules", "draft-hub-performance.mdc")
    hub = _read(".cursor", "rules", "frontend-draft-hub.mdc")
    assert "?w=48" in product
    assert "studio original" in product
    assert "?w=" in perf
    assert "painted size" in hub


def test_constitution_empty_states_name_a_destination() -> None:
    product = _read("docs", "PRODUCT.md")
    assert "League settings" in product
    assert "never a label like League settings" in product
    assert "Roster management · Access & imports" in product


def test_constitution_covers_league_delete_and_workbook() -> None:
    product = _read("docs", "PRODUCT.md")
    assert "Every commissioner must type the league name" in product
    assert "Members download that same workbook on Rosters" in product


def test_strategy_is_deliberate_hero_band_exception() -> None:
    product = _read("docs", "PRODUCT.md")
    core_rule = _read(".cursor", "rules", "scoresense-core.mdc")
    assert "only Fantasy destination without a `HubExperienceHero` band" in product
    assert "Do not add `HubExperienceHero` to Strategy" in product
    assert "Strategy is the board-first exception" in core_rule
