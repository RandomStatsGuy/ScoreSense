import pytest
from fastapi.testclient import TestClient
from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.contract_returns import build_contract_returns
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.season_scoring import save_week


@pytest.fixture
def salary_history(hub_db, monkeypatch):
    league = storage.create_league("returns-owner", "Returns", 2026, LeagueRules())
    storage.join_league("returns-owner", league["room_code"], "Nicknames change")
    lid = league["id"]
    for year in [2024, 2025, 2026]:
        save_week(lid, year, 1, [
            {"aliases": ["player"], "points": 100, "position": "WR"},
            {"aliases": ["zero"], "points": 0, "position": "RB"},
        ])
        storage.insert_league_contract_row(lid, year, {"owner_label": "Manager", "hub_team_name": "Nicknames change",
            "player_id": "player", "player_name": "Actual Player", "position": "WR", "base_salary": 20,
            "original_draft_year": 2024, "contract_phase": "Rookie" if year < 2026 else "Extension"})
    def forbidden(*args, **kwargs):
        pytest.fail("Contract rankings contacted a scoring host")
    monkeypatch.setattr("src.draft_hub.league_history._fetch_json", forbidden)
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_league_users", forbidden)
    yield lid


def test_actual_saved_points_and_salary_keep_renewal_separate(salary_history):
    out = build_contract_returns(salary_history)
    assert len(out["rows"]) == 3
    assert out["rows"][0]["points"] == 100
    assert out["rows"][0]["salary"] == 20
    assert out["rows"][0]["deal_id"] == out["rows"][1]["deal_id"]
    assert out["rows"][1]["deal_id"] != out["rows"][2]["deal_id"]


def test_recorded_zero_ranks_but_missing_score_salary_and_ambiguous_import_do_not(salary_history):
    lid = salary_history
    for pid, salary in [("zero", 30), ("missing", 30), ("free", 0), ("invalid", None)]:
        storage.insert_league_contract_row(lid, 2026, {"owner_label": "Manager", "player_id": pid,
            "player_name": pid, "base_salary": salary, "position": "RB"})
    out = build_contract_returns(lid)
    assert next(r for r in out["rows"] if r["player_id"] == "zero")["points"] == 0
    assert out["excluded"] == 3
    storage.insert_league_contract_row(lid, 2026, {"owner_label": "Manager", "player_id": "zero", "player_name": "zero", "base_salary": 30})
    assert not any(r["player_id"] == "zero" for r in build_contract_returns(lid)["rows"])


def test_missing_feed_week_does_not_lower_a_contract_return(salary_history):
    save_week(salary_history, 2025, 3, [{"aliases": ["player"], "points": 2}])
    out = build_contract_returns(salary_history)
    assert not any(r["season"] == 2025 for r in out["rows"])


def test_contract_endpoint_checks_membership_and_money_capability(salary_history):
    user = {"sub": "returns-owner"}
    app.dependency_overrides[require_hub_user] = lambda: user
    try:
        client = TestClient(app)
        url = f"/api/hub/league/{salary_history}/insights/contracts"
        assert client.get(url).status_code == 200
        user["sub"] = "outsider"
        assert client.get(url).status_code == 403
        user["sub"] = "returns-owner"
        storage.update_league_rules(salary_history, LeagueRules(draft_type="snake"))
        assert client.get(url).status_code == 404
    finally:
        app.dependency_overrides.pop(require_hub_user, None)

def test_contract_cache_invalidates_when_saved_points_change_and_keeps_access(salary_history, monkeypatch):
    from app import hub_routes
    import src.draft_hub.contract_returns as returns
    calls = []
    original = returns.build_contract_returns
    monkeypatch.setattr(returns, "build_contract_returns", lambda lid: calls.append(lid) or original(lid))
    hub_routes._clear_insights_response_cache()
    user = {"sub": "returns-owner"}
    app.dependency_overrides[require_hub_user] = lambda: user
    try:
        with TestClient(app) as client:
            url = f'/api/hub/league/{salary_history}/insights/contracts'
            first = client.get(url)
            assert first.status_code == 200, first.text
            assert client.get(url).json()['cache_status']['contracts'] == 'hit'
            assert len(calls) == 1
            save_week(salary_history, 2026, 1, [{"aliases": ["player"], "position": "WR", "points": 120}])
            changed = client.get(url).json()
            assert next(r for r in changed['contracts']['rows'] if r['season'] == 2026)['points'] == 120
            assert len(calls) == 2
            user['sub'] = 'outsider'
            assert client.get(url).status_code == 403
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
        hub_routes._clear_insights_response_cache()


