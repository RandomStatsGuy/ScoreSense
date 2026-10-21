"""Projection meta flags align with dashboard season-mode defaults."""

from src.projections.projection_meta import get_projection_meta


def test_current_season_is_live_even_with_next_season_option(monkeypatch, tmp_path):
    import pandas as pd
    from src.projections import projection_meta as meta_mod

    pd.DataFrame({"season": [2026, 2026], "week": [5, 6], "team": ["KC", "BUF"]}).to_parquet(
        tmp_path / "qb_mlready.parquet", index=False,
    )
    monkeypatch.setattr(meta_mod, "upcoming_season", lambda season: 2027)
    monkeypatch.setattr(meta_mod, "is_nfl_offseason", lambda: False)
    monkeypatch.setattr(meta_mod, "nfl_calendar_season", lambda: 2026)
    monkeypatch.setattr(meta_mod, "resolve_projection_context", lambda frame: (2026, 7))
    schedule_calls = []
    def current_schedule(season):
        schedule_calls.append(season)
        assert season == 2026
        return list(range(1, 19))
    monkeypatch.setattr(meta_mod, "regular_season_weeks", current_schedule)
    meta_mod._META_CACHE.clear()

    meta = get_projection_meta("qb", data_dir=tmp_path)

    assert meta["preseason_mode"] is False
    assert meta["default_season"] == 2026
    assert meta["default_week"] == 7
    assert meta["seasons"] == [2026, 2027]
    assert meta["weeks_by_season"]["2026"] == list(range(1, 19))
    assert meta["weeks_by_season"]["2027"] == list(range(1, 19))
    assert schedule_calls == [2026]


def test_missing_current_season_remains_preseason(monkeypatch, tmp_path):
    import pandas as pd
    from src.projections import projection_meta as meta_mod

    pd.DataFrame({"season": [2025], "week": [18], "team": ["KC"]}).to_parquet(
        tmp_path / "qb_mlready.parquet", index=False,
    )
    monkeypatch.setattr(meta_mod, "upcoming_season", lambda season: 2026)
    monkeypatch.setattr(meta_mod, "is_nfl_offseason", lambda: False)
    monkeypatch.setattr(meta_mod, "nfl_calendar_season", lambda: 2026)
    monkeypatch.setattr(meta_mod, "resolve_projection_context", lambda frame: (2026, 1))
    monkeypatch.setattr(meta_mod, "regular_season_weeks", lambda season: list(range(1, 19)))
    meta_mod._META_CACHE.clear()

    meta = get_projection_meta("qb", data_dir=tmp_path)

    assert meta["preseason_mode"] is True
    assert meta["default_season"] == 2026
    assert meta["weeks_by_season"]["2026"] == list(range(1, 19))


def test_projection_meta_offseason_flags(monkeypatch, tmp_path):
    import pandas as pd
    from src.projections import projection_meta as meta_mod

    pd.DataFrame({"season": [2025], "week": [18], "team": ["KC"]}).to_parquet(
        tmp_path / "qb_mlready.parquet", index=False,
    )
    monkeypatch.setattr(meta_mod, "regular_season_weeks", lambda season: list(range(1, 19)))
    monkeypatch.setattr(
        "src.core.projection_context.get_nfl_state",
        lambda: {"season": 2026, "season_type": "off", "week": 1},
    )
    meta_mod._META_CACHE.clear()
    meta = get_projection_meta("qb", data_dir=tmp_path)
    assert meta["default_season"] >= 2025
    assert meta["is_offseason"] is True
    assert meta["preseason_mode"] is True
