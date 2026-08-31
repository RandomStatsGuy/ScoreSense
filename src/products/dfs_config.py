"""DFS site roster formats and default salary caps."""

from __future__ import annotations

SITE_CONFIGS: dict[str, dict] = {
    "seasonal": {
        "label": "Season-long PPR",
        "description": "1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX — no salary cap",
        "roster": {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0},
        "salary_cap": None,
        "flex_positions": ("RB", "WR", "TE"),
        "base_site": None,
    },
    "draftkings": {
        "label": "DraftKings Classic",
        "description": "9-player NFL classic slate (QB · 2 RB · 3 WR · TE · FLEX · DST)",
        "roster": {"qb": 1, "rb": 2, "wr": 3, "te": 1, "flex": 1, "dst": 1},
        "salary_cap": 50_000,
        "flex_positions": ("RB", "WR", "TE"),
        "base_site": "draftkings",
    },
    "fanduel": {
        "label": "FanDuel Classic",
        "description": "9-player NFL classic slate (QB · 2 RB · 3 WR · TE · FLEX · DST)",
        "roster": {"qb": 1, "rb": 2, "wr": 3, "te": 1, "flex": 1, "dst": 1},
        "salary_cap": 60_000,
        "flex_positions": ("RB", "WR", "TE"),
        "base_site": "fanduel",
        # FanDuel site rule: no more than 4 players from one NFL team.
        "max_per_team_default": 4,
    },
    "draftkings_showdown": {
        "label": "DraftKings Showdown",
        "description": "Single game — CPT (1.5× points, 1.5× salary) + 5 FLEX",
        "roster": {"cpt": 1, "flex": 5},
        "salary_cap": 50_000,
        "flex_positions": ("QB", "RB", "WR", "TE", "DST"),
        "base_site": "draftkings",
        "slate_category": "showdown",
        "captain_label": "CPT",
        "captain_multiplier": 1.5,
        "captain_salary_multiplier": 1.5,
    },
    "fanduel_single": {
        "label": "FanDuel Single game",
        "description": "Single game — MVP (1.5× points, 1.5× salary) + 5 FLEX",
        "roster": {"cpt": 1, "flex": 5},
        "salary_cap": 60_000,
        "flex_positions": ("QB", "RB", "WR", "TE", "DST"),
        "base_site": "fanduel",
        "slate_category": "showdown",
        "captain_label": "MVP",
        "captain_multiplier": 1.5,
        "captain_salary_multiplier": 1.5,
    },
}


def get_site_config(site: str) -> dict:
    key = (site or "seasonal").lower()
    if key not in SITE_CONFIGS:
        known = ", ".join(SITE_CONFIGS)
        raise ValueError(f"Unknown lineup format: {site}. Use one of: {known}.")
    return SITE_CONFIGS[key]


def base_site(site: str) -> str | None:
    """Slate/salary provider for a format id ("draftkings" / "fanduel" / None)."""
    return get_site_config(site).get("base_site")


def is_captain_mode(site: str) -> bool:
    return bool(get_site_config(site)["roster"].get("cpt"))


def list_site_configs() -> dict[str, dict]:
    return {
        key: {
            "id": key,
            "label": cfg["label"],
            "description": cfg["description"],
            "roster": cfg["roster"],
            "salary_cap": cfg["salary_cap"],
            "base_site": cfg.get("base_site"),
            "slate_category": cfg.get("slate_category"),
            "captain_label": cfg.get("captain_label"),
        }
        for key, cfg in SITE_CONFIGS.items()
    }
