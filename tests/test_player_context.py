"""SCORE-23 cached player-context read model — unit + API tests."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from src.integrations.injury_snapshot import build_injury_snapshot
from src.projections.player_context import (
    build_player_context_rows,
    compact_player_context,
    detail_available_for_payload,
    get_player_context,
    invalidate_player_context_cache,
    injury_age_hours,
    list_player_context,
    parse_opportunity_drivers,
    save_player_context_artifact,
    slugify_player_name,
)


def _pool(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


INJ_WR = _pool(
    [
        {
            "Player": "Tee Higgins",
            "Projected Points": 16.8,
            "Low (P10)": 5.0,
            "High (P90)": 30.0,
            "Team": "CIN",
            "Opponent": "BAL",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-higgins",
            "Position": "WR",
            "Injury Boost": 0.15,
            "Injury Note": "Ja'Marr Chase (Questionable)",
            "Injury Status": "",
        },
        {
            "Player": "Quiet WR",
            "Projected Points": 8.0,
            "Low (P10)": 4.0,
            "High (P90)": 12.0,
            "Team": "KC",
            "Opponent": "DEN",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-quiet",
            "Position": "WR",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "Questionable",
        },
    ]
)

BASE_WR = _pool(
    [
        {
            "Player": "Tee Higgins",
            "Projected Points": 14.7,
            "Low (P10)": 4.0,
            "High (P90)": 28.0,
            "Team": "CIN",
            "Opponent": "BAL",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-higgins",
            "Position": "WR",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "",
        },
        {
            "Player": "Quiet WR",
            "Projected Points": 8.0,
            "Low (P10)": 4.0,
            "High (P90)": 12.0,
            "Team": "KC",
            "Opponent": "DEN",
            "Week": 1,
            "Season": 2026,
            "player_id": "wr-quiet",
            "Position": "WR",
            "Injury Boost": 0.0,
            "Injury Note": "",
            "Injury Status": "",
        },
    ]
)

EMPTY = pd.DataFrame()


def _fake_weekly_load(
    position,
    season=None,
    week=None,
    apply_injury_adjustments=True,
    allow_compute=True,
):
    assert allow_compute is False, "player-context build must not live-predict"
    pos = str(position).lower()
    if pos != "wr":
        return EMPTY.copy()
    return INJ_WR.copy() if apply_injury_adjustments else BASE_WR.copy()


@pytest.fixture
def client():
    return TestClient(app)


def test_slugify_and_parse_drivers():
    assert slugify_player_name("Justin Jefferson") == "justin-jefferson"
    drivers = parse_opportunity_drivers(
        "Ja'Marr Chase (Questionable); Other Guy (Out)",
        name_index={"ja'marr chase": "00-0036322"},
    )
    assert drivers[0] == "00-0036322"
    assert drivers[1] == "other-guy"


def test_build_injury_snapshot_from_players_dict():
    players = {
        "111": {
            "full_name": "Ja'Marr Chase",
            "gsis_id": "00-0036322",
            "team": "CIN",
            "position": "WR",
            "injury_status": "Questionable",
            "practice_participation": "Limited",
            "news_updated": 1_700_000_000_000,
        },
        "222": {
            "full_name": "Healthy Player",
            "gsis_id": "00-0000001",
            "team": "KC",
            "position": "RB",
        },
    }
    snap = build_injury_snapshot(season=2026, week=1, players=players)
    assert snap["injury_snapshot_id"].startswith("inj_2026w1_")
    assert snap["player_count"] == 1
    assert snap["players"][0]["status"] == "Questionable"
    assert snap["players"][0]["practice"] == "Limited"
    assert snap["players"][0]["updated_at"] is not None


@patch("src.projections.player_context._cached_digest_summary", return_value=(None, None))
@patch("src.projections.player_context._load_sentiment_index", return_value={})
@patch("src.projections.player_context.save_injury_snapshot")
@patch("src.projections.player_context.load_weekly_prediction", side_effect=_fake_weekly_load)
def test_build_player_context_schema(_load, _save_snap, _sent, _digest, tmp_path, monkeypatch):
    monkeypatch.setattr(
        "src.projections.player_context.PLAYER_CONTEXT_DIR",
        Path(tmp_path),
    )
    invalidate_player_context_cache()

    snapshot = {
        "injury_snapshot_id": "inj_2026w1_test",
        "built_at": "2026-08-14T00:00:00+00:00",
        "players": [
            {
                "sleeper_id": "s1",
                "gsis_id": "wr-quiet",
                "full_name": "Quiet WR",
                "status": "Questionable",
                "practice": "DNP",
                "updated_at": "2026-08-13T12:00:00+00:00",
            },
            {
                "sleeper_id": "s2",
                "gsis_id": "00-0036322",
                "full_name": "Ja'Marr Chase",
                "status": "Questionable",
                "practice": "Limited",
                "updated_at": "2026-08-13T12:00:00+00:00",
            },
        ],
    }
    rows, meta = build_player_context_rows(
        2026, 1, injury_snapshot=snapshot
    )
    assert meta["injury_snapshot_id"] == "inj_2026w1_test"
    assert meta["rows"] == 2
    by_id = {r["player_id"]: r for r in rows}

    higgins = by_id["wr-higgins"]
    assert higgins["projection"]["base"] == 14.7
    assert higgins["projection"]["final"] == 16.8
    assert higgins["projection"]["injury_delta"] == 2.1
    assert higgins["projection"]["injury_snapshot_id"] == "inj_2026w1_test"
    assert higgins["opportunity_adjustment"]["included"] is True
    assert higgins["opportunity_adjustment"]["points"] == 2.1
    assert "00-0036322" in higgins["opportunity_adjustment"]["drivers"]
    assert higgins["media_context"]["affects_projection"] is False
    assert higgins["media_context"]["state"] == "none"
    assert "excerpt" in higgins["media_context"]
    assert "sources" in higgins["media_context"]

    quiet = by_id["wr-quiet"]
    assert quiet["availability"]["status"] == "Questionable"
    assert quiet["availability"]["practice"] == "DNP"
    assert quiet["opportunity_adjustment"]["included"] is False

    path = save_player_context_artifact(2026, 1, rows=rows, meta=meta)
    assert path.exists()

    payload = get_player_context("wr-higgins", season=2026, week=1)
    assert payload["projection"]["final"] == 16.8
    assert payload["meta"]["injury_snapshot_id"] == "inj_2026w1_test"
    assert payload["meta"]["view"] == "detail"

    listed = list_player_context(season=2026, week=1, player_ids=["wr-quiet"])
    assert listed["count"] == 1
    assert listed["meta"]["compact"] is True
    assert listed["meta"]["view"] == "compact"
    quiet_row = listed["players"][0]
    assert quiet_row["player_id"] == "wr-quiet"
    assert quiet_row["detail_available"] is True
    assert "summary" not in quiet_row["media_context"]
    assert "drivers" not in quiet_row["opportunity_adjustment"]
    assert "projection" not in quiet_row
    assert quiet_row["this_week"]["kind"] == "practice"
    assert quiet_row["this_week"]["has_note"] is True

    payload = get_player_context("wr-higgins", season=2026, week=1)
    assert payload["this_week"]["projection_line"] == "Week is 2.1 above the healthy slate."
    assert payload["media_context"]["summary"] is None
    assert payload["media_context"]["excerpt"] is None


@patch("app.api.get_player_context")
def test_player_context_api_shape(mock_get, client):
    mock_get.return_value = {
        "player_id": "wr-higgins",
        "player_name": "Tee Higgins",
        "position": "WR",
        "team": "CIN",
        "projection": {
            "base": 14.7,
            "final": 16.8,
            "injury_delta": 2.1,
            "injury_snapshot_id": "inj_2026w1_abc",
        },
        "availability": {"status": None, "practice": None, "updated_at": None, "age_hours": None},
        "opportunity_adjustment": {
            "points": 2.1,
            "drivers": ["justin-jefferson"],
            "included": True,
        },
        "media_context": {
            "state": "current",
            "signal": "role_up",
            "source_count": 3,
            "summary": "Role trending up.",
            "excerpt": "Higgins elevated with Chase limited",
            "sources": [{"label": "Fantasy Footballers"}],
            "updated_at": "2026-08-14T00:00:00+00:00",
            "historical": None,
            "affects_projection": False,
        },
        "detail_available": True,
        "meta": {"season": 2026, "week": 1, "stale": False, "view": "detail"},
    }

    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {"sub": "test"}
    try:
        res = client.get("/api/player/wr-higgins/context?season=2026&week=1")
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    data = res.json()
    assert data["projection"]["injury_snapshot_id"] == "inj_2026w1_abc"
    assert data["opportunity_adjustment"]["included"] is True
    assert data["media_context"]["affects_projection"] is False
    assert data["media_context"]["excerpt"]
    assert data["detail_available"] is True
    mock_get.assert_called_once()


def test_player_context_routes_registered():
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/player/{player_id}/context" in paths
    assert "/api/player/{player_id}/latest" in paths
    assert "/api/players/context" in paths


def test_player_context_requires_auth(client):
    from fastapi import HTTPException

    from app.auth import require_patron

    def _deny():
        raise HTTPException(status_code=401, detail="auth required")

    app.dependency_overrides[require_patron] = _deny
    try:
        res = client.get("/api/player/x/context")
        assert res.status_code == 401
    finally:
        app.dependency_overrides.pop(require_patron, None)


@patch("app.api.get_player_context")
def test_player_context_api_503_when_cold(mock_get, client):
    mock_get.side_effect = FileNotFoundError("artifact missing")
    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {"sub": "test"}
    try:
        res = client.get("/api/player/wr-higgins/context?season=2026&week=1")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 503


@patch("app.api.list_player_context")
def test_players_context_list_api(mock_list, client):
    mock_list.return_value = {
        "count": 1,
        "players": [
            {
                "player_id": "wr-higgins",
                "availability": {"status": None, "age_hours": None},
                "opportunity_adjustment": {"points": 2.1, "included": True},
                "media_context": {"signal": "role_up", "source_count": 3},
                "detail_available": True,
            }
        ],
        "meta": {"season": 2026, "week": 1, "compact": True, "view": "compact"},
    }
    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {"sub": "test"}
    try:
        res = client.get("/api/players/context?season=2026&week=1&ids=wr-higgins")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    assert res.json()["count"] == 1
    mock_list.assert_called_once()
    kwargs = mock_list.call_args.kwargs
    assert kwargs["player_ids"] == ["wr-higgins"]
    assert kwargs.get("compact") is True


@patch("app.api.list_player_context")
def test_players_context_list_api_compact_false(mock_list, client):
    mock_list.return_value = {
        "count": 0,
        "players": [],
        "meta": {"season": 2026, "week": 1, "compact": False, "view": "detail"},
    }
    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {"sub": "test"}
    try:
        res = client.get(
            "/api/players/context?season=2026&week=1&compact=false"
        )
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    assert mock_list.call_args.kwargs.get("compact") is False


def test_injury_age_hours_and_compact_shape():
    now = datetime(2026, 8, 16, 18, 0, tzinfo=timezone.utc)
    assert injury_age_hours("2026-08-16T12:00:00+00:00", now=now) == 6.0
    assert injury_age_hours(None) is None

    full = {
        "player_id": "p1",
        "player_name": "Test",
        "position": "WR",
        "team": "CIN",
        "projection": {
            "base": 10.0,
            "final": 12.0,
            "injury_delta": 2.0,
            "injury_snapshot_id": "inj_x",
        },
        "availability": {
            "status": "Questionable",
            "practice": "Limited",
            "updated_at": "2026-08-16T12:00:00+00:00",
        },
        "opportunity_adjustment": {
            "points": 2.0,
            "drivers": ["00-0036322"],
            "included": True,
        },
        "media_context": {
            "state": "current",
            "signal": "role_up",
            "source_count": 2,
            "summary": "Long digest body that must not ship in table rows.",
            "excerpt": "Strongest excerpt text",
            "sources": [{"label": "Show A"}, {"label": "Show B"}],
            "updated_at": "2026-08-16T10:00:00+00:00",
            "historical": None,
            "affects_projection": False,
        },
        "meta": {"season": 2026, "week": 1, "stale": False, "fingerprint": "abc"},
    }
    assert detail_available_for_payload(full) is True
    compact = compact_player_context(full, now=now)
    assert compact["availability"]["status"] == "Questionable"
    assert compact["availability"]["age_hours"] == 6.0
    assert compact["opportunity_adjustment"]["points"] == 2.0
    assert compact["opportunity_adjustment"]["included"] is True
    assert compact["opportunity_adjustment"]["can_label_included"] is True
    assert compact["opportunity_adjustment"]["stale_vs_projection"] is False
    assert "inclusion_trust" in compact
    assert compact["inclusion_trust"]["can_label_included"] is True
    assert compact["media_context"]["signal"] == "role_up"
    assert compact["media_context"]["source_count"] == 2
    assert "summary" not in compact["media_context"]
    assert "excerpt" not in compact["media_context"]
    assert "sources" not in compact["media_context"]
    assert "drivers" not in compact["opportunity_adjustment"]
    assert "projection" not in compact
    assert compact["detail_available"] is True
    assert compact["meta"]["view"] == "compact"


def test_serve_path_does_not_call_sleeper_or_predict(tmp_path, monkeypatch):
    """Page-view load must not touch Sleeper, LLM, or live predict."""
    monkeypatch.setattr(
        "src.projections.player_context.PLAYER_CONTEXT_DIR",
        Path(tmp_path),
    )
    invalidate_player_context_cache()

    payload = {
        "player_id": "p1",
        "player_name": "Test",
        "position": "WR",
        "team": "CIN",
        "projection": {
            "base": 10.0,
            "final": 10.0,
            "injury_delta": 0.0,
            "injury_snapshot_id": "inj_2026w1_x",
        },
        "availability": {"status": None, "practice": None, "updated_at": None},
        "opportunity_adjustment": {"points": 0.0, "drivers": [], "included": False},
        "media_context": {
            "state": "none",
            "signal": None,
            "source_count": 0,
            "summary": None,
            "excerpt": None,
            "sources": [],
            "updated_at": None,
            "historical": None,
            "affects_projection": False,
        },
        "meta": {"season": 2026, "week": 1},
    }
    meta = {
        "season": 2026,
        "week": 1,
        "injury_snapshot_id": "inj_2026w1_x",
        "fingerprint": "deadbeefdeadbeef",
        "built_at": "2026-08-14T00:00:00+00:00",
        "rows": 1,
        "schema_version": "player_context_v3",
    }
    parquet = Path(tmp_path) / "2026_w1.parquet"
    meta_path = Path(tmp_path) / "2026_w1.meta.json"
    pd.DataFrame(
        {
            "player_id": ["p1"],
            "player_name": ["Test"],
            "position": ["WR"],
            "team": ["CIN"],
            "payload_json": [json.dumps(payload)],
        }
    ).to_parquet(parquet, index=False)
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    with (
        patch("src.integrations.sleeper.load_sleeper_players") as sleeper,
        patch("src.projections.predict.predict_upcoming_week") as predict,
        patch(
            "src.projections.player_context.player_context_fingerprint",
            return_value="deadbeefdeadbeef",
        ),
        patch(
            "src.projections.player_context.season_week_context",
            return_value=(2026, 1),
        ),
    ):
        out = get_player_context("p1", season=2026, week=1)
        assert out["player_id"] == "p1"
        assert out["meta"]["view"] == "detail"
        listed = list_player_context(season=2026, week=1, compact=True)
        assert listed["players"][0]["detail_available"] is False
        assert "summary" not in listed["players"][0]["media_context"]
        sleeper.assert_not_called()
        predict.assert_not_called()


def test_list_compact_omits_heavy_bodies_detail_keeps_them(tmp_path, monkeypatch):
    """SCORE-30: table list is compact; single-player detail keeps narrative bodies."""
    monkeypatch.setattr(
        "src.projections.player_context.PLAYER_CONTEXT_DIR",
        Path(tmp_path),
    )
    invalidate_player_context_cache()

    payload = {
        "player_id": "wr-higgins",
        "player_name": "Tee Higgins",
        "position": "WR",
        "team": "CIN",
        "projection": {
            "base": 14.7,
            "final": 16.8,
            "injury_delta": 2.1,
            "injury_snapshot_id": "inj_2026w1_x",
        },
        "availability": {
            "status": "Questionable",
            "practice": "Limited",
            "updated_at": "2026-08-15T12:00:00+00:00",
        },
        "opportunity_adjustment": {
            "points": 2.1,
            "drivers": ["00-0036322"],
            "included": True,
        },
        "media_context": {
            "state": "current",
            "signal": "role_up",
            "source_count": 2,
            "summary": "Role trending up — discussed by 2 fantasy shows.",
            "excerpt": "Higgins sees elevated targets with Chase limited",
            "sources": [{"label": "Fantasy Footballers"}, {"label": "Establish The Run"}],
            "updated_at": "2026-08-15T18:00:00+00:00",
            "historical": None,
            "affects_projection": False,
        },
        "meta": {"season": 2026, "week": 1},
    }
    meta = {
        "season": 2026,
        "week": 1,
        "injury_snapshot_id": "inj_2026w1_x",
        "fingerprint": "abcdabcdabcdabcd",
        "built_at": "2026-08-14T00:00:00+00:00",
        "rows": 1,
        "schema_version": "player_context_v3",
    }
    parquet = Path(tmp_path) / "2026_w1.parquet"
    meta_path = Path(tmp_path) / "2026_w1.meta.json"
    pd.DataFrame(
        {
            "player_id": ["wr-higgins"],
            "player_name": ["Tee Higgins"],
            "position": ["WR"],
            "team": ["CIN"],
            "payload_json": [json.dumps(payload)],
        }
    ).to_parquet(parquet, index=False)
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    with (
        patch(
            "src.projections.player_context.player_context_fingerprint",
            return_value="abcdabcdabcdabcd",
        ),
        patch(
            "src.projections.player_context.season_week_context",
            return_value=(2026, 1),
        ),
    ):
        listed = list_player_context(season=2026, week=1, compact=True)
        row = listed["players"][0]
        assert listed["meta"]["compact"] is True
        assert row["availability"]["status"] == "Questionable"
        assert row["availability"]["age_hours"] is not None
        assert row["opportunity_adjustment"]["points"] == 2.1
        assert row["media_context"]["signal"] == "role_up"
        assert row["media_context"]["source_count"] == 2
        assert row["detail_available"] is True
        assert "summary" not in row["media_context"]
        assert "excerpt" not in row["media_context"]
        assert "sources" not in row["media_context"]
        assert "drivers" not in row["opportunity_adjustment"]

        detail = get_player_context("wr-higgins", season=2026, week=1)
        assert detail["meta"]["view"] == "detail"
        assert detail["media_context"]["summary"] is None
        assert detail["media_context"]["excerpt"] is None
        assert detail["media_context"]["sources"] == []
        assert detail["this_week"]["kind"] == "practice"
        assert detail["this_week"]["projection_line"] == "Week is 2.1 above the healthy slate."
        assert detail["opportunity_adjustment"]["drivers"] == ["00-0036322"]
        assert detail["projection"]["final"] == 16.8
        assert detail["detail_available"] is True
        assert detail["availability"]["age_hours"] is not None


def test_media_context_historical_available_requires_opt_in(tmp_path, monkeypatch):
    """SCORE-28: historical media is pointed at, not auto-injected as current."""
    from src.projections import player_context as pc

    monkeypatch.setattr(pc, "PLAYER_CONTEXT_DIR", Path(tmp_path))
    invalidate_player_context_cache()

    payload = {
        "player_id": "p-hist",
        "player_name": "Hist Player",
        "position": "WR",
        "team": "KC",
        "projection": {
            "base": 10.0,
            "final": 10.0,
            "injury_delta": 0.0,
            "injury_snapshot_id": "inj_2026w1_x",
        },
        "availability": {"status": None, "practice": None, "updated_at": None},
        "opportunity_adjustment": {"points": 0.0, "drivers": [], "included": False},
        "media_context": {
            "state": "historical_available",
            "signal": None,
            "source_count": 0,
            "summary": None,
            "excerpt": None,
            "sources": [],
            "updated_at": None,
            "historical": {
                "season": 2025,
                "week": 18,
                "signal": "mentioned",
                "source_count": 2,
                "summary": "Older Week 18 buzz",
                "excerpt": "Older excerpt",
                "sources": [{"label": "Old Show"}],
                "updated_at": "2025-12-30T00:00:00+00:00",
            },
            "affects_projection": False,
        },
        "meta": {"season": 2026, "week": 1},
    }
    meta = {
        "season": 2026,
        "week": 1,
        "injury_snapshot_id": "inj_2026w1_x",
        "fingerprint": "abcdabcdabcdabcd",
        "built_at": "2026-08-14T00:00:00+00:00",
        "rows": 1,
        "schema_version": "player_context_v3",
    }
    parquet = Path(tmp_path) / "2026_w1.parquet"
    meta_path = Path(tmp_path) / "2026_w1.meta.json"
    pd.DataFrame(
        {
            "player_id": ["p-hist"],
            "player_name": ["Hist Player"],
            "position": ["WR"],
            "team": ["KC"],
            "payload_json": [json.dumps(payload)],
        }
    ).to_parquet(parquet, index=False)
    meta_path.write_text(json.dumps(meta), encoding="utf-8")

    with (
        patch(
            "src.projections.player_context.player_context_fingerprint",
            return_value="abcdabcdabcdabcd",
        ),
        patch(
            "src.projections.player_context.season_week_context",
            return_value=(2026, 1),
        ),
    ):
        default = get_player_context("p-hist", season=2026, week=1)
        assert default["media_context"]["state"] == "historical_available"
        assert default["media_context"]["summary"] is None
        assert default["media_context"]["signal"] is None
        assert default["media_context"]["historical"] == {"season": 2025, "week": 18}
        assert default["detail_available"] is True

        compact = list_player_context(season=2026, week=1, compact=True)["players"][0]
        assert compact["detail_available"] is True
        assert compact["media_context"]["historical"] == {"season": 2025, "week": 18}
        assert "summary" not in compact["media_context"]

        opted = get_player_context(
            "p-hist", season=2026, week=1, include_historical=True
        )
        assert opted["media_context"]["state"] == "historical_available"
        assert opted["media_context"]["summary"] == "Older Week 18 buzz"
        assert opted["media_context"]["excerpt"] == "Older excerpt"
        assert opted["media_context"]["sources"] == [{"label": "Old Show"}]
        assert opted["media_context"]["signal"] == "mentioned"
        assert opted["media_context"]["source_count"] == 2


@patch("app.api.get_player_context")
def test_player_context_api_include_historical_query(mock_get, client):
    mock_get.return_value = {
        "player_id": "p-hist",
        "media_context": {
            "state": "historical_available",
            "summary": "Older Week 18 buzz",
            "signal": "mentioned",
            "source_count": 2,
            "historical": {"season": 2025, "week": 18},
            "affects_projection": False,
        },
        "meta": {"season": 2026, "week": 1, "include_historical": True},
    }
    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {"sub": "test"}
    try:
        res = client.get(
            "/api/player/p-hist/context?season=2026&week=1&include_historical=true"
        )
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    assert res.json()["media_context"]["state"] == "historical_available"
    kwargs = mock_get.call_args.kwargs
    assert kwargs.get("include_historical") is True


@patch("app.api.get_player_context")
def test_player_context_api_media_mode_query(mock_get, client):
    mock_get.return_value = {
        "player_id": "p1",
        "media_context": {
            "state": "current",
            "summary": "Camp outlook",
            "mode": "outlook",
            "modes_available": {
                "outlook": True,
                "week1_pulse": True,
                "older": False,
            },
            "affects_projection": False,
        },
        "meta": {"season": 2026, "week": 1, "media_mode": "outlook"},
    }
    from app.auth import require_patron

    app.dependency_overrides[require_patron] = lambda: {"sub": "test"}
    try:
        res = client.get(
            "/api/player/p1/context?season=2026&week=1&media_mode=outlook"
        )
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    assert res.json()["media_context"]["mode"] == "outlook"
    kwargs = mock_get.call_args.kwargs
    assert kwargs.get("media_mode") == "outlook"
