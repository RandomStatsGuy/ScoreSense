"""Tests for beat writer registry."""

from src.sentiment.beat_writers import beat_writer_for_team, load_beat_writers


def test_load_all_beat_writers():
    writers = load_beat_writers()
    assert len(writers) == 32
    teams = {w.team for w in writers}
    assert "KC" in teams
    assert "NO" in teams


def test_beat_writer_kc():
    writer = beat_writer_for_team("KC")
    assert writer is not None
    assert writer.primary.name == "Nate Taylor"
    assert "Arrowhead Pride" in writer.primary.outlet
    assert writer.display_line == "Nate Taylor (Arrowhead Pride)"


def test_beat_writer_bal():
    writer = beat_writer_for_team("BAL")
    assert writer is not None
    assert writer.primary.name == "Jeff Zrebiec"
    assert len(writer.also) == 0
