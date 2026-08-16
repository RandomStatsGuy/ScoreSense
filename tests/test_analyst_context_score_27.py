"""SCORE-27 template-first analyst context + budget gates."""

from src.sentiment.analyst_context import (
    budget_allows_call,
    compute_evidence_hash,
    evidence_cache_key,
    record_llm_spend,
    reset_run_budget,
    should_async_llm,
    template_analyst_summary,
)
from src.draft_hub.draft_enrichment import beat_digest_single


def test_template_analyst_summary_role_up():
    text = template_analyst_summary(
        sentiment_label="hype",
        role_hype_flag=1.0,
        mention_count=3,
        source_labels=["Late Round", "Establish The Run", "Fantasy Footballers"],
        top_sentence="increased target share in the offense",
    )
    assert "Role trending up" in text
    assert "3 fantasy shows" in text
    assert "Late Round" in text
    assert "increased target share" in text.lower()


def test_evidence_hash_stable_and_sensitive():
    a = compute_evidence_hash(
        top_sentence="targets up",
        sentiment_label="hype",
        role_hype_flag=1.0,
        mention_count=2,
        source_labels=["A", "B"],
    )
    b = compute_evidence_hash(
        top_sentence="targets up",
        sentiment_label="hype",
        role_hype_flag=1.0,
        mention_count=2,
        source_labels=["B", "A"],
    )
    c = compute_evidence_hash(
        top_sentence="targets down",
        sentiment_label="hype",
        role_hype_flag=1.0,
        mention_count=2,
        source_labels=["A", "B"],
    )
    assert a == b
    assert a != c


def test_evidence_cache_key_includes_week_and_hash():
    k1 = evidence_cache_key(
        player_id="p1",
        player_name="A",
        season=2026,
        week=1,
        evidence_hash="abc",
        scope="fantasy|weekly",
    )
    k2 = evidence_cache_key(
        player_id="p1",
        player_name="A",
        season=2026,
        week=2,
        evidence_hash="abc",
        scope="fantasy|weekly",
    )
    k3 = evidence_cache_key(
        player_id="p1",
        player_name="A",
        season=2026,
        week=1,
        evidence_hash="xyz",
        scope="fantasy|weekly",
    )
    assert k1 != k2
    assert k1 != k3


def test_should_async_llm_disagreement_and_flags(monkeypatch):
    monkeypatch.setattr("src.sentiment.analyst_context.BEAT_DIGEST_LLM_ENABLED", True)
    monkeypatch.setattr("src.sentiment.analyst_context.OPENAI_API_KEY", "sk-test")

    assert should_async_llm(
        sentiment_label="mixed",
        source_labels=["A", "B"],
        mention_count=2,
    )
    assert should_async_llm(
        injury_flag=1.0,
        role_hype_flag=1.0,
        sentiment_label="caution",
    )
    assert not should_async_llm(
        sentiment_label="neutral",
        mention_count=1,
        source_labels=["A"],
        rank=100,
        top_n=40,
    )


def test_budget_hard_limits(monkeypatch, tmp_path):
    import src.sentiment.analyst_context as ac

    monkeypatch.setattr(ac, "_BUDGET_DIR", tmp_path)
    monkeypatch.setattr(ac, "BEAT_DIGEST_LLM_DAILY_BUDGET_USD", 0.001)
    monkeypatch.setattr(ac, "BEAT_DIGEST_LLM_PER_RUN_BUDGET_USD", 1.0)
    monkeypatch.setattr(ac, "BEAT_DIGEST_LLM_EST_COST_PER_CALL_USD", 0.0004)
    reset_run_budget()
    assert budget_allows_call()
    record_llm_spend(cost_usd=0.0004)
    assert budget_allows_call()
    record_llm_spend(cost_usd=0.0004)
    # Daily budget 0.001 — third 0.0004 call would exceed
    assert not budget_allows_call()


def test_beat_digest_single_never_calls_llm(monkeypatch):
    called = {"llm": False}

    def _fake_digest(*args, **kwargs):
        if kwargs.get("prefer_llm"):
            called["llm"] = True
        return {
            "fantasy_digest": "Role trending up — discussed by 2 fantasy shows this week.",
            "fantasy_digest_source": "template",
        }

    monkeypatch.setattr(
        "src.draft_hub.draft_enrichment.build_fantasy_index",
        lambda *a, **k: {
            "season": 2026,
            "week": 1,
            "players": {
                "p1": {
                    "player": "Test Player",
                    "sentiment_label": "hype",
                    "role_hype_flag": 1,
                    "mention_count": 2,
                    "sources": [{"label": "Late Round"}],
                }
            },
        },
    )
    monkeypatch.setattr(
        "src.draft_hub.draft_enrichment._resolve_draft_week",
        lambda *a, **k: (2026, 1),
    )
    monkeypatch.setattr(
        "src.draft_hub.draft_enrichment.fantasy_digest_for_player",
        _fake_digest,
    )
    out = beat_digest_single("p1", player_name="Test Player", season=2026, week=1)
    assert out["beat_digest"]
    assert called["llm"] is False


def test_snippet_to_brief_caps_length():
    from src.sentiment.beat_digest import snippet_to_brief

    long = "word " * 500
    brief = snippet_to_brief(long, "Player")
    assert len(brief) <= 800
