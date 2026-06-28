"""Tests for sentiment display helpers."""

from src.sentiment.display import sentiment_label, sentiment_label_text, sentiment_summary


def test_sentiment_label_bullish():
    assert sentiment_label(0.35) == "bullish"
    assert sentiment_label_text("bullish") == "Bullish"


def test_sentiment_label_caution():
    assert sentiment_label(-0.2, injury_flag=1.0) == "caution"


def test_sentiment_summary():
    text = sentiment_summary(
        label="bullish",
        mention_count=3,
        source_labels=["Locked On Raiders", "Fantasy Points"],
    )
    assert "Bullish" in text
    assert "3 mentions" in text
