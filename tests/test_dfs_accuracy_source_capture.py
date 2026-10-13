"""Source/cohort integrity for isolated retrospective DFS research captures."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from scripts.analysis.prepare_dfs_accuracy_data import (
    capture_source, mapped_snap_counts, regular_pbp, regular_schedules,
    regular_stats, require_unique, sha256,
    prepare_snapshot,
)


@pytest.fixture
def schedules():
    return regular_schedules(pd.DataFrame([{
        "game_id": "2018_01_LA_OAK", "season": 2018, "week": 1, "game_type": "REG",
        "home_team": "OAK", "away_team": "LA", "gameday": "2018-09-10",
        "home_score": 13, "away_score": 33,
    }]), [2018])


def test_current_capture_reuse_checks_bytes_and_source_before_network(tmp_path, monkeypatch):
    path = tmp_path / "weekly.parquet"
    path.write_bytes(b"frozen public input")
    url = "https://github.com/nflverse/nflverse-data/public-input"
    receipt = {"url": url, "sha256": sha256(path), "fetched_at_utc": "2026-10-13T00:00:00Z"}
    (tmp_path / "weekly.parquet.source.json").write_text(json.dumps(receipt))
    monkeypatch.setattr("requests.get", lambda *a, **k: pytest.fail("Frozen reuse must not fetch"))
    assert capture_source(tmp_path, path.name, url) == receipt
    path.write_bytes(b"changed public input")
    with pytest.raises(ValueError, match="identity changed"):
        capture_source(tmp_path, path.name, url)


def test_orphaned_capture_is_not_silently_accepted(tmp_path):
    (tmp_path / "weekly.parquet").write_bytes(b"no provenance")
    with pytest.raises(ValueError, match="Incomplete source capture"):
        capture_source(tmp_path, "weekly.parquet", "https://example.invalid")


def test_completed_reg_schedule_normalizes_historical_alias_and_excludes_postseason():
    rows = pd.DataFrame([
        dict(game_id="reg", season=2018, week=1, game_type="REG", home_team="OAK", away_team="LAR", gameday="2018-09-10", home_score=13, away_score=33),
        dict(game_id="post", season=2018, week=18, game_type="WC", home_team="OAK", away_team="LA", gameday="2019-01-01", home_score=13, away_score=33),
    ])
    result = regular_schedules(rows, [2018])
    assert result.game_id.tolist() == ["reg"]
    assert result.iloc[0].home_team == "LV"
    assert result.iloc[0].away_team == "LA"
    rows.loc[0, "home_score"] = None
    with pytest.raises(ValueError, match="unfinished"):
        regular_schedules(rows, [2018])


def stat_rows():
    return pd.DataFrame([
        dict(player_id="qb", position="QB", season=2018, week=1, season_type="REG", team="OAK", opponent_team="LAR", fantasy_points_ppr=0.),
        dict(player_id="wr", position="WR", season=2018, week=1, season_type="REG", team="LA", opponent_team="LV", fantasy_points_ppr=-2.),
        dict(player_id=None, position=None, season=2018, week=1, season_type="REG", team="OAK", opponent_team="LA", fantasy_points_ppr=0.),
        dict(player_id="post", position="WR", season=2018, week=18, season_type="POST", team="LA", opponent_team="LV", fantasy_points_ppr=40.),
    ])


def test_observed_skill_cohort_retains_played_zeros_negatives_and_rejects_duplicates(schedules):
    result = regular_stats(stat_rows(), schedules, [2018])
    assert result.player_id.tolist() == ["qb", "wr"]
    assert result.fantasy_points_ppr.tolist() == [0., -2.]
    assert result.team.tolist() == ["LV", "LA"]
    duplicate = pd.concat([stat_rows(), stat_rows().iloc[[0]]], ignore_index=True)
    with pytest.raises(ValueError, match="unique keys"):
        regular_stats(duplicate, schedules, [2018])


def test_weekly_capture_requires_explicit_type_and_completed_team_game(schedules):
    with pytest.raises(ValueError, match="season_type"):
        regular_stats(stat_rows().drop(columns="season_type"), schedules, [2018])
    unknown = stat_rows()
    unknown.loc[0, "team"] = "BUF"
    with pytest.raises(ValueError, match="completed REG team game"):
        regular_stats(unknown, schedules, [2018])
    opponent = stat_rows()
    opponent.loc[0, "opponent_team"] = "BUF"
    with pytest.raises(ValueError, match="opponent does not match"):
        regular_stats(opponent, schedules, [2018])


def test_pbp_capture_cannot_mix_unknown_games_or_postseason(schedules):
    frame = pd.DataFrame([
        dict(game_id="2018_01_LA_OAK", season_type="REG", posteam="OAK", defteam="LAR"),
        dict(game_id="post", season_type="POST", posteam="OAK", defteam="LAR"),
    ])
    result = regular_pbp(frame, schedules)
    assert len(result) == 1
    assert result.posteam.iloc[0] == "LV"
    assert result.defteam.iloc[0] == "LA"
    frame.loc[0, "game_id"] = "unrecognized"
    with pytest.raises(ValueError, match="unknown REG game"):
        regular_pbp(frame, schedules)


def test_pfr_crosswalk_preserves_real_snap_values_and_reports_missing_identity(schedules):
    spine = pd.DataFrame([
        dict(player_id="qb", season=2018, week=1, team="LV"),
        dict(player_id="wr", season=2018, week=1, team="LA"),
        dict(player_id="missing", season=2018, week=1, team="LA"),
    ])
    snaps = pd.DataFrame([
        dict(pfr_player_id="qbpfr", season=2018, week=1, team="OAK", offense_snaps=60., offense_pct=.9),
        dict(pfr_player_id="wrpfr", season=2018, week=1, team="LAR", offense_snaps=4., offense_pct=.06),
        dict(pfr_player_id="unknown", season=2018, week=1, team="LA", offense_snaps=8., offense_pct=.12),
        dict(pfr_player_id="ambiguous", season=2018, week=1, team="LA", offense_snaps=9., offense_pct=.13),
    ])
    ids = pd.DataFrame([dict(pfr_id="qbpfr", gsis_id="qb"), dict(pfr_id="wrpfr", gsis_id="wr"),
        dict(pfr_id="ambiguous", gsis_id="one"), dict(pfr_id="ambiguous", gsis_id="two")])
    result, audit = mapped_snap_counts(snaps, ids, schedules, spine)
    assert result.player_id.tolist() == ["qb", "wr"]
    assert result.offense_snaps.tolist() == [60., 4.]
    assert audit["unmatched_pfr_rows"] == 2
    assert audit["ambiguous_pfr_ids"] == 1
    merged = spine.merge(result, on=["player_id", "season", "week", "team"], how="left")
    assert pd.isna(merged.loc[merged.player_id.eq("missing"), "offense_snaps"]).all()


def test_duplicate_or_missing_model_game_identity_fails_instead_of_deduplicating():
    frame = pd.DataFrame([dict(player_id="one", season=2025, week=1)] * 2)
    with pytest.raises(ValueError, match="unique keys"):
        require_unique(frame, ["player_id", "season", "week"], "fixture")
    frame = pd.DataFrame([dict(player_id=None, season=2025, week=1)])
    with pytest.raises(ValueError, match="unique keys"):
        require_unique(frame, ["player_id", "season", "week"], "fixture")


def test_capture_refuses_serving_data_artifacts_and_their_ancestor(monkeypatch):
    from src.config import DATA_DIR, MODEL_DIR
    monkeypatch.setattr("requests.get", lambda *a, **k: pytest.fail("Rejected destination must not fetch"))
    for path in [DATA_DIR / "processed", DATA_DIR / "candidates", MODEL_DIR, DATA_DIR.parent]:
        with pytest.raises(ValueError, match="outside serving data"):
            prepare_snapshot(path, [2025])
