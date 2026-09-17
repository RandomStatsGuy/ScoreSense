"""Surfaces that must not talk about money in a league that has none."""

from __future__ import annotations

from src.draft_hub.insight_awards import (
    MONEY_AWARDS,
    award_ids_for_rules,
    drop_money_awards,
    is_money_award,
)
from src.draft_hub.league_resize import _phase_blocker

SNAKE = {"draft_type": "snake", "salary_cap": 0}
AUCTION = {"draft_type": "auction", "salary_cap": 200}


def test_money_awards_are_dropped_for_a_pick_draft_league():
    awards = [{"id": "highest_paid"}, {"id": "cap_hog"}, {"id": "points_king"}]

    kept = [row["id"] for row in drop_money_awards(awards, SNAKE)]

    assert kept == ["points_king"]


def test_auction_leagues_keep_every_award():
    awards = [{"id": "highest_paid"}, {"id": "cap_hog"}, {"id": "points_king"}]

    assert len(drop_money_awards(awards, AUCTION)) == 3


def test_tenure_awards_survive_despite_their_spend_group():
    """nomad and loyalty count teams and tenure — AWARD_GROUPS is the wrong axis."""
    assert is_money_award("nomad") is False
    assert is_money_award("loyalty") is False
    assert is_money_award("cap_efficiency_goat") is True

    kept = [row["id"] for row in drop_money_awards([{"id": "nomad"}, {"id": "loyalty"}], SNAKE)]
    assert kept == ["nomad", "loyalty"]


def test_award_catalog_shrinks_without_money():
    assert set(award_ids_for_rules(SNAKE)).isdisjoint(MONEY_AWARDS)
    assert len(award_ids_for_rules(SNAKE)) < len(award_ids_for_rules(AUCTION))


def test_resize_blocker_names_the_draft_not_an_auction():
    snake = {"rules": SNAKE, "draft_completed": True, "status": "setup"}
    auction = {"rules": AUCTION, "draft_completed": True, "status": "setup"}

    assert "next draft." in _phase_blocker(snake, None)
    assert "auction" not in _phase_blocker(snake, None)
    assert "next auction." in _phase_blocker(auction, None)


def test_live_blocker_names_the_draft_not_an_auction():
    snake = {"rules": SNAKE, "status": "live"}
    auction = {"rules": AUCTION, "status": "live"}

    assert _phase_blocker(snake, None).startswith("The draft is live")
    assert _phase_blocker(auction, None).startswith("The auction is live")
