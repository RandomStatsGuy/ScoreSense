from src.draft_hub.owner_display import (
    attach_owner_names_to_teams,
    enrich_award_display,
    enrich_insights_landing,
    enrich_team_row,
    format_manager_label,
    resolve_owner,
)


def test_format_manager_label_owner_only_by_default():
    assert format_manager_label("White Supremacists", owner_label="Caleb K") == "Caleb K"


def test_format_manager_label_includes_team_when_year_specific():
    label = format_manager_label("White Supremacists", owner_label="Caleb K", year_specific=True)
    assert label == "White Supremacists · Caleb K"


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
    assert award["display_name"] == "Alpha · Alice"
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


def test_historic_king_panda_is_stephen():
    from src.draft_hub.owner_display import _fuzzy_yaml_owner

    assert _fuzzy_yaml_owner("King Panda") == "Stephen P"
    assert _fuzzy_yaml_owner("KKing panda") == "Stephen P"


def test_enrich_insights_landing_uses_manager_names():
    landing = enrich_insights_landing(
        {
            "most_titles": {"team_name": "King Panda", "owner_id": "u1", "titles": 3},
            "champions": [
                {
                    "season": "2022",
                    "team_name": "King Panda",
                    "owner_id": "u1",
                    "runner_up": "Sad Panda",
                    "runner_up_owner_id": "u2",
                }
            ],
            "record_leaders": [{"team_name": "The Deported Panda", "owner_id": "u1", "wins": 45}],
            "scoring_leaders": [{"team_name": "The Deported Panda", "owner_id": "u1"}],
        },
        {"The Deported Panda": "Stephen P"},
        {"u1": "Stephen P", "u2": "Dawson O"},
    )
    assert landing["most_titles"]["owner_name"] == "Stephen P"
    assert landing["most_titles"]["display_name"] == "Stephen P"
    assert landing["champions"][0]["owner_name"] == "Stephen P"
    assert landing["champions"][0]["display_name"] == "Stephen P"
    assert landing["champions"][0]["team_name"] == "King Panda"
    assert landing["champions"][0]["runner_up_owner_name"] == "Dawson O"
    assert landing["record_leaders"][0]["owner_name"] == "Stephen P"


def test_fuzzy_yaml_owner_matches_partial_team_name():
    from src.draft_hub.owner_display import _fuzzy_yaml_owner

    assert _fuzzy_yaml_owner("Lincoler's Dual Ethics") == "Justin P"


def test_scoring_year_specific_uses_planning_season():
    from src.draft_hub.owner_display import scoring_year_specific

    assert scoring_year_specific("2025", "2026") is True
    assert scoring_year_specific("2026", "2026") is True


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
    assert award["display_name"] == "Hurts when I Brown · Nick F"
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


def test_current_team_labels_do_not_reuse_swapped_historical_nicknames(monkeypatch):
    from src.draft_hub import owner_display, storage, historic_insights

    monkeypatch.setattr(storage, "get_league", lambda _: {"season": 2026})
    monkeypatch.setattr(historic_insights, "list_history_seasons", lambda _: [2025])
    monkeypatch.setattr(storage, "ensure_owner_season_map_seeded", lambda _: None)
    historical = [
        {"owner_label": "Josh C", "hub_team_name": "Disappointment", "source_kind": "contract_seed"},
        {"owner_label": "Aaron D", "hub_team_name": "Thanks noob noob", "source_kind": "contract_seed"},
    ]
    monkeypatch.setattr(storage, "list_owner_season_map", lambda _, season_year: historical if season_year == 2025 else [])
    monkeypatch.setattr(storage, "list_league_contract_rows", lambda _, season_year: [])
    teams = [{"name": "Disappointment"}, {"name": "Thanks noob noob"}]
    owner_display.attach_owner_names_to_teams("panda", teams)
    assert [t["owner_name"] for t in teams] == ["Aaron D", "Josh C"]
    past = owner_display.team_owner_map_for_league("panda", season_year=2025)
    assert past["Disappointment"] == "Josh C"
    assert past["Thanks noob noob"] == "Aaron D"
    # A deliberate mapping for this season still overrides the YAML fallback.
    monkeypatch.setattr(storage, "list_owner_season_map", lambda _, season_year: [
        {"owner_label": "New owner", "hub_team_name": "Disappointment", "source_kind": "manual"},
    ])
    assert owner_display.team_owner_map_for_league("panda")["Disappointment"] == "New owner"


def test_concrete_season_labels_are_team_first_and_all_time_is_manager_first():
    from src.draft_hub.owner_display import scoring_year_specific
    assert scoring_year_specific('all','2026') is False
    assert scoring_year_specific('','2026') is False
    row={'team_name':'Season franchise','owner_name':'Josh C'}
    assert enrich_team_row(row,{},year_specific=True)['display_name']=='Season franchise · Josh C'
    assert enrich_team_row(row,{},year_specific=False)['display_name']=='Josh C'
