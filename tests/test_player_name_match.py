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


def test_roster_name_key_strips_generational_suffix():
    from src.draft_hub.player_name_match import roster_name_key

    assert roster_name_key("Kenneth Walker III") == roster_name_key("Kenneth Walker")
    assert roster_name_key("Velus Jones Jr.") == roster_name_key("Velus Jones")
    assert roster_name_key("Chris Rodriguez Jr.") == roster_name_key("Chris Rodriguez")
    assert roster_name_key("Theo Wease Jr.") == "theowease"


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

def test_bounded_name_distance_preserves_every_matching_threshold():
    from itertools import product
    from src.draft_hub.player_name_match import _edit_distance
    def reference(a, b):
        previous = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            current = [i]
            for j, cb in enumerate(b, 1):
                current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
            previous = current
        return previous[-1]
    names = [''.join(chars) for n in range(1, 5) for chars in product('ab', repeat=n)]
    names += ['ekeler', 'eckler', 'jefferson', 'jackson', 'robinson', 'robson', 'smith', 'smyth']
    for a in names:
        for b in names:
            assert min(_edit_distance(a, b), 3) == min(reference(a, b), 3), (a, b)
