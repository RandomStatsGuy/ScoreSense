"""Straightforward Insights award titles, with optional commissioner overrides."""

from __future__ import annotations

from typing import Any

# id -> default title. Keep these factual; commissioners can rename per league.
DEFAULT_AWARD_TITLES: dict[str, str] = {
    "highest_paid": "Highest salary",
    "most_overpaid": "Most over market",
    "worst_contract": "Highest multiple",
    "best_bargain": "Best discount",
    "waiver_king": "Most $1 seasons",
    "cap_hog": "Largest cap share",
    "payroll_king": "Highest committed",
    "dead_cap_disaster": "Most dead cap",
    "nomad": "Most teams",
    "loyalty": "Longest tenure",
    "career_earnings": "Career earnings",
    "biggest_raise": "Biggest raise",
    "cap_crunch": "Least cap remaining",
    "points_king": "Most points",
    "basement": "Fewest points",
    "weekly_nuke": "Highest week",
    "weekly_disaster": "Lowest week",
    "margin_massacre": "Largest weekly margin",
    "nail_biter": "Closest weekly finish",
    "always_runner_up": "Most runner-up weeks",
    "steady_eddie": "Most consistent",
    "rollercoaster": "Least consistent",
    "floor_collapse": "Biggest weekly swing",
    "participation_trophy": "Closest to average",
    "wire_to_wire": "Most weekly highs",
    "cap_efficiency_goat": "Best points per dollar",
    "cap_efficiency_fraud": "Worst points per dollar",
}

AWARD_GROUPS: dict[str, str] = {
    "highest_paid": "spend",
    "most_overpaid": "spend",
    "worst_contract": "spend",
    "best_bargain": "spend",
    "waiver_king": "spend",
    "cap_hog": "spend",
    "payroll_king": "spend",
    "dead_cap_disaster": "spend",
    "nomad": "spend",
    "loyalty": "spend",
    "career_earnings": "spend",
    "biggest_raise": "spend",
    "cap_crunch": "spend",
    "points_king": "scoring",
    "basement": "scoring",
    "weekly_nuke": "scoring",
    "weekly_disaster": "scoring",
    "margin_massacre": "scoring",
    "nail_biter": "scoring",
    "always_runner_up": "scoring",
    "steady_eddie": "scoring",
    "rollercoaster": "scoring",
    "floor_collapse": "scoring",
    "participation_trophy": "scoring",
    "wire_to_wire": "scoring",
    "cap_efficiency_goat": "scoring",
    "cap_efficiency_fraud": "scoring",
}


def award_title(award_id: str, default: str | None = None) -> str:
    return DEFAULT_AWARD_TITLES.get(award_id) or default or award_id.replace("_", " ").title()


def normalize_award_titles(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in raw.items():
        aid = str(key or "").strip()
        title = str(value or "").strip()
        if aid and title:
            out[aid] = title[:48]
    return out


def apply_award_titles(
    awards: list[dict[str, Any]] | None,
    titles: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Apply commissioner title overrides. Drops leftover roast copy."""
    custom = normalize_award_titles(titles)
    out: list[dict[str, Any]] = []
    for award in awards or []:
        row = dict(award)
        aid = str(row.get("id") or "")
        if aid in custom:
            row["title"] = custom[aid]
            row["title_custom"] = True
        elif aid in DEFAULT_AWARD_TITLES and not row.get("title_custom"):
            row["title"] = DEFAULT_AWARD_TITLES[aid]
        row["roast"] = None
        out.append(row)
    return out


def award_catalog(titles: dict[str, str] | None = None) -> list[dict[str, str]]:
    custom = normalize_award_titles(titles)
    return [
        {
            "id": award_id,
            "group": AWARD_GROUPS.get(award_id, "other"),
            "default_title": default,
            "title": custom.get(award_id) or default,
        }
        for award_id, default in DEFAULT_AWARD_TITLES.items()
    ]
