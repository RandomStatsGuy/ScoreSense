"""Exact-week, ambiguity and outage regressions for cached consensus inputs."""

import pandas as pd
import pytest

from src.integrations import fantasypros as fp
from src.integrations import fantasypros_enrich as enrich


def rows():
    return pd.DataFrame({"player_display_name": ["Josh Allen", "Same Name"], "team": ["BUF", "LV"],
                         "season": [2026]*2, "week": [4]*2, "fp_consensus_ppr": [17., 8.], "fp_ecr": [3., 7.]}, index=[5, 1])


def source():
    return pd.DataFrame({"name_key": ["josh allen", "same name", "same name"], "team": ["BUF", "KC", "NO"],
                         "season": [2026]*3, "week": [4]*3, "fp_consensus_ppr": [23., 12., 6.], "fp_ecr": [1., 5., 10.]})


def test_retry_is_idempotent_and_outage_preserves_training_observations(tmp_path, monkeypatch):
    path = tmp_path / "qb_mlready.parquet"
    rows().to_parquet(path, index=False)
    monkeypatch.setattr(enrich, "build_fp_enrichment_frame", lambda *a, **kw: source())
    first = enrich.enrich_position_mlready("qb", [2026], tmp_path)
    second = enrich.enrich_position_mlready("qb", [2026], tmp_path)
    pd.testing.assert_frame_equal(first, second)
    assert first.iloc[0].fp_consensus_ppr == 23.
    assert first.iloc[1].fp_consensus_ppr == 8.  # ambiguous fallback retains known observation
    monkeypatch.setattr(enrich, "build_fp_enrichment_frame", lambda *a, **kw: pd.DataFrame())
    pd.testing.assert_frame_equal(first, enrich.enrich_position_mlready("qb", [2026], tmp_path))


def test_inference_clears_prior_week_consensus_and_ambiguous_fallback(monkeypatch):
    calls = []
    def load(season, position, **kwargs):
        calls.append((season, position, list(kwargs["weeks"]), kwargs["cache_only"]))
        return source()
    monkeypatch.setattr(enrich, "build_fp_enrichment_frame", load)
    out = enrich.attach_target_week_consensus(rows(), "qb")
    assert list(out.index) == [5, 1]
    assert out.iloc[0].fp_consensus_ppr == 23.
    assert pd.isna(out.iloc[1].fp_consensus_ppr)
    assert calls == [(2026, "qb", [4], True)]
    wrong_week = source().assign(week=3)
    assert enrich.join_fp_frame(rows(), wrong_week, preserve_existing=False).fp_consensus_ppr.isna().all()


def test_consensus_team_aliases_and_unique_name_only_match():
    target = rows().iloc[[0]].assign(team="JAX")
    cached = source().iloc[[0]].assign(team="JAC")
    assert enrich.join_fp_frame(target, cached, preserve_existing=False).iloc[0].fp_consensus_ppr == 23.
    target = target.assign(team="UNKNOWN")
    assert enrich.join_fp_frame(target, cached, preserve_existing=False).iloc[0].fp_consensus_ppr == 23.


def test_failed_consensus_publication_keeps_last_good_file(tmp_path, monkeypatch):
    path = tmp_path / "qb_mlready.parquet"
    rows().to_parquet(path, index=False)
    original = path.read_bytes()
    monkeypatch.setattr(enrich, "build_fp_enrichment_frame", lambda *a, **kw: source())
    def broken(frame, path, **kwargs):
        path.write_bytes(b"partial")
        raise OSError("disk full")
    monkeypatch.setattr(pd.DataFrame, "to_parquet", broken)
    with pytest.raises(OSError, match="disk full"):
        enrich.enrich_position_mlready("qb", [2026], tmp_path)
    assert path.read_bytes() == original
    assert not list(tmp_path.glob("*.tmp"))


def test_half_ppr_is_not_used_as_full_ppr():
    assert fp._extract_points_ppr({"points_half": 16.8}) is None
    assert fp._extract_points_ppr({"points_ppr": 20.3, "points_half": 16.8}) == 20.3