@pytest.fixture
def linked_salary_history(salary_history):
    lid = salary_history
    storage.update_league_sleeper_id(lid, "current")
    chain = [{"season": str(year), "league_id": f"source-{year}"} for year in [2022, 2023, 2024]]
    storage.upsert_sleeper_league_chain("current", [{"season": "2026", "league_id": "current"}, *chain])
    events = {"gsis-alex": [], "gsis-jordan": [], "gsis-james": [], "gsis-jk": [], "SF": []}
    for year in [2022, 2023, 2024]:
        for pid, name, pos in [("gsis-alex", "Alex Example", "WR"), ("gsis-jordan", "Jordan Williams", "RB"),
                               ("gsis-james", "James Williams", "RB"), ("gsis-jk", "J.K. Dobbins", "RB"),
                               ("SF", "San Francisco 49ers", "DEF")]:
            events[pid].append({"season": str(year), "player_name": name, "position": pos})
        save_week(f"source-{year}", year, 1, [
            {"aliases": ["101", "sleeper-101", " gsis-alex "], "points": 100, "position": "WR"},
            {"aliases": ["102", "sleeper-102", "gsis-jordan"], "points": 50, "position": "RB"},
            {"aliases": ["104", "sleeper-104", "gsis-jk"], "points": 0, "position": "RB"},
            {"aliases": ["SF", "sleeper-SF"], "points": 10, "position": "DEF"},
        ])
        for name, pos in [("A. Example", "WR"), ("J. Williams", "RB"), ("JK Dobbins", "RB"), ("49ers DST", "DST")]:
            storage.insert_league_contract_row(lid, year, {"owner_label": "Manager", "hub_team_name": "Nicknames change",
                "player_name": name, "position": pos, "base_salary": 10})
    # The cached history can belong to last year's league, not the current ID.
    storage.upsert_sleeper_ownership_cache("source-2024", {"by_player": events})
    return lid


def test_abbreviated_history_uses_saved_season_names_without_guessing(linked_salary_history):
    out = build_contract_returns(linked_salary_history)
    for year in [2022, 2023, 2024]:
        rows = [row for row in out["rows"] if row["season"] == year]
        assert {row["player_id"] for row in rows} == {"sleeper-101", "sleeper-104", "sleeper-SF"}
        assert next(row for row in rows if row["player_id"] == "sleeper-101")["points"] == 100
        assert next(row for row in rows if row["player_id"] == "sleeper-104")["points"] == 0
        assert all(row["owner_name"] == "Manager" for row in rows)
        status = next(row for row in out["season_status"] if row["season"] == year)
        assert status["excluded"]["missing_identity"] == 1  # Other J. Williams is inactive but still ambiguous.


def test_exact_full_name_and_approved_alias_disambiguate_abbreviations(linked_salary_history):
    lid = linked_salary_history
    storage.insert_league_contract_row(lid, 2022, {"owner_label": "Manager", "player_name": "Jordan Williams",
        "position": "RB", "base_salary": 20})
    # The ambiguous initial remains excluded while the full first name is exact.
    out = build_contract_returns(lid)
    rows = [row for row in out["rows"] if row["season"] == 2022 and row["player_id"] == "sleeper-102"]
    assert len(rows) == 1 and rows[0]["player_name"] == "Jordan Williams"
    storage.upsert_player_name_alias(lid, "The Sleeper", "Jordan Williams", position="RB", sleeper_player_id="102")
    storage.insert_league_contract_row(lid, 2023, {"owner_label": "Manager", "player_name": "The Sleeper", "position": "RB", "base_salary": 10})
    assert any(row["player_name"] == "The Sleeper" and row["points"] == 50 for row in build_contract_returns(lid)["rows"])


def test_duplicate_aliases_and_malformed_imports_never_create_ranked_deals(linked_salary_history):
    lid = linked_salary_history
    storage.insert_league_contract_row(lid, 2022, {"owner_label": "Manager", "player_id": "sleeper-101", "player_name": "Alex Example", "position": "WR", "base_salary": 20})
    storage.insert_league_contract_row(lid, 2021, {"owner_label": "Manager", "player_name": "A Example20 J Williams8 Q Quarterback10", "position": "WR", "base_salary": 20})
    out = build_contract_returns(lid)
    assert not any(row["season"] == 2022 and row["player_id"] == "sleeper-101" for row in out["rows"])
    status = {row["season"]: row for row in out["season_status"]}
    assert status[2022]["excluded"]["ambiguous_contract"] == 2
    assert status[2021]["ranked"] == 0 and status[2021]["excluded"]["invalid_name"] == 1


