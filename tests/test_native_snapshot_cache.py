import json
from concurrent.futures import ThreadPoolExecutor

from src.draft_hub import native_stats


def test_snapshot_cache_is_shared_but_returned_data_is_isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path)
    native_stats.clear_native_stats_cache()
    path = native_stats._path(2026, 5)
    path.write_text(json.dumps({"season": 2026, "week": 5, "stats": {"p": {"yards": 10}},
                               "schedule_coverage_version": native_stats.SCHEDULE_COVERAGE_VERSION}), encoding="utf-8")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: native_stats.cached_week_snapshot(2026, 5), range(20)))
    assert native_stats._read_snapshot.cache_info().misses == 1
    results[0]["stats"]["p"]["yards"] = 999
    assert native_stats.cached_week_snapshot(2026, 5)["stats"]["p"]["yards"] == 10
    # A different worker atomically publishes another snapshot.
    replacement = tmp_path / "new.json"
    replacement.write_text(path.read_text().replace('10', '20'), encoding="utf-8")
    replacement.replace(path)
    assert native_stats.cached_week_snapshot(2026, 5)["stats"]["p"]["yards"] == 20
    assert native_stats._read_snapshot.cache_info().misses == 2
    state = native_stats.cached_week_snapshot(2026, 5, native_stats.GAME_STATE_FIELDS)
    assert "stats" not in state
    assert native_stats.cached_week_snapshot(2026, 6) is None


def test_legacy_coverage_and_wrong_context_remain_untrusted(tmp_path, monkeypatch):
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path)
    native_stats.clear_native_stats_cache()
    path = native_stats._path(2026, 5)
    path.write_text(json.dumps({"season": 2026, "week": 5, "complete": True, "schedule_complete": True}), encoding="utf-8")
    result = native_stats.cached_week_snapshot(2026, 5)
    assert result["complete"] is False and result["schedule_complete"] is False
    path.write_text(json.dumps({"season": 2025, "week": 5}), encoding="utf-8")
    assert native_stats.cached_week_snapshot(2026, 5) is None
    path.write_text("[]", encoding="utf-8")
    assert native_stats.cached_week_snapshot(2026, 5) is None


def test_scoring_metrics_separate_hit_and_refresh(monkeypatch):
    from src.ops import scoring_stats
    monkeypatch.setattr(scoring_stats, "_ROWS", {})

    @scoring_stats.profile_scoring("sleeper.assembly", cache_result=True)
    def scoring(cached):
        return {"available": True, "cached": cached}

    scoring(True)
    scoring(False)
    rows = {row["operation"]: row for row in scoring_stats.snapshot()["operations"]}
    assert rows["sleeper.assembly.hit"]["count"] == 1
    assert rows["sleeper.assembly.refresh"]["count"] == 1


def test_scoring_percentiles_use_bounded_recent_samples(monkeypatch):
    from src.ops import scoring_stats
    monkeypatch.setattr(scoring_stats, "_ROWS", {})
    for milliseconds in range(205):
        scoring_stats.record("native.assembly", milliseconds / 1000)
    row, = scoring_stats.snapshot()["operations"]
    assert row["count"] == 205 and row["sample_count"] == 200
    assert row["total_ms"] == 20910
    assert row["p50_ms"] == 104 and row["p95_ms"] == 194
