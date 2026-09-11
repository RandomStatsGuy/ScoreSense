"""Best ball reads artifacts without model runs or external data refreshes."""

import pandas as pd
import pytest

from src.draft_hub import draft_pool_cache
from src.products import bestball_board as board


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch, tmp_path):
    monkeypatch.setattr(draft_pool_cache, "DRAFT_POOL_DIR", tmp_path / "pool")
    monkeypatch.setattr(draft_pool_cache, "MODEL_DIR", tmp_path / "models")
    monkeypatch.setattr(draft_pool_cache, "PROCESSED_DATA_DIR", tmp_path / "processed")
    monkeypatch.setattr(draft_pool_cache, "pool_fingerprint", lambda: "current")
    monkeypatch.setattr(board, "SCHEDULE_CACHE", tmp_path / "schedules.parquet")

    def forbidden(*args, **kwargs):
        pytest.fail("Board reads must not run inference, refresh identity, or use the network")

    monkeypatch.setattr(draft_pool_cache, "_compute_pool", forbidden)
    monkeypatch.setattr(draft_pool_cache, "_with_roster_identity", forbidden)
    monkeypatch.setattr("requests.sessions.Session.request", forbidden)
    monkeypatch.setattr("src.integrations.fantasypros.prefetch_draft_season_ecr", forbidden)

    def cached_ecr(season, position, *, cache_only):
        assert season == 2026
        assert cache_only is True
        if position == "wr":
            return pd.DataFrame({
                "week": [1, 1], "name_key": ["receiver", "tightend"],
                "team": ["KC", "BUF"], "fp_ecr": [3.0, 4.0],
            })
        return pd.DataFrame()

    monkeypatch.setattr(board, "build_fp_enrichment_frame", cached_ecr)


@pytest.fixture
def sample_pool():
    return pd.DataFrame({
        "player_id": ["q", "r", "w", "t", "k", "d"],
        "Player": ["Quarterback", "Runner", "Receiver", "Tightend", "Kicker", "Defense"],
        "Position": ["QB", "RB", "WR", "TE", "K", "DEF"],
        "Team": ["KC", "BUF", "KC", "BUF", "KC", "BUF"],
        "Season Proj": [300.0, 200.0, 180.0, 190.0, 100.0, 90.0],
    })


@pytest.mark.parametrize("disk_read", [False, True])
def test_board_uses_current_artifact_and_preserves_combined_receiver_ranks(sample_pool, disk_read):
    draft_pool_cache.save_pool_artifact(2026, sample_pool)
    if disk_read:
        draft_pool_cache.invalidate_pool_cache()
    result, meta = board.build_bestball_board(2026)
    rows = result.set_index("player_id")
    assert set(rows.index) == {"q", "r", "w", "t"}
    assert rows.loc["t", "Position"] == rows.loc["w", "Position"] == "WR/TE"
    assert rows.loc["t", "model_rank"] == 1
    assert rows.loc["w", "model_rank"] == 2
    assert rows.loc["t", "value_vs_adp"] == 3
    assert rows.loc["w", "value_vs_adp"] == 1
    assert pd.isna(rows.loc["q", "adp_rank"])
    assert result["bye_week"].isna().all()
    assert meta["count"] == 4 and meta["with_adp"] == 2
    assert meta["projection_source"] == "draft_pool_cache"
    assert meta["fp_prefetch"] is None
    pd.testing.assert_frame_equal(sample_pool, draft_pool_cache._POOL_CACHE[2026][1])
    # Returned frames cannot corrupt the cached projections.
    result.loc[:, "Season Proj"] = -1
    again, _ = board.build_bestball_board(2026)
    assert (again["Season Proj"] > 0).all()


@pytest.mark.parametrize("state", ["missing", "stale", "wrong-season"])
def test_unavailable_cache_does_not_fall_back_to_inference(sample_pool, monkeypatch, state):
    if state != "missing":
        draft_pool_cache.save_pool_artifact(2026, sample_pool)
    if state == "stale":
        monkeypatch.setattr(draft_pool_cache, "pool_fingerprint", lambda: "changed")
    with pytest.raises(FileNotFoundError, match="Season projections are not ready"):
        board.build_bestball_board(2027 if state == "wrong-season" else 2026)


def test_new_artifact_is_used_after_refresh(sample_pool, monkeypatch):
    draft_pool_cache.save_pool_artifact(2026, sample_pool)
    before, _ = board.build_bestball_board(2026)
    monkeypatch.setattr(draft_pool_cache, "pool_fingerprint", lambda: "refreshed")
    newer = sample_pool.copy()
    newer.loc[newer.player_id.eq("w"), "Season Proj"] = 250.0
    draft_pool_cache.save_pool_artifact(2026, newer)
    after, _ = board.build_bestball_board(2026)
    assert before.set_index("player_id").loc["w", "model_rank"] == 2
    assert after.set_index("player_id").loc["w", "model_rank"] == 1


def test_byes_use_only_cached_regular_season_schedule(monkeypatch):
    schedules = pd.DataFrame({
        "season": [2025, 2026, 2026, 2026, 2026],
        "week": [1, 1, 1, 2, 2],
        "game_type": ["REG", "REG", "REG", "REG", "PRE"],
        "home_team": ["OLD", "LA", "BUF", "LA", "BUF"],
        "away_team": ["OLD2", "KC", "NYJ", "KC", "NYJ"],
    })
    schedules.to_parquet(board.SCHEDULE_CACHE, index=False)
    original_read = pd.read_parquet
    reads = []

    def tracked_read(path, *args, **kwargs):
        reads.append(path)
        return original_read(path, *args, **kwargs)

    monkeypatch.setattr(pd, "read_parquet", tracked_read)
    assert board._team_bye_map(2026) == {"BUF": 2, "NYJ": 2}
    assert reads == [board.SCHEDULE_CACHE]


def test_missing_or_corrupt_schedule_is_optional():
    assert board._team_bye_map(2026) == {}
    board.SCHEDULE_CACHE.write_bytes(b"invalid parquet")
    assert board._team_bye_map(2026) == {}
def test_default_pool_reader_still_applies_identity(monkeypatch, sample_pool):
    draft_pool_cache.save_pool_artifact(2026, sample_pool)
    calls = []

    def identity(pool, season, **kwargs):
        calls.append(season)
        pool.loc[pool["player_id"].eq("q"), "Team"] = "NYJ"
        return pool

    monkeypatch.setattr(draft_pool_cache, "_with_roster_identity", identity)
    loaded = draft_pool_cache.load_draft_pool(2026, allow_compute=False)
    assert calls == [2026]
    assert loaded.loc[loaded["player_id"].eq("q"), "Team"].item() == "NYJ"
    cached = draft_pool_cache.load_draft_pool(2026, allow_compute=False, apply_identity=False)
    assert cached.loc[cached["player_id"].eq("q"), "Team"].item() == "KC"
