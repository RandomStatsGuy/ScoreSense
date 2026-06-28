"""Tests for sentiment NLP extraction."""

from src.sentiment.extract import extract_mentions, score_sentiment


def test_injury_keywords_flagged():
    text = "Aidan O'Connell was limited in practice with a hamstring concern."
    mentions = extract_mentions(text, ["Aidan O'Connell"])
    assert len(mentions) == 1
    assert mentions[0].injury_flag is True


def test_role_hype_keywords_flagged():
    text = "Davante Adams is the red zone workhorse and featured heavily."
    mentions = extract_mentions(text, ["Davante Adams"])
    assert len(mentions) == 1
    assert mentions[0].role_hype_flag is True


def test_score_sentiment_positive():
    score = score_sentiment("Coaches love his explosive upside and impressive growth.")
    assert score > 0
