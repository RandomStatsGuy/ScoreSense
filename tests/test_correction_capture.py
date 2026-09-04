"""Correction-capture skill and learned-rules catalog stay machine-checkable."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FREQS = frozenset({"always", "never", "usually", "rarely"})
SCOPES = frozenset(
    {"product", "fantasy-ui", "projections", "perf", "ops", "agent"}
)
MAX_CATALOG_ROWS = 30


def _read(*parts: str) -> str:
    return ROOT.joinpath(*parts).read_text(encoding="utf-8")


def _catalog_rows(text: str) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    in_catalog = False
    seen_header = False
    for raw in text.splitlines():
        line = raw.strip()
        if line == "## Catalog":
            in_catalog = True
            continue
        if not in_catalog:
            continue
        if line.startswith("## "):
            break
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) != 3:
            continue
        if cells == ["Freq", "Scope", "Rule"]:
            seen_header = True
            continue
        if set(cells[0]) <= {"-"} and set(cells[1]) <= {"-"} and set(cells[2]) <= {"-"}:
            continue
        if not seen_header:
            continue
        rows.append((cells[0], cells[1], cells[2]))
    return rows


def test_correction_capture_rule_is_always_applied() -> None:
    rule = _read(".cursor", "rules", "correction-capture.mdc")
    skill = _read(".cursor", "skills", "capture-correction", "SKILL.md")
    assert "alwaysApply: true" in rule
    assert ".cursor/skills/capture-correction/SKILL.md" in rule
    for freq in FREQS:
        assert freq in rule
        assert f"`{freq}`" in skill or freq in skill
    assert "Captured:" in skill
    assert "Not a rule:" in skill


def test_learned_rules_rule_is_always_applied() -> None:
    rule = _read(".cursor", "rules", "learned-rules.mdc")
    assert "alwaysApply: true" in rule
    for freq in FREQS:
        assert f"`{freq}`" in rule


def test_capture_correction_skill_has_decision_tree() -> None:
    skill = _read(".cursor", "skills", "capture-correction", "SKILL.md")
    assert "name: capture-correction" in skill
    assert "**Skip**" in skill
    assert "**Ask**" in skill
    assert "**Persist**" in skill
    for freq in FREQS:
        assert f"`{freq}`" in skill
    for scope in SCOPES:
        assert f"`{scope}`" in skill
    assert ".cursor/rules/learned-rules.mdc" in skill


def test_learned_rules_catalog_rows_are_valid() -> None:
    rows = _catalog_rows(_read(".cursor", "rules", "learned-rules.mdc"))
    assert len(rows) <= MAX_CATALOG_ROWS
    assert len(rows) == 3
    for freq, scope, rule in rows:
        assert freq in FREQS, f"bad freq {freq!r}"
        assert scope in SCOPES, f"bad scope {scope!r}"
        assert rule, "empty rule"
        assert "|" not in rule
    joined = " ".join(rule for _freq, _scope, rule in rows)
    assert "docs/mockups" in joined
    assert "existing PR branch" in joined
    assert "GBM weekly" in joined


def test_core_and_index_point_at_capture_files() -> None:
    readme = _read("docs", "README.md")
    cursorrules = _read(".cursorrules")
    assert "correction-capture.mdc" in readme
    assert "learned-rules.mdc" in readme
    assert "correction-capture.mdc" in cursorrules
    assert "learned-rules.mdc" in cursorrules
