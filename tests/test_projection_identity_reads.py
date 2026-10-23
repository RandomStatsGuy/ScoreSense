"""Provider aliases must agree across cards, comparisons, and legacy roster reads."""
import json

import pandas as pd
import pytest

from src.draft_hub import player_identity
from src.projections import player_card, player_compare

PICKENS = "00-0037247"
ROOKIE = "00-0040001"


@pytest.fixture
def catalog(trusted_native_catalog):
    trusted_native_catalog("8137", name="George Pickens", team="DAL", position="WR", gsis_id=PICKENS)
    trusted_native_catalog("12001", name="Rookie TE", team="LV", position="TE", gsis_id=ROOKIE)
    trusted_native_catalog("11533", name="Brandon Aubrey", team="DAL", position="K")


@pytest.fixture
def card_sources(monkeypatch, catalog):
    pool = pd.DataFrame([
        {"player_id": PICKENS, "Player": "George Pickens", "Team": "DAL", "Position": "WR", "Projected Points": 8.472},
        {"player_id": ROOKIE, "Player": "Rookie TE", "Team": "LV", "Position": "TE", "Projected Points": 0.0},
    ])
    def load(position, **kwargs):
        assert kwargs["allow_compute"] is False
        return pool.copy() if position == "wr" else pd.DataFrame()
    monkeypatch.setattr(player_card, "load_weekly_prediction", load)
    monkeypatch.setattr(player_card, "load_ros_prediction", lambda *a, **k: pd.DataFrame([
        {"player_id": PICKENS, "ROS P50": 100.0}, {"player_id": ROOKIE, "ROS P50": 0.0}]))
    monkeypatch.setattr(player_card, "_narrative_for_player", lambda *a, **k: (None, {}))
    monkeypatch.setattr(player_card, "saved_preseason_forecast", lambda *a, **k: {})
    monkeypatch.setattr(player_card, "build_player_media_batch", lambda rows, **kwargs: {})
    monkeypatch.setattr(player_card, "recorded_player_history", lambda pid, *a, **k: {
        "game_log": [{"week": 1, "team": "PIT", "points": 0.0}] if pid == PICKENS else [],
        "season_to_date": {"points": 0.0 if pid == PICKENS else None},
    })
    monkeypatch.setattr(player_card, "_injury_for_player", lambda pid: None)
    return load


def test_all_card_aliases_share_projection_history_and_current_team(card_sources):
    cards = [player_card.build_player_card(pid, season=2026, week=7, position="wr")
             for pid in (PICKENS, "8137", "sleeper-8137")]
    for card in cards:
        assert card["player_id"] == PICKENS
        assert card["weekly_projection"]["Projected Points"] == 8.472
        assert card["rest_of_season_projection"]["p50"] == 100
        assert card["team"] == "DAL"
        assert card["game_log"][0] == {"week": 1, "team": "PIT", "points": 0.0}
        assert card["meta"]["identity"]["status"] == "resolved"


def test_true_te_position_and_rookie_zero_stay_separate_from_model_bucket(card_sources):
    card = player_card.build_player_card("sleeper-12001", season=2026, week=7, position="wr")
    assert card["position"] == "te"
    assert card["meta"]["model_position"] == "wr"
    assert card["weekly_projection"]["Projected Points"] == 0
    assert card["season_to_date"]["points"] is None


def test_specialists_are_explicitly_unsupported_without_reading_wr_models(card_sources, monkeypatch):
    def forbidden(*a, **k):
        raise AssertionError("A specialist must not read WR forecasts")
    monkeypatch.setattr(player_card, "load_weekly_prediction", forbidden)
    monkeypatch.setattr(player_card, "load_ros_prediction", forbidden)
    card = player_card.build_player_card("11533", season=2026, week=7)
    assert card["position"] == "k"
    assert card["weekly_projection"] is None
    assert card["meta"]["artifacts"]["weekly"]["status"] == "unsupported"


def test_card_reads_never_refresh_provider_even_with_a_signed_in_caller(catalog, monkeypatch):
    from src.integrations import sleeper
    from src.core.projection_read_scope import anonymous_projection_read
    def load(*a, **k):
        assert anonymous_projection_read()
        return pd.DataFrame()
    def forbidden(*a, **k):
        raise AssertionError("A card read must not fetch a provider")
    monkeypatch.setattr(sleeper, "_fetch_json", forbidden)
    monkeypatch.setattr(player_card, "load_weekly_prediction", load)
    monkeypatch.setattr(player_card, "load_ros_prediction", load)
    monkeypatch.setattr(player_card, "build_player_media_batch", lambda *a, **k: {})
    monkeypatch.setattr(player_card, "_narrative_for_player", lambda *a, **k: (None, {}))
    monkeypatch.setattr(player_card, "recorded_player_history", lambda *a, **k: {})
    monkeypatch.setattr(player_card, "saved_preseason_forecast", lambda *a, **k: {})
    player_card.build_player_card("8137", season=2026, week=7)
    assert not anonymous_projection_read()


def test_duplicate_alias_rows_cannot_choose_an_arbitrary_projection(card_sources, monkeypatch):
    duplicate = pd.DataFrame([{"player_id": PICKENS}, {"player_id": "8137"}])
    monkeypatch.setattr(player_card, "load_weekly_prediction", lambda *a, **k: duplicate)
    with pytest.raises(player_identity.PlayerIdentityError, match="Duplicate"):
        player_card.build_player_card("8137", season=2026, week=7)


