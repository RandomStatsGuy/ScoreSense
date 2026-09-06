from src.draft_hub.bot_persona import (
    BOT_NAMES,
    display_bot_name,
    persona_jump,
    resolve_bot_persona,
)


def test_nato_aliases_resolve_to_named_personas():
    whale = resolve_bot_persona({"name": "Bot Bravo", "is_bot": True})
    assert whale["name"] == "Whale"
    assert whale["min_jump"] == 10
    assert display_bot_name({"name": "Bot Alpha", "is_bot": True}) == "The Auditor"
    assert "Bot Alpha" not in BOT_NAMES
    assert "The Auditor" in BOT_NAMES


def test_whale_jumps_at_least_ten():
    bid = persona_jump(
        resolve_bot_persona({"name": "Whale", "is_bot": True}),
        high=1,
        ceiling=40,
        step=1,
    )
    assert bid >= 11


def test_copier_only_raises_the_minimum():
    bid = persona_jump(
        resolve_bot_persona({"name": "The Copier", "is_bot": True}),
        high=5,
        ceiling=40,
        step=1,
    )
    assert bid == 6
