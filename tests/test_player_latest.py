"""This-week notes prefer locker-room facts over YouTube scraps."""

from src.draft_hub.player_latest import (
    compose_latest,
    compose_projection_line,
    compose_this_week,
    is_useful_sentence,
    strip_youtube_from_this_week,
)


def test_locker_notes_beat_a_chapter_title_digest():
    latest = compose_latest(
        sleeper={
            "injury_status": "Questionable",
            "injury_notes": "Limited Wednesday with a hip. Expected to practice Friday.",
            "injury_body_part": "Hip",
        },
        context={
            "media_context": {
                "summary": "0:42 sources flag mentioned on the pod",
                "excerpt": "Chapter 3 — Week 1 mailbag",
            },
            "projection": {"injury_delta": -1.4},
        },
    )
    assert latest["kind"] == "locker"
    assert "hip" in latest["detail"].lower()
    assert latest["source"] == "Locker room"
    assert latest["projection_line"] == "Week is 1.4 below the healthy slate."


def test_youtube_scraps_do_not_count_as_news():
    latest = compose_latest(
        sleeper={},
        context={"media_context": {"summary": "mentioned", "excerpt": "1:12 intro"}},
    )
    assert latest["kind"] == "none"
    assert latest["headline"] is None
    assert latest["projection_line"] is None


def test_extractive_show_recap_is_not_this_week():
    latest = compose_this_week(
        media_context={
            "summary": "Fantasy shows are flagging health on Pickens this week, with analyst talk focused on usage."
        },
        allow_research_snippet=True,
    )
    assert latest["kind"] == "none"


def test_real_digest_sentence_is_kept_when_locker_is_quiet():
    latest = compose_latest(
        sleeper={},
        context={
            "media_context": {
                "summary": "Higgins is the clear WR1 this week after the Tee Higgins rest rumor cooled off Friday."
            }
        },
    )
    assert latest["kind"] == "digest"
    assert "Higgins" in latest["detail"]


def test_this_week_does_not_use_research_snippet_by_default():
    note = compose_this_week(
        media_context={
            "excerpt": "Higgins is the clear WR1 this week after the Tee Higgins rest rumor cooled off Friday."
        },
        projection={"injury_delta": 2.1},
        allow_research_snippet=False,
    )
    assert note["kind"] == "none"
    assert note["projection_line"] == "Week is 2.1 above the healthy slate."


def test_useful_sentence_rejects_timestamps_and_show_copy():
    assert is_useful_sentence("Higgins is the clear WR1 this week after Chase sat Friday.")
    assert not is_useful_sentence("0:42 sources flag mentioned")
    assert not is_useful_sentence("A quiet week in fantasy channels for Pickens.")


def test_strip_youtube_clears_current_week_bodies():
    cleaned = strip_youtube_from_this_week(
        {
            "state": "current",
            "signal": "role_up",
            "summary": "Role trending up — discussed by 2 fantasy shows.",
            "excerpt": "Higgins sees elevated targets",
            "sources": [{"label": "Fantasy Footballers"}],
            "affects_projection": False,
        }
    )
    assert cleaned["summary"] is None
    assert cleaned["excerpt"] is None
    assert cleaned["sources"] == []
    assert cleaned["signal"] == "role_up"


def test_projection_line_skips_noise():
    assert compose_projection_line(0) is None
    assert compose_projection_line(None) is None
    assert compose_projection_line(2.1) == "Week is 2.1 above the healthy slate."
