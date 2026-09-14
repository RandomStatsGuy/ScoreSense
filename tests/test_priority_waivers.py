from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.priority_waivers import (
    confirm_waiver_priority,
    process_claims,
    replace_claims,
    waiver_protection,
    waiver_priority,
)
from src.draft_hub.schemas import LeagueRules

ET = ZoneInfo("America/New_York")


def _league():
    rules = LeagueRules(draft_type="snake")
    league = storage.create_league("claim-comm", "Claims", 2026, rules, team_count=3)
    storage.join_league("claim-a", league["room_code"], "Alpha")
    storage.join_league("claim-b", league["room_code"], "Bravo")
    teams = storage.list_league_teams(league["id"])
    order = [str(team["id"]) for team in teams]
    storage.update_draft_session(league["id"], nomination_order_json=__import__("json").dumps(order))
    return league, teams, order


def _claim(player_id, name, position="WR", drop_player_id=None):
    return {
        "player_id": player_id,
        "player_name": name,
        "team": "FA",
        "position": position,
        "drop_player_id": drop_player_id,
    }


def test_priority_initializes_from_reverse_first_round(hub_db):
    league, _teams, order = _league()
    priority = waiver_priority(league["id"])
    assert priority["confirmed"] is True
    assert [row["team_id"] for row in priority["teams"]] == list(reversed(order))


def test_incomplete_draft_order_requires_commissioner_confirmation(hub_db):
    league, teams, _order = _league()
    storage.update_draft_session(league["id"], nomination_order_json="[]")
    priority = waiver_priority(league["id"])
    assert priority["requires_confirmation"] is True
    assert {row["team_id"] for row in priority["teams"]} == {str(team["id"]) for team in teams}
    confirmed = confirm_waiver_priority(league["id"], [str(team["id"]) for team in teams])
    assert confirmed["confirmed"] is True


def test_conflicting_claim_uses_priority_and_moves_winner_last(hub_db):
    league, _teams, order = _league()
    priority_order = list(reversed(order))
    window = "2026-w2-waiver"
    for team_id in priority_order[:2]:
        replace_claims(
            league_id=league["id"], team_id=team_id, window_id=window,
            claims=[_claim("p1", "Player One")], user_sub="owner",
        )
    result = process_claims(league["id"], window)
    assert result["awarded_count"] == 1
    assert result["awarded"][0]["team_id"] == priority_order[0]
    assert result["priority"][-1] == priority_order[0]
    outcomes = {row["team_id"]: row["status"] for row in storage_rows(league["id"], window)}
    assert outcomes[priority_order[0]] == "won"
    assert outcomes[priority_order[1]] == "lost"


def test_claim_queue_can_be_reordered_and_cancelled(hub_db):
    league, _teams, order = _league()
    team_id = order[0]
    window = "2026-w2-waiver"
    replace_claims(
        league_id=league["id"], team_id=team_id, window_id=window,
        claims=[_claim("p1", "One"), _claim("p2", "Two")], user_sub="owner",
    )
    saved = replace_claims(
        league_id=league["id"], team_id=team_id, window_id=window,
        claims=[_claim("p2", "Two")], user_sub="owner",
    )
    assert [(row["player_id"], row["claim_rank"]) for row in saved] == [("p2", 1)]


def test_claim_rejects_rostered_player_and_foreign_drop(hub_db):
    league, _teams, order = _league()
    team_id = order[0]
    other_team_id = order[1]
    workspace_id = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace_id, {
        "player_id": "owned", "player_name": "Owned", "team": "FA", "position": "WR",
        "salary": 0, "contract_years": 1, "source": "draft",
    }, team_id=other_team_id)
    try:
        replace_claims(
            league_id=league["id"], team_id=team_id, window_id="2026-w2-waiver",
            claims=[_claim("owned", "Owned")], user_sub="owner",
        )
    except ValueError as exc:
        assert "available" in str(exc).lower()
    else:
        raise AssertionError("Rostered player claim should fail")
    try:
        replace_claims(
            league_id=league["id"], team_id=team_id, window_id="2026-w2-waiver",
            claims=[_claim("free", "Free", drop_player_id="owned")], user_sub="owner",
        )
    except ValueError as exc:
        assert "your current roster" in str(exc).lower()
    else:
        raise AssertionError("Foreign conditional drop should fail")


def test_conditional_drop_happens_only_for_successful_claim(hub_db):
    league, _teams, order = _league()
    team_id = list(reversed(order))[0]
    workspace_id = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace_id, {
        "player_id": "drop", "player_name": "Drop Me", "team": "FA", "position": "WR",
        "salary": 0, "contract_years": 1, "source": "draft",
    }, team_id=team_id)
    replace_claims(
        league_id=league["id"], team_id=team_id, window_id="2026-w2-waiver",
        claims=[_claim("add", "Add Me", drop_player_id="drop")], user_sub="owner",
    )
    result = process_claims(league["id"], "2026-w2-waiver")
    assert result["awarded_count"] == 1
    assert storage.get_roster_slot(workspace_id, "drop") is None
    assert storage.get_roster_slot(workspace_id, "add")["team_id"] == team_id
    assert waiver_protection(league["id"], "drop") is not None


