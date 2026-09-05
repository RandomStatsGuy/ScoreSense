"""Load Draft Hub rule presets from YAML."""

from __future__ import annotations

from pathlib import Path

import yaml

from src.config import DRAFT_HUB_PRESETS_DIR
from src.draft_hub.schemas import LeagueRules


def list_presets() -> list[dict]:
    out: list[dict] = []
    if not DRAFT_HUB_PRESETS_DIR.exists():
        return out
    for path in sorted(DRAFT_HUB_PRESETS_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        payload = {k: v for k, v in data.items() if k not in ("id", "label", "description")}
        rules = LeagueRules.model_validate(payload).model_dump()
        out.append(
            {
                "id": data.get("id") or path.stem,
                "label": data.get("label") or path.stem,
                "description": data.get("description") or "",
                "draft_type": data.get("draft_type") or rules.get("draft_type") or "auction",
                "rules": rules,
            }
        )
    return out


def load_preset(preset_id: str) -> LeagueRules:
    path = DRAFT_HUB_PRESETS_DIR / f"{preset_id}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"Unknown preset: {preset_id}")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    payload = {k: v for k, v in data.items() if k not in ("id", "label", "description")}
    return LeagueRules.model_validate(payload)
