"""Cap transfers preserve amounts, origins, and Sleeper ownership."""
import pytest

from src.draft_hub import storage
from src.draft_hub.pre_draft_cap import total_pre_draft_dead_cap, contract_on_cut_status_change
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.trade_proposals import execute_multiparty_trade, propose_trade, respond_to_proposal, validate_trade_package
from src.draft_hub.sleeper_trade_review import record_synced_moves, settle_sleeper_proposal, close_cap_review
from tests.test_trade_proposals import _two_team_league


def setup_cut(hub_db):
    league, a, b, ws, comm, member = _two_team_league(hub_db, a_salary=50, b_salary=35)
    storage.update_roster_slot(ws["id"], "p-a", team_id=a["id"], roster_status="cut_before_draft")
    cut = next(r for r in storage.list_team_roster(league["id"], a["id"]) if r["player_id"] == "p-a")
    return league, a, b, ws, comm, member, cut


def cap_parties(a, b, cut, amount=10):
    return [{"team_id": a["id"], "dead_cap_transfers": [{
        "roster_slot_id": cut["id"], "player_id": cut["player_id"], "to_team_id": b["id"], "amount": amount}]},
        {"team_id": b["id"]}]


def test_partial_cap_transfer_and_retransfer_preserve_source(hub_db):
    league, a, b, ws, comm, member, cut = setup_cut(hub_db)
    rules = LeagueRules.model_validate(league["rules"])
    parties = cap_parties(a, b, cut)
    check = validate_trade_package(league["id"], parties)
    assert check["preview"][a["id"]]["dead_cap"] == 15
    assert check["preview"][b["id"]]["dead_cap"] == 10
    prop = propose_trade(league["id"], created_by_sub=comm, proposer_team_id=a["id"], parties=parties)
    result = respond_to_proposal(prop["id"], team_id=b["id"], approve=True, user_sub=member)
    assert result["status"] == "executed"
    rows = storage.list_league_rosters_by_team(league["id"])
    received = next(r for r in rows[b["id"]] if r["roster_status"] == "cut_before_draft")
    origin = received["contract"]["dead_cap_sources"][0]
    assert origin["origin_team_id"] == a["id"]
    assert origin["player_name"] == "Player A"
    assert origin["history"][0]["proposal_id"] == prop["id"]
    assert total_pre_draft_dead_cap(rules, rows[a["id"]]) == 15
    assert total_pre_draft_dead_cap(rules, rows[b["id"]]) == 10
    assert total_pre_draft_dead_cap(rules, rows[b["id"]], year_offset=1) == 0
    execute_multiparty_trade(league["id"], cap_parties(b, a, received, 4))
    rows = storage.list_league_rosters_by_team(league["id"])
    assert total_pre_draft_dead_cap(rules, rows[a["id"]]) == 19
    assert total_pre_draft_dead_cap(rules, rows[b["id"]]) == 6
    original = next(r for r in rows[a["id"]] if r["player_id"] == "p-a")
    assert any(len(s["history"]) == 2 for s in original["contract"]["dead_cap_sources"])
    with pytest.raises(ValueError, match="cannot be undone"):
        contract_on_cut_status_change(original, roster_status="active")
    with pytest.raises(ValueError, match="already been resolved"):
        execute_multiparty_trade(league["id"], parties, proposal_id=prop["id"])


@pytest.mark.parametrize("amount", [0, -1, 26, float("nan"), float("inf"), 1.001])
def test_invalid_dead_cap_amounts_do_not_write(hub_db, amount):
    league, a, b, ws, comm, member, cut = setup_cut(hub_db)
    with pytest.raises(ValueError):
        execute_multiparty_trade(league["id"], cap_parties(a, b, cut, amount))
    assert storage.get_roster_slot(ws["id"], "p-a")["team_id"] == a["id"]


