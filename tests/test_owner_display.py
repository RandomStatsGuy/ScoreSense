from src.draft_hub.owner_display import (
    attach_owner_names_to_teams,
    enrich_award_display,
    enrich_team_row,
    format_manager_label,
    resolve_owner,
)


def test_format_manager_label_owner_only_by_default():
    assert format_manager_label("White Supremacists", owner_label="Caleb K") == "Caleb K"


def test_format_manager_label_includes_team_when_year_specific():
    label = format_manager_label("White Supremacists", owner_label="Caleb K", year_specific=True)
    assert label == "Caleb K · White Supremacists"


def test_enrich_award_clears_team_name_for_current_stats():
    award = enrich_award_display(
        {"id": "x", "title": "T", "headline": "H"},
        team_name="Alpha",
        owner_label="Alice",
        year_specific=False,
    )
    assert award["owner_name"] == "Alice"
    assert award["display_name"] == "Alice"
    assert award["team_name"] is None


def test_enrich_award_keeps_team_name_for_year_specific():
    award = enrich_award_display(
        {"id": "x", "title": "T", "headline": "H"},
        team_name="Alpha",
        owner_label="Alice",
        year_specific=True,
    )
    assert award["display_name"] == "Alice · Alpha"
    assert award["team_name"] == "Alpha"


def test_enrich_team_row_adds_display_name():
    row = enrich_team_row(
        {"team_name": "Alpha", "total_points": 100},
        {"Alpha": "Alice"},
        year_specific=False,
    )
    assert row["team_name"] == "Alpha"
    assert row["display_name"] == "Alice"
    assert row["owner_name"] == "Alice"


def test_fuzzy_yaml_owner_matches_partial_team_name():
    from src.draft_hub.owner_display import _fuzzy_yaml_owner

    assert _fuzzy_yaml_owner("Lincoler's Dual Ethics") == "Justin P"


def test_scoring_year_specific_uses_planning_season():
    from src.draft_hub.owner_display import scoring_year_specific

    assert scoring_year_specific("2025", "2026") is True
    assert scoring_year_specific("2026", "2026") is False


def test_award_entry_shows_manager_for_current_roster():
    from src.draft_hub.historic_insights import _award_entry

    award = _award_entry(
        "payroll_king",
        title="Spent it all",
        headline="$117 committed",
        team_name="Disappointment",
        year_specific=False,
    )
    assert award["display_name"] == "Aaron D"
    assert award["team_name"] is None


def test_award_entry_year_specific_includes_team():
    from src.draft_hub.historic_insights import _award_entry

    award = _award_entry(
        "payroll_king",
        title="Spent it all",
        headline="$117 committed",
        team_name="Hurts when I Brown",
        year_specific=True,
    )
    assert award["display_name"] == "Nick F · Hurts when I Brown"
    assert award["team_name"] == "Hurts when I Brown"


def test_attach_owner_names_falls_back_to_hub_name(monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.owner_display.team_owner_map_for_league",
        lambda *_a, **_k: {
            "White Supremacists": "Caleb K",
            "white supremacists": "Caleb K",
        },
    )
    teams = [
        {
            "id": "t1",
            "name": "White Supremacists",
            "sleeper_team_name": "Panda Fraud",
        }
    ]
    attach_owner_names_to_teams("lg-1", teams)
    assert teams[0]["owner_name"] == "Caleb K"