def test_ordered_alternative_runs_after_a_higher_priority_team_wins(hub_db):
    league, _teams, order = _league()
    first, second = list(reversed(order))[:2]
    window = "2026-w2-waiver"
    replace_claims(
        league_id=league["id"], team_id=first, window_id=window,
        claims=[_claim("shared", "Shared")], user_sub="first",
    )
    replace_claims(
        league_id=league["id"], team_id=second, window_id=window,
        claims=[_claim("shared", "Shared"), _claim("backup", "Backup")], user_sub="second",
    )
    result = process_claims(league["id"], window)
    winners = {(row["player_id"], row["team_id"]) for row in result["awarded"]}
    assert winners == {("shared", first), ("backup", second)}


def test_failed_conditional_drop_keeps_roster_and_priority(hub_db):
    league, _teams, order = _league()
    team_id = list(reversed(order))[0]
    workspace_id = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace_id, {
        "player_id": "drop", "player_name": "Drop", "team": "FA", "position": "WR",
        "salary": 0, "contract_years": 1, "source": "draft",
    }, team_id=team_id)
    replace_claims(
        league_id=league["id"], team_id=team_id, window_id="2026-w2-waiver",
        claims=[_claim("add", "Add", drop_player_id="drop")], user_sub="owner",
    )
    storage.remove_roster_slot(workspace_id, "drop", team_id=team_id)
    before = [row["team_id"] for row in waiver_priority(league["id"])["teams"]]
    result = process_claims(league["id"], "2026-w2-waiver")
    assert result["awarded_count"] == 0
    assert result["failed"][0]["reason"] == "conditional_drop_unavailable"
    assert result["priority"] == before
    assert storage.get_roster_slot(workspace_id, "add") is None


def test_dropped_player_stays_on_waiver_protection(hub_db):
    league, _teams, order = _league()
    team_id = list(reversed(order))[0]
    workspace_id = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace_id, {
        "player_id": "drop", "player_name": "Drop Me", "team": "FA", "position": "WR",
        "salary": 0, "contract_years": 1, "source": "draft",
    }, team_id=team_id)
    replace_claims(
        league_id=league["id"], team_id=team_id, window_id="2026-w2-waiver",
        claims=[_claim("add", "Add Me", drop_player_id="drop")], user_sub="owner",
    )
    process_claims(league["id"], "2026-w2-waiver")
    assert waiver_protection(league["id"], "drop") is not None
    try:
        replace_claims(
            league_id=league["id"], team_id=list(reversed(order))[1],
            window_id="2026-w3-waiver",
            claims=[_claim("drop", "Drop Me")], user_sub="other",
        )
    except ValueError as exc:
        assert "waiver protection" in str(exc).lower()
    else:
        raise AssertionError("Protected player claim should fail")


def test_process_fails_protected_claim_without_moving_priority(hub_db):
    league, _teams, order = _league()
    team_id = list(reversed(order))[0]
    replace_claims(
        league_id=league["id"], team_id=team_id, window_id="2026-w2-waiver",
        claims=[_claim("locked", "Locked")], user_sub="owner",
    )
    stamp = storage._utcnow()
    eligible = (datetime.now(timezone.utc) + timedelta(days=6)).isoformat()
    with storage.get_conn() as conn:
        conn.execute(
            "INSERT INTO waiver_protection VALUES (?,?,?,?,?)",
            (league["id"], "locked", team_id, eligible, stamp),
        )
    before = [row["team_id"] for row in waiver_priority(league["id"])["teams"]]
    result = process_claims(league["id"], "2026-w2-waiver")
    assert result["awarded_count"] == 0
    assert result["failed"][0]["reason"] == "waiver_protected"
    assert result["priority"] == before


def test_repeated_processing_is_idempotent(hub_db):
    league, _teams, order = _league()
    team_id = list(reversed(order))[0]
    replace_claims(
        league_id=league["id"], team_id=team_id, window_id="2026-w2-waiver",
        claims=[_claim("p2", "Player Two")], user_sub="owner",
    )
    first = process_claims(league["id"], "2026-w2-waiver")
    second = process_claims(league["id"], "2026-w2-waiver")
    assert first["awarded_count"] == 1
    assert second["already_processed"] is True
    assert second["awarded"] == first["awarded"]


def storage_rows(league_id, window_id):
    with storage.get_conn() as conn:
        return [dict(row) for row in conn.execute(
            "SELECT * FROM waiver_claim WHERE league_id=? AND window_id=?", (league_id, window_id)
        ).fetchall()]


def _client(sub):
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def test_claim_api_is_member_scoped_and_priority_is_commissioner_only(hub_db, monkeypatch):
    league, teams, order = _league()
    storage.update_league_settings(league["id"], draft_completed=True)
    monkeypatch.setattr(
        "src.draft_hub.acquisition_window.get_nfl_state",
        lambda use_cache=True: {"season_type": "regular", "week": 2, "season": 2026},
    )
    monkeypatch.setattr(
        "src.draft_hub.acquisition_window._now_et",
        lambda now=None: datetime(2026, 9, 15, 9, 0, tzinfo=ET),
    )
    member = _client("claim-a")
    try:
        claim = member.put("/api/hub/fa-market/claims", json={"claims": [_claim("api-p", "API Player")]})
        assert claim.status_code == 200, claim.text
        denied = member.put("/api/hub/fa-market/priority", json={"team_ids": list(reversed(order))})
        assert denied.status_code == 403
        early = _client("claim-comm").post("/api/hub/fa-market/process")
        assert early.status_code == 400
        assert "wednesday" in early.json()["detail"].lower()
        commissioner = _client("claim-comm")
        confirmed = commissioner.put(
            "/api/hub/fa-market/priority",
            json={"team_ids": [str(team["id"]) for team in reversed(teams)]},
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["priority"]["confirmed"] is True
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
