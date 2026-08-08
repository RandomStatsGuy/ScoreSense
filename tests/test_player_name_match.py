"""Player name normalization and fuzzy matching."""

from src.draft_hub.player_name_match import (
    is_garbage_player_name,
    names_likely_same,
    pick_canonical_name,
)


def test_garbage_pdf_chunks():
    assert is_garbage_player_name("A Kamara49 D Montgom.29 D Cook45 C McCaffrey")
    assert is_garbage_player_name("J Taylor42 N Harris50 R Mostert9 A Ekeler29 N Chubb44 D Henry")
    assert not is_garbage_player_name("A. Ekeler")
    assert not is_garbage_player_name("A. Eckler")


def test_last_name_key_strips_jr():
    from src.draft_hub.player_name_match import last_name_key

    assert last_name_key("Penix Jr") == "penix"
    assert last_name_key("Michael Penix Jr.") == "penix"
    assert last_name_key("M. Penix") == "penix"
    assert names_likely_same("M. Penix", "Michael Penix Jr.", position="QB", pos_b="QB")


def test_names_likely_same_typo():
    assert names_likely_same("A. Eckler", "A. Ekeler", position="RB", pos_b="RB")
    assert not names_likely_same("A. Eckler", "A. Ekeler", position="RB", pos_b="WR")


def test_pick_canonical_name():
    assert pick_canonical_name(["A. Eckler", "A. Ekeler"]) == "A. Ekeler"
