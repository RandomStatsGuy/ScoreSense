"""One-shot import path migration after repository restructure."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

REPLACEMENTS = [
    ("src.ml", "src.ml"),
    ("src.products.accuracy_report", "src.products.accuracy_report"),
    ("src.pipeline.backtest_checkpoint", "src.pipeline.backtest_checkpoint"),
    ("src.projections.draft_projections", "src.projections.draft_projections"),
    ("src.projections.draft_meta", "src.projections.draft_meta"),
    ("src.projections.ros_projections", "src.projections.ros_projections"),
    ("src.projections.projection_meta", "src.projections.projection_meta"),
    ("src.core.projection_context", "src.core.projection_context"),
    ("src.products.lineup_optimizer", "src.products.lineup_optimizer"),
    ("src.products.bestball_board", "src.products.bestball_board"),
    ("src.products.dfs_salaries", "src.products.dfs_salaries"),
    ("src.products.dfs_config", "src.products.dfs_config"),
    ("src.products.prop_scan", "src.products.prop_scan"),
    ("src.core.schedule_utils", "src.core.schedule_utils"),
    ("src.core.memory_utils", "src.core.memory_utils"),
    ("src.core.opportunity", "src.core.opportunity"),
    ("src.core.features", "src.core.features"),
    ("src.pipeline.backtest", "src.pipeline.backtest"),
    ("src.projections.predict", "src.projections.predict"),
    ("src.pipeline.train", "src.pipeline.train"),
    ("legacy.src.legacy_pff", "legacy.legacy.src.legacy_pff"),
]

SKIP_DIRS = {".venv", "node_modules", "__pycache__", ".git", "scoresense.egg-info", "frontend/dist"}


def should_process(path: Path) -> bool:
    return path.suffix == ".py" and not any(part in SKIP_DIRS for part in path.parts)


def migrate_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def main() -> None:
    changed = 0
    for path in ROOT.rglob("*.py"):
        if should_process(path):
            if migrate_file(path):
                changed += 1
                print(f"updated: {path.relative_to(ROOT)}")
    print(f"done — {changed} files updated")


if __name__ == "__main__":
    main()