def test_dead_cap_recipient_over_cap_is_rejected_after_draft(hub_db):
    league, a, b, ws, comm, member, cut = setup_cut(hub_db)
    storage.update_roster_slot(ws["id"], "p-b", salary=199, any_team=True)
    storage.update_league_settings(league["id"], draft_completed=True)
    check = validate_trade_package(league["id"], cap_parties(a, b, cut))
    assert not check["ok"]
    assert any("over cap" in e for e in check["errors"])


def test_active_reacquisition_does_not_move_with_dead_cap(hub_db):
    league, a, b, ws, comm, member, cut = setup_cut(hub_db)
    storage.add_roster_slot(ws["id"], {"player_id": "p-a", "player_name": "Player A",
        "position": "WR", "salary": 5, "contract_years": 2}, team_id=b["id"])
    execute_multiparty_trade(league["id"], cap_parties(a, b, cut))
    rows = storage.list_team_roster(league["id"], b["id"])
    assert len([r for r in rows if r["player_id"] == "p-a"]) == 2
    active = next(r for r in rows if r["player_id"] == "p-a" and r["roster_status"] == "active")
    assert active["salary"] == 5


def test_transferred_cap_expires_when_the_league_advances_season(hub_db):
    league, a, b, ws, comm, member, cut = setup_cut(hub_db)
    execute_multiparty_trade(league["id"], cap_parties(a, b, cut))
    storage.update_league_season(league["id"], 2027)
    rules = LeagueRules.model_validate(league["rules"])
    for rows in storage.list_league_rosters_by_team(league["id"]).values():
        assert total_pre_draft_dead_cap(rules, rows) == 0
    received = next(r for r in storage.list_team_roster(league["id"], b["id"]) if r["roster_status"] == "cut_before_draft")
    assert received["contract"]["dead_cap_sources"][0]["season"] == 2026


def test_sleeper_filter_preserves_cut_debt_when_player_is_absent(hub_db):
    from src.draft_hub.hub_context import filter_team_sleeper_roster
    league, a, b, ws, comm, member, cut = setup_cut(hub_db)
    cut["source"] = "sleeper"
    result = filter_team_sleeper_roster({**a, "sleeper_roster_id": "1", "sleeper_player_ids": ["someone-else"]}, [cut])
    assert result == [cut]


def test_sleeper_proposal_waits_for_actual_destinations(hub_db):
    league, a, b, ws, comm, member = _two_team_league(hub_db)
    storage.update_league_sleeper_id(league["id"], "linked")
    storage.update_roster_slot(ws["id"], "p-b", contract_years=2, any_team=True)
    parties = [{"team_id": a["id"], "sends": ["p-a"]}, {"team_id": b["id"], "sends": ["p-b"]}]
    prop = propose_trade(league["id"], created_by_sub=comm, proposer_team_id=a["id"], parties=parties)
    result = respond_to_proposal(prop["id"], team_id=b["id"], approve=True, user_sub=member)
    assert result["status"] == "awaiting_sleeper"
    assert storage.get_roster_slot(ws["id"], "p-a")["team_id"] == a["id"]
    with pytest.raises(ValueError, match="destinations"):
        settle_sleeper_proposal(prop["id"], user_sub=member)
    storage.move_roster_player(ws["id"], "p-a", b["id"])
    storage.move_roster_player(ws["id"], "p-b", a["id"])
    assert settle_sleeper_proposal(prop["id"], user_sub=member)["status"] == "executed"
    with pytest.raises(ValueError):
        settle_sleeper_proposal(prop["id"], user_sub=member)


