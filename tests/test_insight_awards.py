"""Commissioner-customizable Insights award titles."""

from src.draft_hub.insight_awards import (
    DEFAULT_AWARD_TITLES,
    apply_award_titles,
    award_catalog,
    award_title,
)


def test_default_titles_are_factual():
    banned = ("bag", "donated", "$$$", "touch if", "kitch", "roast")
    for title in DEFAULT_AWARD_TITLES.values():
        lowered = title.lower()
        assert not any(bit in lowered for bit in banned)
        assert title == title.strip()
        assert len(title) <= 48
    assert award_title("highest_paid") == "Highest salary"
    assert award_title("points_king") == "Most points"


def test_apply_award_titles_overrides_and_strips_roast():
    awards = [
        {
            "id": "highest_paid",
            "title": "Bag Chaser",
            "roast": "You paid what?",
            "headline": "$80 cap hit",
        }
    ]
    out = apply_award_titles(awards, {"highest_paid": "Top dollar"})
    assert out[0]["title"] == "Top dollar"
    assert out[0]["title_custom"] is True
    assert out[0]["roast"] is None
    assert out[0]["headline"] == "$80 cap hit"


def test_apply_award_titles_restores_defaults_without_custom():
    awards = [{"id": "cap_hog", "title": "Hog", "roast": "oink"}]
    out = apply_award_titles(awards)
    assert out[0]["title"] == "Largest cap share"
    assert out[0]["roast"] is None


def test_award_catalog_uses_overrides():
    catalog = award_catalog({"points_king": "Scoring champ"})
    king = next(row for row in catalog if row["id"] == "points_king")
    assert king["default_title"] == "Most points"
    assert king["title"] == "Scoring champ"
    assert king["group"] == "scoring"
