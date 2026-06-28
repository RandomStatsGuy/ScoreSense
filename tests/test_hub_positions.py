from src.draft_hub.rules_engine import normalize_position


def test_normalize_position_k_def():
    assert normalize_position("k") == "K"
    assert normalize_position("DEF") == "DEF"
    assert normalize_position("DST") == "DEF"
    assert normalize_position("D/ST") == "DEF"


def test_k_def_enabled_in_roster_limits():
    from src.draft_hub.rules_engine import roster_limits
    from src.draft_hub.schemas import LeagueRules

    rules = LeagueRules.model_validate(
        {
            "salary_cap": 200,
            "roster": {
                "qb": {"min": 1, "max": 2},
                "k": {"min": 0, "max": 1},
                "def": {"min": 0, "max": 1},
            },
        }
    )
    limits = roster_limits(rules)
    assert "k" in limits
    assert "def" in limits