def test_sleeper_first_review_can_attach_cap_only_agreement(hub_db):
    league, a, b, ws, comm, member, cut = setup_cut(hub_db)
    storage.update_league_sleeper_id(league["id"], "linked")
    move = {"player_id": "p-b", "player_name": "Player B", "from_team_id": b["id"], "to_team_id": a["id"]}
    storage.move_roster_player(ws["id"], "p-b", a["id"])
    record_synced_moves(ws["id"], [move])
    record_synced_moves(ws["id"], [move])
    reviews = storage.list_trade_proposals(league["id"], status="cap_review")
    assert len(reviews) == 1
    review = reviews[0]
    with pytest.raises(ValueError, match="Commissioner"):
        close_cap_review(review["id"], user_sub=member)
    prop = propose_trade(league["id"], created_by_sub=comm, proposer_team_id=a["id"],
                         parties=cap_parties(a, b, cut), source_review_id=review["id"])
    with pytest.raises(ValueError, match="pending cap"):
        close_cap_review(review["id"], user_sub=comm)
    result = respond_to_proposal(prop["id"], team_id=b["id"], approve=True, user_sub=member)
    assert result["status"] == "executed"
    assert storage.get_trade_proposal(review["id"])["status"] == "reviewed"
    assert storage.get_roster_slot(ws["id"], "p-b")["team_id"] == a["id"]


def test_failure_inside_cap_transaction_rolls_back_player_move(hub_db):
    league, a, b, ws, comm, member, cut = setup_cut(hub_db)
    before = storage.list_league_rosters_by_team(league["id"])
    with pytest.raises(ValueError):
        storage.apply_trade_plan(ws["id"],
            [{"player_id": "p-b", "from_team_id": b["id"], "team_id": a["id"]}],
            dead_cap_parties=cap_parties(a, b, cut, 26),
            dead_cap_rules=LeagueRules.model_validate(league["rules"]), dead_cap_season=2026)
    assert storage.list_league_rosters_by_team(league["id"]) == before


def test_sleeper_three_way_with_dead_cap_settles_once_after_sync(hub_db):
    league, a, b, ws, comm, member, cut = setup_cut(hub_db)
    c = storage.join_league("third", league["room_code"], "Team C")
    storage.add_roster_slot(ws["id"], {"player_id": "p-c", "player_name": "Player C",
        "position": "TE", "salary": 20, "contract_years": 2}, team_id=c["id"])
    storage.add_roster_slot(ws["id"], {"player_id": "p-d", "player_name": "Player D",
        "position": "WR", "salary": 15, "contract_years": 2}, team_id=a["id"])
    storage.update_league_sleeper_id(league["id"], "linked")
    parties = cap_parties(a, b, cut)
    parties[0]["sends"] = [{"player_id": "p-d", "to_team_id": b["id"]}]
    parties[1]["sends"] = [{"player_id": "p-b", "to_team_id": c["id"]}]
    parties.append({"team_id": c["id"], "sends": [{"player_id": "p-c", "to_team_id": a["id"]}]})
    prop = propose_trade(league["id"], created_by_sub=comm, proposer_team_id=a["id"], parties=parties)
    assert respond_to_proposal(prop["id"], team_id=b["id"], approve=True, user_sub=member)["status"] == "pending"
    assert respond_to_proposal(prop["id"], team_id=c["id"], approve=True, user_sub="third")["status"] == "awaiting_sleeper"
    rules = LeagueRules.model_validate(league["rules"])
    assert total_pre_draft_dead_cap(rules, storage.list_team_roster(league["id"], a["id"])) == 25
    moves = []
    for party in parties:
        for leg in party["sends"]:
            storage.move_roster_player(ws["id"], leg["player_id"], leg["to_team_id"])
            moves.append({**leg, "from_team_id": party["team_id"]})
    record_synced_moves(ws["id"], moves)
    assert storage.list_trade_proposals(league["id"], status="cap_review") == []
    assert settle_sleeper_proposal(prop["id"], user_sub="third")["status"] == "executed"
    assert total_pre_draft_dead_cap(rules, storage.list_team_roster(league["id"], a["id"])) == 15
    assert total_pre_draft_dead_cap(rules, storage.list_team_roster(league["id"], b["id"])) == 10
