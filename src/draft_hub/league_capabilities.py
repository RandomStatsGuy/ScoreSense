"""Authoritative Fantasy league feature capabilities derived from league rules."""

from __future__ import annotations

from typing import Any

from src.draft_hub.schemas import LeagueRules

CAPABILITIES_VERSION = 1


def league_capabilities(rules: LeagueRules | dict[str, Any]) -> dict[str, Any]:
    parsed = rules if isinstance(rules, LeagueRules) else LeagueRules.model_validate(rules)
    uses_salaries = parsed.draft_type == "auction"
    return {
        "version": CAPABILITIES_VERSION,
        "draft_type": parsed.draft_type,
        "economics": "salary_cap" if uses_salaries else "none",
        "uses_salaries": uses_salaries,
        "uses_contracts": uses_salaries,
        "acquisition_mode": "bid" if uses_salaries else "priority",
    }


def uses_salaries(rules: LeagueRules | dict[str, Any]) -> bool:
    return bool(league_capabilities(rules)["uses_salaries"])


def uses_contracts(rules: LeagueRules | dict[str, Any]) -> bool:
    return bool(league_capabilities(rules)["uses_contracts"])
