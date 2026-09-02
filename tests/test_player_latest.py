"""Latest-note composer prefers locker-room facts over YouTube scraps."""

from src.draft_hub.player_latest import compose_latest


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
            }
        },
    )
    assert latest["kind"] == "locker"
    assert "hip" in latest["detail"].lower()
    assert latest["source"] == "Locker room"


def test_youtube_scraps_do_not_count_as_news():
    latest = compose_latest(
        sleeper={},
        context={"media_context": {"summary": "mentioned", "excerpt": "1:12 intro"}},
    )
    assert latest["kind"] == "none"
    assert latest["headline"] is None


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
