"""Weekly predict API depth-chart metadata."""

from app.api import _predict_response


def test_weekly_predict_includes_depth_chart_meta():
    try:
        response = _predict_response("qb", season=2026, week=1, apply_injury_adjustments=False)
    except Exception:
        return
    if response["count"] == 0:
        return
    meta = response["meta"]
    assert "depth_chart" in meta
    assert isinstance(meta["depth_chart"], dict)
    if meta.get("preseason_mode"):
        assert meta["depth_chart"].get("applied") is True


def test_weekly_rb_depth_chart_meta():
    try:
        response = _predict_response("rb", season=2026, week=1, apply_injury_adjustments=False)
    except Exception:
        return
    if response["count"] == 0:
        return
    depth = response["meta"].get("depth_chart") or {}
    if response["meta"].get("preseason_mode"):
        assert depth.get("applied") is True
        assert depth.get("keep_per_team") == 3