def test_crosswalk_replacement_invalidates_read_identity(catalog):
    from src.integrations.sleeper import PLAYERS_CACHE
    assert player_identity.read_player_identity("8137", season=2026)["canonical_id"] == PICKENS
    records = json.loads(PLAYERS_CACHE.read_text())
    records["8137"]["gsis_id"] = "00-0039999"
    PLAYERS_CACHE.write_text(json.dumps(records) + "\n", encoding="utf-8")
    assert player_identity.read_player_identity("8137", season=2026)["canonical_id"] == "00-0039999"


def test_comparison_deduplicates_aliases_and_keeps_requested_period(card_sources, monkeypatch):
    monkeypatch.setattr(player_compare, "load_weekly_prediction", card_sources)
    payload = player_compare.build_player_compare(["8137", "sleeper-12001"], season=2026, week=7)
    assert [p["player_id"] for p in payload["players"]] == [PICKENS, ROOKIE]
    assert [p["p50"] for p in payload["players"]] == [8.47, 0]
    assert payload["players"][1]["position"] == "TE"
    assert payload["meta"]["week"] == 7
    with pytest.raises(ValueError, match="Compare requires"):
        player_compare.build_player_compare(["8137", PICKENS], season=2026, week=7)


def test_unknown_id_does_not_trigger_comparison_rebuild(catalog, monkeypatch):
    monkeypatch.setattr(player_compare, "load_weekly_prediction", lambda *a, **k: pd.DataFrame())
    def forbidden(*a):
        raise AssertionError("An identity miss cannot justify model rebuilds")
    with pytest.raises(ValueError, match="Could not resolve"):
        player_compare.build_player_compare(["unknown-a", "unknown-b"], season=2026, week=7, compute_fn=forbidden)


def test_alias_forecast_rows_keep_comparison_position_rank(card_sources, monkeypatch):
    pool = pd.DataFrame([{"player_id": "8137", "Position": "WR", "Projected Points": 8.472},
                         {"player_id": ROOKIE, "Position": "TE", "Projected Points": 0.0}])
    monkeypatch.setattr(player_compare, "load_weekly_prediction", lambda pos, **k: pool.copy() if pos == "wr" else pd.DataFrame())
    payload = player_compare.build_player_compare([PICKENS, "12001"], season=2026, week=7)
    assert [p["position_rank"] for p in payload["players"]] == [1, 1]


def test_unknown_receiver_position_has_no_invented_rank():
    pool = pd.DataFrame([{"player_id": "unknown", "Position": None, "Projected Points": 30.0},
                         {"player_id": "wr", "Position": "WR", "Projected Points": 10.0},
                         {"player_id": "te", "Position": "TE", "Projected Points": 8.0}])
    assert player_compare.position_rank_map(pool) == {"wr": 1, "te": 1}


def test_ros_only_exact_identity_is_available_without_guessing_wr(card_sources, monkeypatch):
    unknown = "00-0099999"
    monkeypatch.setattr(player_card, "load_weekly_prediction", lambda *a, **k: pd.DataFrame())
    monkeypatch.setattr(player_card, "load_ros_prediction", lambda pos, **k: pd.DataFrame([
        {"player_id": unknown, "Position": "TE", "ROS P50": 60.0}]) if pos == "wr" else pd.DataFrame())
    card = player_card.build_player_card(unknown, season=2026, week=7)
    assert card["position"] == "te"
    assert card["rest_of_season_projection"]["p50"] == 60
    assert card["meta"]["identity"]["status"] == "unresolved"
    assert card["meta"]["artifacts"]["weekly"]["status"] == "missing"


def test_valuation_rejects_duplicate_canonical_aliases_before_allocating(catalog):
    from src.draft_hub.auction_values import build_player_values, _value_for_roster_row
    from src.draft_hub.schemas import LeagueRules
    pool = pd.DataFrame([{"player_id": PICKENS, "Position": "WR", "Season Proj": 150.0},
                         {"player_id": "8137", "Position": "WR", "Season Proj": 170.0}])
    with pytest.raises(player_identity.PlayerIdentityError, match="Duplicate canonical"):
        build_player_values(pool, LeagueRules())
    with pytest.raises(ValueError, match="Duplicate player aliases"):
        _value_for_roster_row({"player_id": "8137", "position": "WR"}, pool,
                             {PICKENS: {"fair_value": 20}, "8137": {"fair_value": 30}}, pos_col="Position")


def test_alias_filtered_predictions_keep_canonical_projection_rows(catalog):
    rows = [{"player_id": PICKENS, "Projected Points": 8.472}]
    assert player_compare.filter_projections_by_ids(rows, ["sleeper-8137"], season=2026) == rows


def test_projection_explanation_uses_same_canonical_alias(catalog, monkeypatch):
    from src.projections import projection_explanation as explain
    pool = pd.DataFrame([{"player_id": PICKENS, "Player": "George Pickens", "Team": "DAL", "Position": "WR", "Projected Points": 8.472}])
    monkeypatch.setattr(explain, "load_weekly_prediction", lambda pos, **kwargs: pool if pos == "wr" else pd.DataFrame())
    monkeypatch.setattr(explain, "_load_usage_features", lambda *args: {})
    monkeypatch.setattr(explain, "_narrative_from_sentiment", lambda *args, **kwargs: None)
    payloads = [explain.build_projection_explanation(pid, season=2026, week=7) for pid in (PICKENS, "8137", "sleeper-8137")]
    assert all(payload["player_id"] == PICKENS for payload in payloads)
    assert all(payload["projection"]["p50"] == 8.47 for payload in payloads)
    assert all(payload["meta"]["week"] == 7 for payload in payloads)
