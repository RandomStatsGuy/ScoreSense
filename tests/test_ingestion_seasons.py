"""Runtime ingestion advances without changing model evaluation year splits."""
from datetime import datetime, timezone
import json

import pytest

from src.etl import season_selection as selection


@pytest.mark.parametrize("now,expected", [(datetime(2027, 1, 15), 2026), (datetime(2027, 2, 28), 2026),
                                           (datetime(2027, 3, 1), 2027), (datetime(2027, 10, 22), 2027)])
def test_calendar_failure_uses_nfl_season_boundary_and_keeps_intervening_years(now, expected):
    def unavailable():
        raise OSError("provider unavailable")
    assert selection.default_ingestion_seasons(now=now, state_loader=unavailable,
                                               configured_seasons=[2018, 2024, 2025]) == list(range(2018, expected + 1))


@pytest.mark.parametrize("state", [{"season": "2027"}, {"league_season": "2027"}, {"season": "bad", "league_season": "2027"},
                                    {"season": "2025"}, {"season": "2099"}, {"season": None}, {}])
def test_provider_state_cannot_truncate_or_extend_beyond_current_calendar_year(state):
    result = selection.default_ingestion_seasons(now=datetime(2027, 10, 22, tzinfo=timezone.utc),
        state_loader=lambda: state, configured_seasons=[2018, 2025])
    assert result == list(range(2018, 2028))


def test_job_calendar_reads_existing_cache_without_provider_request(tmp_path, monkeypatch):
    from src.integrations import sleeper
    cache = tmp_path / "sleeper_nfl_state.json"
    cache.write_text(json.dumps({"season": "2026", "season_type": "regular"}))
    monkeypatch.setattr(sleeper, "STATE_CACHE", cache)
    monkeypatch.setattr(sleeper, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(sleeper, "_fetch_json", lambda *_: pytest.fail("fresh cached state must not fetch"))
    monkeypatch.setattr(sleeper, "anonymous_projection_read", lambda: False)
    assert selection.default_ingestion_seasons(now=datetime(2026, 10, 22), configured_seasons=[2025]) == [2025, 2026]


def test_training_and_evaluation_constants_are_unchanged():
    train, test = list(selection.DEFAULT_TRAIN_SEASONS), list(selection.DEFAULT_TEST_SEASONS)
    result = selection.default_ingestion_seasons(now=datetime(2027, 10, 22), state_loader=lambda: {})
    assert result[-2:] == [2026, 2027]
    assert selection.DEFAULT_TRAIN_SEASONS == train
    assert selection.DEFAULT_TEST_SEASONS == test


@pytest.mark.parametrize("explicit", [[2024], [2021, 2023]])
def test_historical_etl_override_bypasses_runtime_default(explicit, tmp_path, monkeypatch):
    from src.etl import nflverse_etl as etl
    def stop_after_selection(seasons):
        assert seasons == explicit
        raise RuntimeError("selected explicit seasons")
    monkeypatch.setattr(etl, "default_ingestion_seasons", lambda: pytest.fail("explicit historical override must not resolve runtime"))
    monkeypatch.setattr(etl, "load_weekly_player_stats", stop_after_selection)
    with pytest.raises(RuntimeError, match="selected explicit"):
        etl.build_all_datasets(seasons=explicit, output_dir=tmp_path, enrich_analytics=False)


def test_etl_omitted_seasons_use_runtime_default(tmp_path, monkeypatch):
    from src.etl import nflverse_etl as etl
    monkeypatch.setattr(etl, "default_ingestion_seasons", lambda: [2025, 2026, 2027])
    def stop_after_selection(seasons):
        assert seasons == [2025, 2026, 2027]
        raise RuntimeError("selected current seasons")
    monkeypatch.setattr(etl, "load_weekly_player_stats", stop_after_selection)
    with pytest.raises(RuntimeError, match="selected current"):
        etl.build_all_datasets(output_dir=tmp_path, enrich_analytics=False)


@pytest.mark.parametrize("arguments,expected", [([], None), (["--seasons", "2024"], [2024])])
def test_cli_defers_omitted_seasons_and_preserves_explicit_override(arguments, expected, monkeypatch):
    import sys
    from src.etl import nflverse_etl as etl
    calls = []
    monkeypatch.setattr(sys, "argv", ["nflverse_etl", *arguments])
    monkeypatch.setattr(etl, "build_all_datasets", lambda **kwargs: calls.append(kwargs))
    etl.main()
    assert calls[0]["seasons"] == expected


@pytest.mark.parametrize("explicit,expected", [(None, [2025, 2026, 2027]), ([2024], [2024])])
def test_preseason_refresh_does_not_restore_frozen_ingestion_default(explicit, expected, monkeypatch):
    from src.jobs import preseason_refresh as preseason
    monkeypatch.setattr(preseason, "default_ingestion_seasons", lambda: [2025, 2026, 2027])
    def stop_after_selection(*, seasons):
        assert seasons == expected
        raise RuntimeError("preseason selected seasons")
    monkeypatch.setattr(preseason, "build_all_datasets", stop_after_selection)
    with pytest.raises(RuntimeError, match="preseason selected"):
        preseason.run_preseason_refresh(seasons=explicit)