def test_week_cache_records_capture_time_and_invalidates_forecast_artifacts(tmp_path, monkeypatch):
    from src.projections import input_policy
    monkeypatch.setattr(fp, "FP_CACHE_DIR", tmp_path / "fantasypros")
    fp.FP_CACHE_DIR.mkdir()
    monkeypatch.setattr(input_policy, "CACHE_DIR", tmp_path)
    before = input_policy.projection_input_revisions()
    saved = fp._write_week_cache(source(), fp.FP_CACHE_DIR / "2026_week04_proj.parquet")
    assert saved.fp_scoring.eq("PPR").all()
    assert saved.fp_fetched_at_utc.notna().all()
    assert input_policy.projection_input_revisions() != before
    assert not list(fp.FP_CACHE_DIR.glob("*.tmp"))


def test_empty_or_missing_value_week_cache_is_retried_and_good_capture_survives(tmp_path, monkeypatch):
    monkeypatch.setattr(fp, "FP_CACHE_DIR", tmp_path)
    monkeypatch.setattr(fp, "REQUEST_SLEEP_SEC", 0)
    path = tmp_path / "2026_week04_proj.parquet"
    pd.DataFrame({"fantasypros_proj": [float("nan")]}).to_parquet(path)
    payload = {"players": [{"fpid": 1, "name": "Josh Allen", "team_id": "BUF",
                            "position_id": "QB", "stats": {"points_ppr": 23.}}]}
    calls = []
    monkeypatch.setattr(fp, "_fp_get", lambda *a: calls.append(a) or payload)
    saved = fp.fetch_fp_weekly_projections(2026, 4)
    assert len(calls) == 1 and saved.iloc[0].fantasypros_proj == 23.
    original = path.read_bytes()
    revision = (tmp_path / "revision.txt").read_bytes()
    monkeypatch.setattr(fp, "_fp_get", lambda *a: {"players": []})
    retained = fp.fetch_fp_weekly_projections(2026, 4, force_refresh=True)
    pd.testing.assert_frame_equal(retained, saved)
    assert path.read_bytes() == original
    assert (tmp_path / "revision.txt").read_bytes() == revision
    empty = fp.fetch_fp_weekly_projections(2026, 5)
    assert empty.empty and not (tmp_path / "2026_week05_proj.parquet").exists()


def test_enrichment_retains_rankings_when_projection_source_is_partial(monkeypatch):
    proj = pd.DataFrame({"season": [2026], "week": [4], "name_key": ["josh allen"],
        "team": ["BUF"], "fantasypros_proj": [23.], "fp_position": ["QB"]})
    rank = pd.DataFrame({"season": [2026]*2, "week": [4]*2, "name_key": ["josh allen", "lamar jackson"],
        "team": ["BUF", "BAL"], "fp_ecr": [1., 2.], "fp_position": ["QB"]*2})
    monkeypatch.setattr(fp, "load_fp_season_projections", lambda *a, **kw: proj)
    monkeypatch.setattr(fp, "load_fp_season_rankings", lambda *a, **kw: rank)
    out = fp.build_fp_enrichment_frame(2026, "qb", weeks=range(4, 5)).set_index("name_key")
    assert out.loc["lamar jackson", "fp_ecr"] == 2.
    assert pd.isna(out.loc["lamar jackson", "fp_consensus_ppr"])


def test_partial_week_refresh_retains_missing_players_and_original_capture_time(tmp_path, monkeypatch):
    monkeypatch.setattr(fp, "FP_CACHE_DIR", tmp_path)
    path = tmp_path / "2026_week04_proj.parquet"
    first = pd.DataFrame({"season": [2026]*2, "week": [4]*2,
        "name_key": ["a", "b"], "team": ["KC", "LV"], "fantasypros_proj": [12., 8.]})
    before = fp._write_week_cache(first, path).set_index("name_key")
    partial = first.assign(fantasypros_proj=[0., float("nan")])
    after = fp._write_week_cache(partial, path).set_index("name_key")
    assert after.loc["a", "fantasypros_proj"] == 0.
    assert after.loc["b", "fantasypros_proj"] == 8.
    assert after.loc["b", "fp_fetched_at_utc"] == before.loc["b", "fp_fetched_at_utc"]