def test_contract_cache_invalidates_when_a_prior_leagues_name_history_arrives(linked_salary_history):
    from app import hub_routes
    lid = linked_salary_history
    hub_routes._clear_insights_response_cache()
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "returns-owner"}
    try:
        with TestClient(app) as client:
            url = f"/api/hub/league/{lid}/insights/contracts"
            assert client.get(url).status_code == 200
            assert client.get(url).json()["cache_status"]["contracts"] == "hit"
            storage.upsert_sleeper_ownership_cache("source-2023", {"by_player": {"gsis-jordan": [
                {"season": "2023", "player_name": "The Third-Year Player", "position": "RB"}]}})
            assert client.get(url).json()["cache_status"]["contracts"] == "miss"
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
        hub_routes._clear_insights_response_cache()


def test_native_final_scoring_correction_is_used(salary_history):
    lid = salary_history
    team_id = storage.list_league_teams(lid)[0]["id"]
    with storage.get_conn() as conn:
        conn.execute("INSERT INTO league_week_scoring_run(league_id,season,week,scoring_json,final,scored_at) VALUES (?,?,?,?,?,?)",
                     (lid, 2026, 1, "{}", 1, "now"))
        conn.execute("INSERT INTO league_player_week_score(league_id,season,week,player_id,team_id,points,stats_json,scored_at) VALUES (?,?,?,?,?,?,?,?)",
                     (lid, 2026, 1, "player", team_id, 17, "{}", "now"))
    row = next(row for row in build_contract_returns(lid)["rows"] if row["season"] == 2026)
    assert row["points"] == 17


@pytest.mark.parametrize("position", [None, "NAN", "WC"])
def test_missing_import_position_can_match_one_saved_identity(linked_salary_history, position):
    storage.insert_league_contract_row(linked_salary_history, 2022, {"owner_label": "Other manager", "player_name": "A.Example", "position": position, "base_salary": 10})
    row = next(row for row in build_contract_returns(linked_salary_history)["rows"] if row["player_name"] == "A.Example")
    assert row["player_id"] == "sleeper-101" and row["position"] == "WR" and row["points"] == 100


def test_compact_multiple_initials_and_positionless_manual_alias(linked_salary_history):
    lid = linked_salary_history
    storage.upsert_player_name_alias(lid, "Zero Man", "J.K. Dobbins", sleeper_player_id="104")
    for name in ["J.K.Dobbins", "Zero Man"]:
        storage.insert_league_contract_row(lid, 2022, {"owner_label": name, "player_name": name, "position": "RB", "base_salary": 10})
    rows = [row for row in build_contract_returns(lid)["rows"] if row["player_name"] in {"J.K.Dobbins", "Zero Man"}]
    assert len(rows) == 2 and all(row["player_id"] == "sleeper-104" and row["points"] == 0 for row in rows)


def test_name_alias_correction_invalidates_contract_cache(linked_salary_history):
    from app import hub_routes
    lid = linked_salary_history
    storage.insert_league_contract_row(lid, 2022, {"owner_label": "Other manager", "player_name": "Hidden Star", "position": "WR", "base_salary": 10})
    hub_routes._clear_insights_response_cache()
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "returns-owner"}
    try:
        with TestClient(app) as client:
            url = f"/api/hub/league/{lid}/insights/contracts"
            assert not any(row["player_name"] == "Hidden Star" for row in client.get(url).json()["contracts"]["rows"])
            assert client.get(url).json()["cache_status"]["contracts"] == "hit"
            storage.upsert_player_name_alias(lid, "Hidden Star", "Alex Example", sleeper_player_id="101")
            changed = client.get(url).json()
            assert changed["cache_status"]["contracts"] == "miss"
            assert next(row for row in changed["contracts"]["rows"] if row["player_name"] == "Hidden Star")["points"] == 100
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
        hub_routes._clear_insights_response_cache()


def test_native_final_correction_invalidates_contract_cache(salary_history):
    from app import hub_routes
    lid = salary_history
    team_id = storage.list_league_teams(lid)[0]["id"]
    hub_routes._clear_insights_response_cache()
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "returns-owner"}
    try:
        with TestClient(app) as client:
            url = f"/api/hub/league/{lid}/insights/contracts"
            assert client.get(url).status_code == 200
            assert client.get(url).json()["cache_status"]["contracts"] == "hit"
            with storage.get_conn() as conn:
                conn.execute("INSERT INTO league_week_scoring_run(league_id,season,week,scoring_json,final,scored_at) VALUES (?,?,?,?,?,?)", (lid,2026,1,"{}",1,"correction"))
                conn.execute("INSERT INTO league_player_week_score(league_id,season,week,player_id,team_id,points,scored_at) VALUES (?,?,?,?,?,?,?)", (lid,2026,1,"player",team_id,17,"correction"))
            changed = client.get(url).json()
            assert changed["cache_status"]["contracts"] == "miss"
            assert next(row for row in changed["contracts"]["rows"] if row["season"] == 2026)["points"] == 17
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
        hub_routes._clear_insights_response_cache()
