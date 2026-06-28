"""DFS site roster formats and default salary caps."""

from __future__ import annotations

SITE_CONFIGS: dict[str, dict] = {
    "seasonal": {
        "label": "Season-long PPR",
        "description": "1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX — no salary cap",
        "roster": {"qb": 1, "rb": 2, "wr": 2, "te": 1, "flex": 1, "dst": 0},
        "salary_cap": None,
        "flex_positions": ("RB", "WR", "TE"),
    },
    "draftkings": {
        "label": "DraftKings Classic",
        "description": "9-player NFL classic slate (QB · 2 RB · 3 WR · TE · FLEX · DST)",
        "roster": {"qb": 1, "rb": 2, "wr": 3, "te": 1, "flex": 1, "dst": 1},
        "salary_cap": 50_000,
        "flex_positions": ("RB", "WR", "TE"),
    },
    "fanduel": {
        "label": "FanDuel Classic",
        "description": "9-player NFL classic slate (QB · 2 RB · 3 WR · TE · FLEX · DST)",
        "roster": {"qb": 1, "rb": 2, "wr": 3, "te": 1, "flex": 1, "dst": 1},
        "salary_cap": 60_000,
        "flex_positions": ("RB", "WR", "TE"),
    },
}


def get_site_config(site: str) -> dict:
    key = (site or "seasonal").lower()
    if key not in SITE_CONFIGS:
        raise ValueError(f"Unknown lineup format: {site}. Use seasonal, draftkings, or fanduel.")
    return SITE_CONFIGS[key]


def list_site_configs() -> dict[str, dict]:
    return {
        key: {
            "id": key,
            "label": cfg["label"],
            "description": cfg["description"],
            "roster": cfg["roster"],
            "salary_cap": cfg["salary_cap"],
        }
        for key, cfg in SITE_CONFIGS.items()
    }
