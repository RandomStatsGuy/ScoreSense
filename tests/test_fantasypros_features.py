"""Tests for optional FantasyPros model features."""

import os

from src.core.features import FP_FEATURE_COLS, fantasypros_features_enabled, get_position_features


def test_fantasypros_features_disabled_by_default(monkeypatch):
    monkeypatch.delenv("FANTASYPROS_USE_AS_FEATURE", raising=False)
    assert fantasypros_features_enabled() is False
    spec = get_position_features("qb")
    for col in FP_FEATURE_COLS:
        assert col not in spec.feature_cols


def test_fantasypros_features_enabled(monkeypatch):
    monkeypatch.setenv("FANTASYPROS_USE_AS_FEATURE", "true")
    spec = get_position_features("qb")
    for col in FP_FEATURE_COLS:
        assert col in spec.feature_cols
